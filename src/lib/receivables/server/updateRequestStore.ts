/**
 * Update requests (Part A, approved 2026-11-28) — the server half: storing a request, the answer
 * each viewer gets about a record, the client request's immediate email to the lender, and the
 * daily summary of anonymous requests (run by the notices cron).
 *
 * Rules held here, each pinned by tests/receivables/updateRequests.test.ts:
 *   - who may ask comes from updateRequests.ts (canAskUpdate) on the record's PUBLIC status, so the
 *     answer is the one the public lookup shows; a withdrawn record refuses (410 in the route).
 *   - an anonymous request is one row per claim per day; a client request one row per click.
 *   - the requester is never named to the lender unless it is the client; the lender's address
 *     never leaves this module; a note is read back only for the claim's own lender.
 *   - a test record emails nobody; a claim already answered (no longer askable) is not summarized.
 *   - every read is scoped: lender rows by lender_tenant_id, client rows by requester_tenant_id,
 *     the public answer is day counts per claim and nothing else.
 *   - the lender's emails go through sendMail like the aging notices; addresses resolve on the
 *     owner pool (runWithoutDbContext), the trusted path for one account emailing another.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { runWithoutDbContext } from '@/lib/dbContext';
import { sendMail } from '@/lib/email';
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import {
	ensureReceivablesTables,
	getReceivableStatus,
	receivableEmailTemplateReady,
	type PublicClaim,
	type ReceivableStatus,
} from '@/lib/receivablesRegistry';
import {
	buildClientRequestEmail,
	buildRequestSummaryEmail,
	canAskUpdate,
	groupForSummary,
	requestDaysOf,
	SUMMARY_LOOKBACK_DAYS,
	type RequestDays,
	type RequestDeal,
	type RequestSource,
	type RequestViewer,
	type SummaryItem,
} from '@/lib/receivables/updateRequests';
import { UR_TEMPLATE_VERSION } from '@/lib/receivables/copy/updateRequests';

const DAY_MS = 86_400_000;
const stamp = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);
const baseUrl = (): string => (process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');

/** The record and claim a request is about, with the claim's lender. */
export interface RequestContext {
	rcv: ReceivableStatus;
	claim: PublicClaim;
	lenderTenantId: string;
}

/** The public status of the record and the claim on it, or null when either is unknown. */
export async function loadRequestContext(receivableId: string, claimId: string, now: Date = new Date()): Promise<RequestContext | null> {
	await ensureReceivablesTables();
	const rcv = await getReceivableStatus(receivableId, now);
	if (!rcv) return null;
	const claim = rcv.claims.find((c) => c.id === claimId);
	if (!claim) return null;
	const r = await db.execute({
		sql: `SELECT tenant_id FROM receivable_claims WHERE id = ? AND receivable_id = ? LIMIT 1`,
		args: [claimId, receivableId],
	});
	if (!r.rows.length) return null;
	return { rcv, claim, lenderTenantId: String((r.rows[0] as any).tenant_id) };
}

/** Whether this account is the record's client: the accepted borrower account (clientNoticeTarget's party). */
export async function isClientOf(tenantId: string, receivableId: string): Promise<boolean> {
	await ensureReceivablesTables();
	const r = await db.execute({
		sql: `SELECT 1 FROM receivable_access WHERE receivable_id = ? AND tenant_id = ? AND role = 'borrower' AND revoked_at IS NULL LIMIT 1`,
		args: [receivableId, tenantId],
	});
	return r.rows.length > 0;
}

/** The accounts that hold a claim on this record (for the lender view). */
async function lenderClaimIds(tenantId: string, receivableId: string): Promise<Set<string>> {
	const r = await db.execute({
		sql: `SELECT id FROM receivable_claims WHERE receivable_id = ? AND tenant_id = ?`,
		args: [receivableId, tenantId],
	});
	return new Set((r.rows as any[]).map((x) => String(x.id)));
}

