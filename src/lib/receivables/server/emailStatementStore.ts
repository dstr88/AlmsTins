/**
 * Email statement (approved 2026-11-28): the server half. Who may see a claim's statement, the
 * four email groups read from the logs that already exist, the forecast, and the signed record a
 * download makes.
 *
 * Rules held here, each pinned by tests/receivables/emailStatement.test.ts:
 *   - who sees it: the claim's own lender (its tenant holds the claim) and the receivable's client
 *     (the accepted borrower account, the party the client emails go to). Nobody else: not the
 *     debtor, not another lender, not a stranger holding the ID. A signed-out visitor never
 *     reaches here (the route answers 401).
 *   - what it reads: per claim, the notice log (scheduled), the summary claims table and the
 *     update request rows (interested parties, client), the client action outbox (lender acted).
 *     Only days, kinds, recipient roles and template versions are selected: never an address, a
 *     note, a requester account or any email text.
 *   - a daily summary counts once per claim per day, however many requests it rolled up.
 *   - the plan-lock email is account mail about the lender's own plan, not about the claim, so it
 *     is left out (another party must never learn an account's plan state).
 *   - making a statement sends nothing. A download signs and stores one, stamps it to Bitcoin, and
 *     hands back its proof file; a later download makes a new one with a new as-of time.
 */
import { db } from '@/lib/db';
import {
	ensureReceivablesTables,
	getReceivableStatus,
	getRecordProofSource,
	receivableEmailTemplateReady,
	recordEmailStatement,
} from '@/lib/receivablesRegistry';
import { isClientOf } from './updateRequestStore';
import { anchorNow, evidenceStampLimiter } from './anchorNow';
import { buildRecordProofFile, type RecordProofFile } from './proofFile';
import {
	EMAIL_GROUPS,
	forecastNext,
	statementView,
	templateFile,
	type EmailEntry,
	type EmailGroup,
	type EmailGroups,
	type NextScheduled,
	type StatementView,
} from '@/lib/receivables/emailStatement';
import { ES_SENT_NOTE } from '@/lib/receivables/copy/emailStatement';

const stamp = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 19);
const day = (v: unknown): string => String(v ?? '').slice(0, 10);
const version = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The scheduled notice kinds a statement counts (the plan lock is account mail, left out). */
const SCHEDULED_KINDS = new Set(['day9', 'day15', 'day20', 'lapse_warn', 'lapsed']);

export type StatementRole = 'lender' | 'client';

/** One claim a viewer may see a statement for, with what names it on screen. */
export interface StatementClaim {
	claimId: string;
	lenderTenantId: string;
	financier: string;
	amount: number;
	currency: string;
	role: StatementRole;
}

/**
 * The claims on this receivable whose statement this account may see: its own claims as their
 * lender, or every claim as the receivable's client. Empty for anyone else.
 */
export async function statementClaimsFor(tenantId: string, receivableId: string): Promise<StatementClaim[]> {
	await ensureReceivablesTables();
	const r = await db.execute({
		sql: `SELECT id, tenant_id, financier, amount, currency, created_at FROM receivable_claims
		       WHERE receivable_id = ? ORDER BY created_at`,
		args: [receivableId],
	});
	const rows = r.rows as any[];
	if (!rows.length) return [];
	const client = await isClientOf(tenantId, receivableId);
	return rows.flatMap((c): StatementClaim[] => {
		const own = String(c.tenant_id) === tenantId;
		if (!own && !client) return [];
		return [{
			claimId: String(c.id),
			lenderTenantId: String(c.tenant_id),
			financier: String(c.financier ?? ''),
			amount: Number(c.amount),
			currency: String(c.currency ?? ''),
			role: own ? 'lender' : 'client',
		}];
	});
}

