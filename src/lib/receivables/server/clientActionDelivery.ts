/**
 * Client notices on a lender's action (Part B, approved 2026-11-28) — the server half: the outbox
 * (receivable_client_action_notices) and its delivery.
 *
 * Flow (decision B1): the action route (discharge, extend, unpaid, settle) calls
 * notifyClientOfAction() after its write succeeded. That writes one outbox row, scoped to the
 * actor's own claim, event or receivable, and tries the send at once. A send that throws leaves
 * the row pending; the daily notices job (runClientActionNotices, from the cron) retries pending
 * rows for CLIENT_ACTION_RETRY_DAYS. Nothing here can fail the lender's action: the route wraps it.
 *
 * Rules, in order, checked before every send (the aging notices' rules, noticeDelivery.ts):
 *   - once: the row is keyed by the action; sent_at is written only after the send succeeded.
 *   - practice records email nobody (isTest); a withdrawn record emails nobody (its public answer
 *     is gone, and an email never says more than the record shows).
 *   - the client address comes ONLY from the record's own flow (clientNoticeTarget); none, skip.
 *   - a client who did the action itself (it owns the record and settled it) is not told about it.
 *   - an opted-out address gets nothing; every email carries the opt-out link.
 * Reasons and notes are never read here.
 */
import { db } from '@/lib/db';
import { runWithoutDbContext } from '@/lib/dbContext';
import { sendMail } from '@/lib/email';
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { clientNoticeTarget, ensureReceivablesTables, noticeOptoutFor } from '@/lib/receivablesRegistry';
import {
	buildClientActionEmail,
	clientActionKey,
	CLIENT_ACTION_RETRY_DAYS,
	isClientActionKind,
	type ClientActionKind,
} from '@/lib/receivables/clientActionNotices';