/**
 * Store one request. Anonymous: one row per claim per day (a repeat bumps clicks and last_at, and
 * clears emailed_at and skipped, so a click after today's summary rides the next one).
 * Client: a new row each time. Returns the row id and the moment of this request.
 */
export async function recordUpdateRequest(
	ctx: RequestContext,
	source: RequestSource,
	opts: { requesterTenantId?: string; note?: string | null } = {},
	now: Date = new Date(),
): Promise<{ id: string; askedAt: string }> {
	await ensureReceivablesTables();
	const at = stamp(now);
	const day = at.slice(0, 10);
	const id = source === 'public' ? `pub:${ctx.claim.id}:${day}` : randomUUID();
	await db.execute({
		sql: `INSERT INTO receivable_update_requests
		        (id, claim_id, receivable_id, lender_tenant_id, source, requester_tenant_id, day, note, clicks, first_at, last_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		      ON CONFLICT (id) DO UPDATE SET clicks = receivable_update_requests.clicks + 1, last_at = excluded.last_at,
		        emailed_at = excluded.emailed_at, skipped = excluded.skipped`,
		args: [
			id, ctx.claim.id, ctx.rcv.id, ctx.lenderTenantId, source,
			source === 'client' ? (opts.requesterTenantId ?? null) : null,
			day, source === 'client' ? (opts.note ?? null) : null, 1, at, at,
		],
	});
	return { id, askedAt: at };
}

function dealOf(ctx: RequestContext): RequestDeal {
	return {
		receivableId: ctx.rcv.id,
		invoiceNo: ctx.rcv.invoiceNo,
		face: ctx.rcv.face,
		currency: ctx.rcv.currency,
		promisedDate: ctx.claim.promisedDate,
		recordedDay: String(ctx.claim.registeredAt ?? '').slice(0, 10),
		aging: ctx.claim.aging,
	};
}

export type LenderEmailOutcome = 'sent' | 'failed' | 'test' | 'no_address';

/** A client request's email to the lender, at once (every click). Never throws. */
export async function emailLenderAboutClientRequest(
	ctx: RequestContext,
	requestId: string,
	note: string | null,
	now: Date = new Date(),
): Promise<LenderEmailOutcome> {
	const mark = (field: 'emailed_at' | 'skipped', value: string) => db.execute({
		sql: `UPDATE receivable_update_requests SET ${field} = ? WHERE id = ?`,
		args: [value, requestId],
	});
	try {
		if (ctx.rcv.isTest) { await mark('skipped', 'test'); return 'test'; }
		const email = (await runWithoutDbContext(() => resolveAlertRecipient(ctx.lenderTenantId))).email;
		if (!email) { await mark('skipped', 'no_address'); return 'no_address'; }
		const { subject, text } = buildClientRequestEmail(dealOf(ctx), note, baseUrl());
		await sendMail({ to: email, subject, text });
		await mark('emailed_at', stamp(now));
		// The template version the email used (email statement), once the column exists.
		if (receivableEmailTemplateReady()) {
			await db.execute({
				sql: `UPDATE receivable_update_requests SET template_version = ? WHERE id = ?`,
				args: [UR_TEMPLATE_VERSION, requestId],
			});
		}
		return 'sent';
	} catch (err) {
		console.error('[receivables] update request email failed:', (err as Error)?.message ?? err);
		return 'failed';
	}
}

/** One claim's lines in the answer a viewer gets. */
export interface ClaimRequestView {
	claimId: string;
	canAsk: boolean;
	/** The public line's facts: distinct days with a request, from any source. */
	requested: RequestDays;
	/** True on the lender view for the lender's own claims. */
	own?: boolean;
	/** Client requests: for the lender (own claims, notes included) or the client (its own, no note). */
	clientRequests?: Array<{ at: string; note: string | null }>;
}

