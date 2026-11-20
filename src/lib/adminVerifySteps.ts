/**
 * The Verify steps table on the owner's admin page: for each account that signed up through
 * Verify, or that holds any Verify destination, how many wallet addresses it has registered,
 * claimed and verified, with totals above.
 *
 * The three steps are the ones the Verify dashboard shows for an address
 * (src/components/verify/VerifyDashboard.tsx), read from verify_destinations:
 *   - Registered: a row with kind = 'address'.
 *   - Claimed: its control is proven (proof_status = 'proven').
 *   - Verified: proven, anchored to a proven domain, and that anchor re-confirmed within the
 *     last 24 hours. Decided by merchantAddressAssurance (src/lib/verifyAnchor.ts), the same
 *     function the public lookup and the dashboard use, so this table never calls an address
 *     Verified that a payer's check would call Claimed.
 * Each step counts the ones after it: a verified address is also claimed and registered.
 *
 * A payment QR or link (kind = 'qr') is a destination but not an address. It is counted on its
 * own, so an account that registered only a QR is in the table with a reason to be there.
 *
 * Nothing is stored for this table: it is worked out when the page loads. Cross-tenant by
 * design: called from the admin page only, behind requireAdminSession, with no tenant context.
 */
import { db } from './db';
import { DEMO_TENANT_ID } from './demo';
import { ensureAccountActivityColumns } from './accountActivity';
import { ensureVerifyTables } from './verifyRegistry';
import { merchantAddressAssurance, staleCutoffUtc } from './verifyAnchor';

/** The id src/lib/signupService.ts gives a sign-in headed for Verify. */
export const VERIFY_SIGNUP_SERVICE = 'verify';

/** How many accounts the table lists, newest first. The totals cover every account. */
export const VERIFY_STEPS_LIMIT = 100;

/** The columns of a verify_destinations row that decide its step. */
export interface VerifyDestinationState {
	kind: string;
	proofStatus: string;
	proofMethod: string;
	proofDomain: string | null;
	provenAt: string | null;
	domainAnchoredAt: string | null;
	lastConfirmedAt: string | null;
}

export type VerifyStep = 'registered' | 'claimed' | 'verified';

export interface VerifyStepCounts {
	/** Wallet addresses registered, whatever their state. */
	registered: number;
	/** Of those, the ones whose control is proven. */
	claimed: number;
	/** Of those, the ones a payer's check answers Verified today. */
	verified: number;
	/** Payment QRs or links registered. */
	qrs: number;
}

const NONE: VerifyStepCounts = { registered: 0, claimed: 0, verified: 0, qrs: 0 };

/** The step one registered address has reached. `staleCutoff` is verifyAnchor's staleCutoffUtc(). */
export function verifyStepOf(d: VerifyDestinationState, staleCutoff: string): VerifyStep {
	if (d.proofStatus !== 'proven') return 'registered';
	return merchantAddressAssurance(
		{
			proofMethod: d.proofMethod,
			proofDomain: d.proofDomain,
			provenAt: d.provenAt,
			domainAnchoredAt: d.domainAnchoredAt,
			lastConfirmedAt: d.lastConfirmedAt,
		},
		staleCutoff,
	).level;
}

/** One account's destinations, counted by step. */
export function countVerifySteps(destinations: VerifyDestinationState[], staleCutoff: string): VerifyStepCounts {
	const counts = { ...NONE };
	for (const d of destinations) {
		if (d.kind === 'qr') {
			counts.qrs += 1;
			continue;
		}
		counts.registered += 1;
		const step = verifyStepOf(d, staleCutoff);
		if (step !== 'registered') counts.claimed += 1;
		if (step === 'verified') counts.verified += 1;
	}
	return counts;
}

const add = (a: VerifyStepCounts, b: VerifyStepCounts): VerifyStepCounts => ({
	registered: a.registered + b.registered,
	claimed: a.claimed + b.claimed,
	verified: a.verified + b.verified,
	qrs: a.qrs + b.qrs,
});

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/**
 * Every account's destinations counted by tenant, or only the given tenants'. The demo tenant
 * is left out. Throws on a database error.
 */