const DAY_MS = 86_400_000;
const stamp = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);
const baseUrl = (): string => (process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');
const truthy = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === 't';

export type ClientActionOutcome = 'sent' | 'failed' | 'test' | 'withdrawn' | 'no_address' | 'self' | 'suppressed' | 'done' | 'missing';

/**
 * Write the outbox row for one action, tenant-scoped to the actor: `ref` must be the actor's own
 * claim (repaid), own status event (extended, unpaid) or own receivable (settled). Returns the
 * row's key, or null when the ref is not the actor's (nothing is written). Idempotent.
 */
export async function queueClientActionNotice(
	actorTenantId: string,
	kind: ClientActionKind,
	ref: string,
	now: Date = new Date(),
): Promise<string | null> {
	await ensureReceivablesTables();
	const id = String(ref || '').trim();
	if (!id) return null;
	let receivableId: string | null = null;
	let claimId: string | null = null;
	if (kind === 'repaid') {
		const r = await db.execute({
			sql: `SELECT receivable_id FROM receivable_claims WHERE id = ? AND tenant_id = ? AND status = 'discharged' LIMIT 1`,
			args: [id, actorTenantId],
		});
		if (r.rows.length) { receivableId = String((r.rows[0] as any).receivable_id); claimId = id; }
	} else if (kind === 'extended' || kind === 'unpaid') {
		const r = await db.execute({
			sql: `SELECT receivable_id, claim_id FROM receivable_status_events WHERE id = ? AND tenant_id = ? AND kind = ? LIMIT 1`,
			args: [id, actorTenantId, kind],
		});
		if (r.rows.length) {
			receivableId = String((r.rows[0] as any).receivable_id);
			claimId = String((r.rows[0] as any).claim_id);
		}
	} else {
		const r = await db.execute({
			sql: `SELECT id FROM receivables WHERE id = ? AND tenant_id = ? AND settled_at IS NOT NULL LIMIT 1`,
			args: [id, actorTenantId],
		});
		if (r.rows.length) receivableId = id;
	}
	if (!receivableId) return null;
	const key = clientActionKey(kind, id);
	await db.execute({
		sql: `INSERT INTO receivable_client_action_notices (event_key, kind, receivable_id, claim_id, actor_tenant_id, created_at, attempts)
		      VALUES (?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (event_key) DO NOTHING`,
		args: [key, kind, receivableId, claimId, actorTenantId, stamp(now), 0],
	});
	return key;
}

async function finish(key: string, field: 'sent' | 'skipped', value: string, now: Date): Promise<void> {
	await db.execute(field === 'sent'
		? { sql: `UPDATE receivable_client_action_notices SET sent_at = ? WHERE event_key = ? AND sent_at IS NULL`, args: [stamp(now), key] }
		: { sql: `UPDATE receivable_client_action_notices SET skipped = ? WHERE event_key = ? AND sent_at IS NULL`, args: [value, key] });
}

/** Try one outbox row: send it, skip it for good with a reason, or leave it pending on a failure. */
export async function deliverClientActionNotice(key: string, now: Date = new Date()): Promise<ClientActionOutcome> {
	await ensureReceivablesTables();
	const r = await db.execute({
		sql: `SELECT event_key, kind, receivable_id, claim_id, actor_tenant_id, sent_at, skipped, attempts
		        FROM receivable_client_action_notices WHERE event_key = ? LIMIT 1`,
		args: [key],
	});
	const row = r.rows[0] as any;
	if (!row) return 'missing';
	if (row.sent_at != null || row.skipped != null) return 'done';
	const kind = String(row.kind);
	if (!isClientActionKind(kind)) { await finish(key, 'skipped', 'unknown', now); return 'done'; }

	const rv = await db.execute({
		sql: `SELECT * FROM receivables WHERE id = ? LIMIT 1`,
		args: [String(row.receivable_id)],
	});
	const rcv = rv.rows[0] as any;
	if (!rcv) { await finish(key, 'skipped', 'missing', now); return 'missing'; }
	if (truthy(rcv.is_test)) { await finish(key, 'skipped', 'test', now); return 'test'; }
	if (rcv.deleted_at != null) { await finish(key, 'skipped', 'withdrawn', now); return 'withdrawn'; }

	const target = await clientNoticeTarget(String(rcv.id));
	if (!target) { await finish(key, 'skipped', 'no_address', now); return 'no_address'; }
	if (target.kind === 'tenant' && target.tenantId === String(row.actor_tenant_id)) {
		await finish(key, 'skipped', 'self', now);
		return 'self';
	}
	const email = target.kind === 'email' ? target.email : (await resolveAlertRecipient(target.tenantId)).email;
	if (!email) { await finish(key, 'skipped', 'no_address', now); return 'no_address'; }
	const optout = await noticeOptoutFor(email);
	if (optout.suppressed) { await finish(key, 'skipped', 'suppressed', now); return 'suppressed'; }

	let recordedDay = String(rcv.created_at ?? '').slice(0, 10);
	let newPromisedDate: string | null = null;
	if (row.claim_id != null) {
		const c = await db.execute({
			sql: `SELECT created_at FROM receivable_claims WHERE id = ? AND receivable_id = ? LIMIT 1`,
			args: [String(row.claim_id), String(rcv.id)],
		});
		if (c.rows.length) recordedDay = String((c.rows[0] as any).created_at ?? '').slice(0, 10);
	}
	if (kind === 'extended') {
		const ref = key.slice(key.indexOf(':') + 1);
		const e = await db.execute({
			sql: `SELECT new_promised_date FROM receivable_status_events WHERE id = ? AND receivable_id = ? LIMIT 1`,
			args: [ref, String(rcv.id)],
		});
		newPromisedDate = e.rows.length && (e.rows[0] as any).new_promised_date != null
			? String((e.rows[0] as any).new_promised_date) : null;
	}

	const base = baseUrl();
	const { subject, text } = buildClientActionEmail(kind, {
		receivableId: String(rcv.id),
		invoiceNo: String(rcv.invoice_no),
		face: Number(rcv.face),
		currency: String(rcv.currency),
		recordedDay,
		newPromisedDate,
	}, base, { optoutUrl: `${base}/api/verify/receivables/notice-optout?token=${encodeURIComponent(optout.token)}` });
	try {
		await sendMail({ to: email, subject, text });
	} catch (err) {
		await db.execute({
			sql: `UPDATE receivable_client_action_notices SET attempts = ? WHERE event_key = ?`,
			args: [Number(row.attempts ?? 0) + 1, key],
		});
		console.error('[receivables] client action notice send failed:', (err as Error)?.message ?? err);
		return 'failed';
	}
	await finish(key, 'sent', '', now);
	return 'sent';
}

/**
 * The action route's one call, after its write succeeded: queue the row (tenant-scoped) and try
 * the send. Never throws; the action already stands. The delivery runs on the owner pool, as a
 * system job: the client's address is another account's data, read only to address this email.
 */
export async function notifyClientOfAction(
	actorTenantId: string,
	kind: ClientActionKind,
	ref: string,
	now: Date = new Date(),
): Promise<ClientActionOutcome | null> {
	try {
		const key = await queueClientActionNotice(actorTenantId, kind, ref, now);
		if (!key) return null;
		return await runWithoutDbContext(() => deliverClientActionNotice(key, now));
	} catch (err) {
		console.error('[receivables] client action notice failed:', (err as Error)?.message ?? err);
		return null;
	}
}

export interface ClientActionRunCounts {
	clientActionsPending: number;
	clientActionsSent: number;
	clientActionsFailed: number;
	clientActionsSkipped: number;
}

/** The daily retry: every row still pending and younger than CLIENT_ACTION_RETRY_DAYS. */
export async function runClientActionNotices(now: Date = new Date()): Promise<ClientActionRunCounts> {
	await ensureReceivablesTables();
	const counts: ClientActionRunCounts = { clientActionsPending: 0, clientActionsSent: 0, clientActionsFailed: 0, clientActionsSkipped: 0 };
	const cutoff = stamp(new Date(now.getTime() - CLIENT_ACTION_RETRY_DAYS * DAY_MS));
	const r = await db.execute({
		sql: `SELECT event_key FROM receivable_client_action_notices
		       WHERE sent_at IS NULL AND skipped IS NULL AND created_at >= ?
		       ORDER BY created_at ASC LIMIT 500`,
		args: [cutoff],
	});
	counts.clientActionsPending = r.rows.length;
	for (const row of r.rows as any[]) {
		const outcome = await deliverClientActionNotice(String(row.event_key), now);
		if (outcome === 'sent') counts.clientActionsSent++;
		else if (outcome === 'failed') counts.clientActionsFailed++;
		else if (outcome !== 'done') counts.clientActionsSkipped++;
	}
	return counts;
}