/** What one viewer sees about requests on a record. The public part is day counts only. */
export async function requestViewFor(
	rcv: ReceivableStatus,
	viewer: { tenantId: string | null },
): Promise<{ viewer: RequestViewer; claims: ClaimRequestView[] }> {
	await ensureReceivablesTables();
	const tenantId = viewer.tenantId;
	const isClient = tenantId ? await isClientOf(tenantId, rcv.id) : false;
	const own = tenantId && !isClient ? await lenderClaimIds(tenantId, rcv.id) : new Set<string>();
	const role: RequestViewer = isClient ? 'client' : own.size ? 'lender' : 'public';

	const days = await db.execute({
		sql: `SELECT claim_id, day FROM receivable_update_requests WHERE receivable_id = ?`,
		args: [rcv.id],
	});
	const daysBy = new Map<string, string[]>();
	for (const row of days.rows as any[]) {
		const k = String(row.claim_id);
		daysBy.set(k, [...(daysBy.get(k) ?? []), String(row.day)]);
	}

	let clientRows: any[] = [];
	if (role === 'lender') {
		const r = await db.execute({
			sql: `SELECT claim_id, last_at, note FROM receivable_update_requests
			       WHERE receivable_id = ? AND lender_tenant_id = ? AND source = 'client' ORDER BY last_at DESC`,
			args: [rcv.id, tenantId],
		});
		clientRows = r.rows as any[];
	} else if (role === 'client') {
		const r = await db.execute({
			sql: `SELECT claim_id, last_at FROM receivable_update_requests
			       WHERE receivable_id = ? AND requester_tenant_id = ? AND source = 'client' ORDER BY last_at DESC`,
			args: [rcv.id, tenantId],
		});
		clientRows = r.rows as any[];
	}

	const claims: ClaimRequestView[] = rcv.claims.map((c) => {
		const view: ClaimRequestView = {
			claimId: c.id,
			canAsk: canAskUpdate(role, { settled: rcv.settled, withdrawn: rcv.withdrawn === true }, c),
			requested: requestDaysOf(daysBy.get(c.id) ?? []),
		};
		if (role === 'lender') {
			view.own = own.has(c.id);
			if (view.own) {
				view.clientRequests = clientRows.filter((x) => String(x.claim_id) === c.id)
					.map((x) => ({ at: String(x.last_at), note: x.note != null ? String(x.note) : null }));
			}
		} else if (role === 'client') {
			view.clientRequests = clientRows.filter((x) => String(x.claim_id) === c.id)
				.map((x) => ({ at: String(x.last_at), note: null }));
		}
		return view;
	});
	return { viewer: role, claims };
}

export interface SummaryRunCounts {
	updateRequestsPending: number;
	updateSummariesSent: number;
	updateSummariesFailed: number;
	updateRequestsSkipped: number;
}

/**
 * The daily summary: every anonymous request not yet emailed (within SUMMARY_LOOKBACK_DAYS),
 * one email per lender, at most one per lender per UTC day. A request on a test or withdrawn
 * record, or on a claim the lender has answered since (no longer askable), is skipped for good.
 */