/** Every email Almstins sent about one claim, by group, oldest first. */
export async function loadEmailGroups(receivableId: string, claim: { claimId: string; lenderTenantId: string }): Promise<EmailGroups> {
	await ensureReceivablesTables();
	const tv = receivableEmailTemplateReady();
	const tcol = tv ? ', template_version' : '';
	const groups: EmailGroups = { scheduled: [], interested: [], client: [], lender_acted: [] };

	const notices = await db.execute({
		sql: `SELECT notice, recipient_role, sent_at${tcol} FROM receivable_notice_log WHERE claim_id = ?`,
		args: [claim.claimId],
	});
	for (const n of notices.rows as any[]) {
		if (!SCHEDULED_KINDS.has(String(n.notice))) continue;
		groups.scheduled.push({
			day: day(n.sent_at), type: String(n.notice),
			to: String(n.recipient_role) === 'client' ? 'client' : 'lender',
			template: version(n.template_version),
		});
	}

	// Interested parties: the summaries that covered this claim, one per (claim, day).
	const summaries = await db.execute({
		sql: `SELECT day, template_version FROM receivable_update_summary_claims WHERE claim_id = ?`,
		args: [claim.claimId],
	});
	const summaryDays = new Set<string>();
	for (const s of summaries.rows as any[]) {
		summaryDays.add(String(s.day));
		groups.interested.push({ day: String(s.day), type: 'summary', to: 'lender', template: version(s.template_version) });
	}
	// Summaries sent before the claims table existed: an anonymous request row still marked
	// emailed, on a day the lender's digest row confirms one summary went out.
	const requests = await db.execute({
		sql: `SELECT source, emailed_at${tcol} FROM receivable_update_requests
		       WHERE claim_id = ? AND emailed_at IS NOT NULL`,
		args: [claim.claimId],
	});
	const older = new Set<string>();
	for (const q of requests.rows as any[]) {
		if (String(q.source) === 'client') {
			groups.client.push({ day: day(q.emailed_at), type: 'client_request', to: 'lender', template: version(q.template_version) });
		} else if (!summaryDays.has(day(q.emailed_at))) {
			older.add(day(q.emailed_at));
		}
	}
	if (older.size) {
		const digests = await db.execute({
			sql: `SELECT day${tcol} FROM receivable_update_request_digests
			       WHERE lender_tenant_id = ? AND day IN (${[...older].map(() => '?').join(', ')})`,
			args: [claim.lenderTenantId, ...older],
		});
		for (const d of digests.rows as any[]) {
			groups.interested.push({ day: String(d.day), type: 'summary', to: 'lender', template: version(d.template_version) });
		}
	}

	// Lender acted: this claim's actions, and the receivable's settlement.
	const actions = await db.execute({
		sql: `SELECT kind, claim_id, sent_at${tcol} FROM receivable_client_action_notices
		       WHERE receivable_id = ? AND sent_at IS NOT NULL`,
		args: [receivableId],
	});
	for (const a of actions.rows as any[]) {
		const mine = a.claim_id != null ? String(a.claim_id) === claim.claimId : String(a.kind) === 'settled';
		if (!mine) continue;
		groups.lender_acted.push({ day: day(a.sent_at), type: String(a.kind), to: 'client', template: version(a.template_version) });
	}

	for (const g of EMAIL_GROUPS) groups[g].sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type));
	return groups;
}

/** The earliest send each log holds, set once. See schema.ts CREATE_EMAIL_LOG_EPOCHS. */
const EPOCH_SOURCES: Record<EmailGroup, string> = {
	scheduled: `SELECT sent_at AS at FROM receivable_notice_log ORDER BY sent_at ASC LIMIT 1`,
	interested: `SELECT sent_at AS at FROM receivable_update_request_digests ORDER BY sent_at ASC LIMIT 1`,
	client: `SELECT emailed_at AS at FROM receivable_update_requests WHERE source = 'client' AND emailed_at IS NOT NULL ORDER BY emailed_at ASC LIMIT 1`,
	lender_acted: `SELECT sent_at AS at FROM receivable_client_action_notices WHERE sent_at IS NOT NULL ORDER BY sent_at ASC LIMIT 1`,
};

/** From which day each email log holds emails (YYYY-MM-DD). */
export async function emailLogEpochs(now: Date): Promise<Record<EmailGroup, string>> {
	await ensureReceivablesTables();
	const out = {} as Record<EmailGroup, string>;
	const known = await db.execute({ sql: `SELECT log, since FROM receivable_email_log_epochs`, args: [] });
	const have = new Map((known.rows as any[]).map((r) => [String(r.log), String(r.since)]));
	for (const g of EMAIL_GROUPS) {
		let since = have.get(g);
		if (!since) {
			const first = await db.execute({ sql: EPOCH_SOURCES[g], args: [] });
			const at = (first.rows[0] as any)?.at;
			await db.execute({
				sql: `INSERT INTO receivable_email_log_epochs (log, since) VALUES (?, ?) ON CONFLICT (log) DO NOTHING`,
				args: [g, at != null ? String(at) : stamp(now)],
			});
			const again = await db.execute({ sql: `SELECT since FROM receivable_email_log_epochs WHERE log = ?`, args: [g] });
			since = String((again.rows[0] as any)?.since ?? stamp(now));
		}
		out[g] = day(since);
	}
	return out;
}