export async function verifyCountsByTenant(tenantIds?: string[]): Promise<Map<string, VerifyStepCounts>> {
	const out = new Map<string, VerifyStepCounts>();
	if (tenantIds && !tenantIds.length) return out;
	await ensureVerifyTables();
	const only = tenantIds ? ` AND tenant_id IN (${tenantIds.map(() => '?').join(', ')})` : '';
	const res = await db.execute({
		sql: `SELECT tenant_id, kind, proof_status, proof_method, proof_domain, proven_at, domain_anchored_at, last_confirmed_at
		        FROM verify_destinations
		       WHERE tenant_id <> ?${only}`,
		args: [DEMO_TENANT_ID, ...(tenantIds ?? [])],
	});
	const byTenant = new Map<string, VerifyDestinationState[]>();
	for (const r of res.rows as Record<string, unknown>[]) {
		const tenantId = String(r.tenant_id);
		const list = byTenant.get(tenantId) ?? [];
		list.push({
			kind: String(r.kind) === 'qr' ? 'qr' : 'address',
			proofStatus: String(r.proof_status ?? 'unproven'),
			proofMethod: String(r.proof_method ?? 'none'),
			proofDomain: text(r.proof_domain),
			provenAt: text(r.proven_at),
			domainAnchoredAt: text(r.domain_anchored_at),
			lastConfirmedAt: text(r.last_confirmed_at),
		});
		byTenant.set(tenantId, list);
	}
	const cutoff = staleCutoffUtc();
	for (const [tenantId, list] of byTenant) out.set(tenantId, countVerifySteps(list, cutoff));
	return out;
}

export interface VerifyStepRow {
	userId: string;
	email: string | null;
	/** When the account was made, or null for one from before that was kept. */
	createdAt: string | null;
	/** The product the account signed up for (a service id), or null when it was not saved. */
	signupService: string | null;
	/** The tenants this account belongs to that the counts were read from. */
	tenantIds: string[];
	counts: VerifyStepCounts;
}

export interface VerifyStepTotals {
	/** Accounts in the table. */
	accounts: number;
	/** Accounts that reached each step with at least one address. */
	registered: number;
	claimed: number;
	verified: number;
	/** Addresses at each step, each tenant counted once. */
	addresses: { registered: number; claimed: number; verified: number };
}

/**
 * Totals over the rows. An account counts toward a step when it has at least one address
 * there. Two sign-ins of one person (Google and GitHub on the same address) share a tenant, so
 * the address totals count each tenant once.
 */
export function verifyStepTotals(rows: VerifyStepRow[], byTenant: Map<string, VerifyStepCounts>): VerifyStepTotals {
	const tenants = new Set(rows.flatMap((r) => r.tenantIds));
	let addresses = { ...NONE };
	for (const id of tenants) addresses = add(addresses, byTenant.get(id) ?? NONE);
	return {
		accounts: rows.length,
		registered: rows.filter((r) => r.counts.registered > 0).length,
		claimed: rows.filter((r) => r.counts.claimed > 0).length,
		verified: rows.filter((r) => r.counts.verified > 0).length,
		addresses: { registered: addresses.registered, claimed: addresses.claimed, verified: addresses.verified },
	};
}

/** Newest sign-up first; accounts with no sign-up time last; then by id, so the order is stable. */
export function compareNewestFirst(a: { createdAt: string | null; id: string }, b: { createdAt: string | null; id: string }): number {
	if (a.createdAt !== b.createdAt) {
		if (a.createdAt === null) return 1;
		if (b.createdAt === null) return -1;
		return a.createdAt < b.createdAt ? 1 : -1;
	}
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface VerifyStepsView {
	/** The newest VERIFY_STEPS_LIMIT accounts. */
	rows: VerifyStepRow[];
	/** Over every account, shown or not. */
	totals: VerifyStepTotals;
}

/** The table and its totals. Throws on a database error. */
export async function listVerifySteps(): Promise<VerifyStepsView> {
	// signup_service is added lazily; a failed ensure is not final (the migration may have run).
	await ensureAccountActivityColumns().catch(() => {});
	const byTenant = await verifyCountsByTenant();
	const res = await db.execute({
		sql: `SELECT u.id, u.email, u.created_at, u.signup_service, tm.tenant_id
		        FROM auth_users u
		        LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
		       WHERE u.signup_service = ?
		          OR tm.tenant_id IN (SELECT d.tenant_id FROM verify_destinations d WHERE d.tenant_id <> ?)`,
		args: [VERIFY_SIGNUP_SERVICE, DEMO_TENANT_ID],
	});
	const byUser = new Map<string, VerifyStepRow>();
	for (const r of res.rows as Record<string, unknown>[]) {
		const userId = String(r.id);
		const row = byUser.get(userId) ?? {
			userId,
			email: text(r.email),
			createdAt: text(r.created_at),
			signupService: text(r.signup_service),
			tenantIds: [],
			counts: { ...NONE },
		};
		const tenantId = text(r.tenant_id);
		if (tenantId && tenantId !== DEMO_TENANT_ID && !row.tenantIds.includes(tenantId)) {
			row.tenantIds.push(tenantId);
			row.counts = add(row.counts, byTenant.get(tenantId) ?? NONE);
		}
		byUser.set(userId, row);
	}
	const all = [...byUser.values()].sort((a, b) =>
		compareNewestFirst({ createdAt: a.createdAt, id: a.userId }, { createdAt: b.createdAt, id: b.userId }),
	);
	return { rows: all.slice(0, VERIFY_STEPS_LIMIT), totals: verifyStepTotals(all, byTenant) };
}