export async function runUpdateRequestSummaries(now: Date = new Date()): Promise<SummaryRunCounts> {
	await ensureReceivablesTables();
	const counts: SummaryRunCounts = { updateRequestsPending: 0, updateSummariesSent: 0, updateSummariesFailed: 0, updateRequestsSkipped: 0 };
	const since = stamp(new Date(now.getTime() - SUMMARY_LOOKBACK_DAYS * DAY_MS)).slice(0, 10);
	const r = await db.execute({
		sql: `SELECT id, claim_id, receivable_id, lender_tenant_id, day FROM receivable_update_requests
		       WHERE source = 'public' AND emailed_at IS NULL AND skipped IS NULL AND day >= ?
		       ORDER BY day ASC LIMIT 2000`,
		args: [since],
	});
	const rows = (r.rows as any[]).map((x) => ({
		id: String(x.id), claimId: String(x.claim_id), receivableId: String(x.receivable_id),
		lenderTenantId: String(x.lender_tenant_id), day: String(x.day),
	}));
	counts.updateRequestsPending = rows.length;
	if (!rows.length) return counts;

	const skip = async (ids: string[], why: string) => {
		for (const id of ids) {
			await db.execute({ sql: `UPDATE receivable_update_requests SET skipped = ? WHERE id = ?`, args: [why, id] });
			counts.updateRequestsSkipped++;
		}
	};
	const today = stamp(now).slice(0, 10);
	const statusCache = new Map<string, ReceivableStatus | null>();

	for (const [lender, byClaim] of groupForSummary(rows)) {
		const sentToday = await db.execute({
			sql: `SELECT 1 FROM receivable_update_request_digests WHERE lender_tenant_id = ? AND day = ? LIMIT 1`,
			args: [lender, today],
		});
		if (sentToday.rows.length) continue; // tomorrow's summary carries them

		const items: SummaryItem[] = [];
		const ids: string[] = [];
		const claimIds: string[] = [];
		for (const [claimId, list] of byClaim) {
			const rid = list[0].receivableId;
			if (!statusCache.has(rid)) statusCache.set(rid, await getReceivableStatus(rid, now));
			const rcv = statusCache.get(rid) ?? null;
			const claim = rcv?.claims.find((c) => c.id === claimId);
			const listIds = list.map((x) => x.id);
			if (!rcv || !claim) { await skip(listIds, 'missing'); continue; }
			if (rcv.isTest) { await skip(listIds, 'test'); continue; }
			if (rcv.withdrawn) { await skip(listIds, 'withdrawn'); continue; }
			if (!canAskUpdate('public', { settled: rcv.settled }, claim)) { await skip(listIds, 'answered'); continue; }
			items.push({ deal: dealOf({ rcv, claim, lenderTenantId: lender }), days: list.map((x) => x.day) });
			ids.push(...listIds);
			claimIds.push(claimId);
		}
		if (!items.length) continue;

		const email = (await resolveAlertRecipient(lender)).email;
		if (!email) { await skip(ids, 'no_address'); continue; }
		const { subject, text } = buildRequestSummaryEmail(items, baseUrl());
		try {
			await sendMail({ to: email, subject, text });
		} catch (err) {
			counts.updateSummariesFailed++;
			console.error('[receivables-notices] update summary send failed:', (err as Error)?.message ?? err);
			continue; // nothing marked: the next run retries
		}
		counts.updateSummariesSent++;
		const withVersion = receivableEmailTemplateReady();
		await db.execute(withVersion
			? {
				sql: `INSERT INTO receivable_update_request_digests (lender_tenant_id, day, sent_at, template_version) VALUES (?, ?, ?, ?)
				      ON CONFLICT (lender_tenant_id, day) DO NOTHING`,
				args: [lender, today, stamp(now), UR_TEMPLATE_VERSION],
			}
			: {
				sql: `INSERT INTO receivable_update_request_digests (lender_tenant_id, day, sent_at) VALUES (?, ?, ?)
				      ON CONFLICT (lender_tenant_id, day) DO NOTHING`,
				args: [lender, today, stamp(now)],
			});
		// Which claims this one summary covered (email statement): one row per claim, so a claim's
		// statement counts the summary once however many requests it rolled up.
		for (const claimId of claimIds) {
			await db.execute({
				sql: `INSERT INTO receivable_update_summary_claims (claim_id, day, lender_tenant_id, sent_at, template_version)
				      VALUES (?, ?, ?, ?, ?)
				      ON CONFLICT (claim_id, day) DO NOTHING`,
				args: [claimId, today, lender, stamp(now), UR_TEMPLATE_VERSION],
			});
		}
		for (const id of ids) {
			await db.execute({ sql: `UPDATE receivable_update_requests SET emailed_at = ? WHERE id = ?`, args: [stamp(now), id] });
		}
	}
	return counts;
}