/** The forecast's facts for one claim, from its public status and the notice log. */
async function nextScheduledFor(receivableId: string, claimId: string, groups: EmailGroups, now: Date): Promise<NextScheduled | null> {
	const rcv = await getReceivableStatus(receivableId, now);
	const c = rcv?.claims.find((x) => x.id === claimId);
	if (!rcv || !c) return null;
	const sent = new Set(groups.scheduled.filter((e) => e.to === 'lender').map((e) => e.type));
	return forecastNext({
		open: c.status === 'active' && !rcv.settled && rcv.withdrawn !== true && !rcv.isTest,
		promisedDate: c.promisedDate,
		lastOwnerTouchAt: c.lastOwnerTouchAt,
		sent,
	}, now);
}

/** One claim's statement as the viewer sees it, plus everything its manifest carries. */
export interface ClaimStatement {
	claim: StatementClaim;
	asOf: string;
	groups: EmailGroups;
	next: NextScheduled | null;
	since: Record<EmailGroup, string>;
	view: StatementView;
}

export async function claimStatement(receivableId: string, claim: StatementClaim, now: Date): Promise<ClaimStatement> {
	const asOf = stamp(now);
	const groups = await loadEmailGroups(receivableId, claim);
	const next = await nextScheduledFor(receivableId, claim.claimId, groups, now);
	const since = await emailLogEpochs(now);
	return { claim, asOf, groups, next, since, view: statementView(asOf, groups, next, since) };
}

/** Every statement this account may see on one receivable. A read: nothing is signed or sent. */
export async function listStatementsFor(tenantId: string, receivableId: string, now: Date = new Date()): Promise<ClaimStatement[]> {
	const claims = await statementClaimsFor(tenantId, receivableId);
	const out: ClaimStatement[] = [];
	for (const c of claims) out.push(await claimStatement(receivableId, c, now));
	return out;
}

/**
 * The signed manifest: claim, as-of time, the groups with each email's day, type, recipient role
 * and template version, the forecast (labelled, never counted), where history starts, where each
 * template lives, and the statement's own lines. Roles and dates only, nothing about a person.
 */
export function statementManifest(receivableId: string, st: ClaimStatement): Record<string, unknown> {
	const strip = (e: EmailEntry) => ({ day: e.day, type: e.type, to: e.to, template: e.template });
	const emails = Object.fromEntries(EMAIL_GROUPS.map((g) => [g, st.groups[g].map(strip)]));
	const counts = Object.fromEntries(EMAIL_GROUPS.map((g) => [g, st.groups[g].length]));
	const versions = [...new Set(EMAIL_GROUPS.flatMap((g) => st.groups[g].map((e) => e.template)).filter((v): v is string => !!v))].sort();
	const templates = Object.fromEntries(versions.map((v) => [v, templateFile(v)]));
	const statement = [st.view.head, ...st.view.lines, ...(st.view.next ? [st.view.next] : []), st.view.history];
	return {
		v: 1,
		kind: 'email_statement',
		receivableId,
		claimId: st.claim.claimId,
		asOf: st.asOf,
		viewer: st.claim.role,
		counts,
		emails,
		next: st.next ? { type: st.next.type, day: st.next.day, forecast: true } : null,
		historyStarts: st.since,
		templates,
		statement,
		note: ES_SENT_NOTE,
	};
}

export type StatementFileResult =
	| { ok: true; file: RecordProofFile; id: string }
	| { ok: false; error: 'not_found' | 'record_unreadable' };

/**
 * A download: build the claim's statement as of now, sign and store it under the viewer's
 * account, stamp it to Bitcoin (best effort; the anchor cron retries a stamp that failed), and
 * hand back its proof file. not_found when the viewer may not see this claim's statement.
 */
export async function makeStatementFile(tenantId: string, claimId: string, now: Date = new Date()): Promise<StatementFileResult> {
	await ensureReceivablesTables();
	const r = await db.execute({
		sql: `SELECT receivable_id FROM receivable_claims WHERE id = ? LIMIT 1`,
		args: [claimId],
	});
	const receivableId = r.rows.length ? String((r.rows[0] as any).receivable_id) : null;
	if (!receivableId) return { ok: false, error: 'not_found' };
	const claim = (await statementClaimsFor(tenantId, receivableId)).find((c) => c.claimId === claimId);
	if (!claim) return { ok: false, error: 'not_found' };

	const st = await claimStatement(receivableId, claim, now);
	const rec = await recordEmailStatement(tenantId, {
		receivableId, claimId, viewerRole: claim.role, asOf: st.asOf, manifest: statementManifest(receivableId, st),
	});
	await anchorNow(tenantId, 'email_statement', rec.id, evidenceStampLimiter);
	const src = await getRecordProofSource(tenantId, 'email_statement', rec.id);
	const file = src ? buildRecordProofFile('email_statement', rec.id, src) : null;
	if (!file) return { ok: false, error: 'record_unreadable' };
	return { ok: true, file, id: rec.id };
}
