/**
 * The New accounts list on the owner's admin page, and the Accounts by country count above it.
 *
 * The list is every account, newest first by the time it was made. Each row answers the owner's
 * questions about a sign-up with what is already kept: when, from which country, for which
 * product, how the account signs in, when it last signed in and was last active, and a few
 * evidence tags.
 *
 * The tags are evidence, never a verdict. Nothing here prints "bot" or "customer": a wrong label
 * on a real person is worse than no label. Each tag is worked out when the page loads, and
 * nothing new is stored for it:
 *   - proven-sign-in  A linked Google or GitHub account, or a confirmed email address.
 *   - company-email   The address's domain is not a free-mail one (src/lib/freeMailDomains.ts).
 *   - set-up          The account has a record a person makes (src/lib/personRecords.ts).
 *   - at-limit        The account is on Verify's Free plan and has reached one of its caps
 *                     (src/lib/verifyPlans.ts, the numbers the Verify dashboard enforces).
 *   - verify-plan     The account is on a paid Verify plan today.
 *
 * Cross-tenant by design: called from the admin page only, behind requireAdminSession, with no
 * tenant context.
 */
import { db } from './db';
import { ensureAccountActivityColumns } from './accountActivity';
import { toDate } from './format';
import { isCompanyEmail } from './freeMailDomains';
import { accountIdsWithPersonRecords } from './personRecords';
import { isEmailVerifiedValue } from './sessionGate';
import { VERIFY_FREE_LIMITS, verifyPlanNameFor, type VerifyPlanName } from './verifyEntitlements';
import { isVerifyPaidPlan, type VerifyPaidPlanId } from './verifyPlans';
import { compareNewestFirst, verifyCountsByTenant } from './adminVerifySteps';

/** How many accounts the list shows. */
export const NEW_ACCOUNTS_LIMIT = 50;

/** The providers whose linked account proves a sign-in. */
const PROVING_PROVIDERS = ['google', 'github'] as const;

/** A way into an account, as src/lib/signupService.ts methodLabel names it. */
export type SignInMethod = 'google' | 'github' | 'email' | 'credentials';

export type EvidenceTagId = 'proven-sign-in' | 'company-email' | 'set-up' | 'at-limit' | 'verify-plan';

export interface EvidenceTag {
	id: EvidenceTagId;
	/** Only on verify-plan: which paid plan. */
	plan?: VerifyPaidPlanId;
}

/** What Verify holds for the account's active tenant. */
export interface AccountVerifyFacts {
	plan: VerifyPlanName;
	addresses: number;
	qrs: number;
}

/** Everything a row is worked out from. */
export interface NewAccountFacts {
	id: string;
	email: string | null;
	/** auth_users.email_verified as stored (TEXT; empty or null is unverified). */
	emailVerified: unknown;
	/** When the account was made (UTC, `YYYY-MM-DD HH:MM:SS`), or null for one from before that was kept. */
	createdAt: string | null;
	lastLogin: string | null;
	/** The two-letter country of the last sign-in. */
	lastLoginCountry: string | null;
	/** The product the account signed up for (a service id), or null when it was not saved. */
	signupService: string | null;
	/** The last UTC day a signed-in request was served, `YYYY-MM-DD`. */
	lastActiveOn: string | null;
	/** Provider ids of the linked accounts (google, github). */
	providers: string[];
	hasPassword: boolean;
	/** null when the check could not be read. */
	hasPersonRecords: boolean | null;
	/** null when the account has no tenant yet, or Verify could not be read. */
	verify: AccountVerifyFacts | null;
}

export interface NewAccountRow extends NewAccountFacts {
	methods: SignInMethod[];
	/** The later of the stored active day and the day of the last sign-in, or null for neither. */
	lastActiveDay: string | null;
	tags: EvidenceTag[];
}

/**
 * How the account signs in, from what is stored: its linked Google or GitHub accounts and its
 * password. An emailed link leaves no row of its own, so an account with neither can only have
 * been reached by one.
 */
export function signInMethods(a: Pick<NewAccountFacts, 'providers' | 'hasPassword'>): SignInMethod[] {
	const methods: SignInMethod[] = PROVING_PROVIDERS.filter((p) => a.providers.includes(p));
	if (a.hasPassword) methods.push('credentials');
	return methods.length ? methods : ['email'];
}

/** A linked Google or GitHub account, or a confirmed email address. */
export function isProvenSignIn(a: Pick<NewAccountFacts, 'providers' | 'emailVerified'>): boolean {
	return PROVING_PROVIDERS.some((p) => a.providers.includes(p)) || isEmailVerifiedValue(a.emailVerified);
}

/**
 * On Verify's Free plan and at one of its caps: the next address, or the next payment QR, would
 * be refused (createDestination in src/lib/verifyRegistry.ts counts the same way). A paid plan
 * or the owner's account is never "at limit" here.
 */
export function atVerifyFreeLimit(v: AccountVerifyFacts | null): boolean {
	if (!v || v.plan !== 'free') return false;
	const { address, qr, total } = VERIFY_FREE_LIMITS;
	return (
		(address !== null && v.addresses >= address) ||
		(qr !== null && v.qrs >= qr) ||
		(total !== null && v.addresses + v.qrs >= total)
	);
}

/** The later of the stored active day and the UTC day of the last sign-in. */
export function lastActiveDay(a: Pick<NewAccountFacts, 'lastActiveOn' | 'lastLogin'>): string | null {
	const signInDay = toDate(a.lastLogin)?.toISOString().slice(0, 10) ?? null;
	const days = [a.lastActiveOn, signInDay].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
	return days.length ? days[days.length - 1] : null;
}

/** The evidence tags of one account, in the order the row shows them. */
export function evidenceTags(a: NewAccountFacts): EvidenceTag[] {
	const tags: EvidenceTag[] = [];
	if (isProvenSignIn(a)) tags.push({ id: 'proven-sign-in' });
	if (isCompanyEmail(a.email)) tags.push({ id: 'company-email' });
	if (a.hasPersonRecords === true) tags.push({ id: 'set-up' });
	if (atVerifyFreeLimit(a.verify)) tags.push({ id: 'at-limit' });
	if (a.verify && isVerifyPaidPlan(a.verify.plan)) tags.push({ id: 'verify-plan', plan: a.verify.plan });
	return tags;
}

/** A row from its facts. */
export function toNewAccountRow(a: NewAccountFacts): NewAccountRow {
	return { ...a, methods: signInMethods(a), lastActiveDay: lastActiveDay(a), tags: evidenceTags(a) };
}

const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Newest first by the time the account was made; accounts with no such time last. */
export const NEW_ACCOUNTS_SQL = `SELECT u.id, u.email, u.email_verified, u.created_at, u.last_login, u.last_login_country,
	       u.signup_service, u.last_active_on, u.active_tenant_id,
	       EXISTS (SELECT 1 FROM auth_credentials c WHERE c.user_id = u.id) AS has_password,
	       (SELECT string_agg(DISTINCT a.provider, ',') FROM auth_accounts a WHERE a.user_id = u.id) AS providers
	  FROM auth_users u
	 ORDER BY u.created_at DESC NULLS LAST, u.id ASC
	 LIMIT ?`;

/** The Verify plan and destination counts of each tenant. Throws on a database error. */
async function verifyFactsByTenant(tenantIds: string[]): Promise<Map<string, AccountVerifyFacts>> {
	const out = new Map<string, AccountVerifyFacts>();
	if (!tenantIds.length) return out;
	// Also creates verify_subscriptions when it is missing (ensureVerifyTables).
	const counts = await verifyCountsByTenant(tenantIds);
	const plans = await db.execute({
		sql: `SELECT tenant_id, plan, status, paid_through FROM verify_subscriptions
		       WHERE tenant_id IN (${tenantIds.map(() => '?').join(', ')})`,
		args: tenantIds,
	});
	const planRows = new Map((plans.rows as Record<string, unknown>[]).map((r) => [String(r.tenant_id), r]));
	for (const tenantId of tenantIds) {
		const c = counts.get(tenantId);
		out.set(tenantId, {
			plan: verifyPlanNameFor(tenantId, planRows.get(tenantId)),
			addresses: c?.registered ?? 0,
			qrs: c?.qrs ?? 0,
		});
	}
	return out;
}

export interface NewAccountsView {
	rows: NewAccountRow[];
	/** False when the person-records check failed: no row carries the set-up tag. */
	recordsKnown: boolean;
	/** False when Verify could not be read: no row carries the at-limit or plan tag. */
	verifyKnown: boolean;
}

/**
 * The newest accounts with their tags. Throws when the accounts themselves cannot be read. The
 * two checks behind the tags each stand on their own: a failure is logged and reported in the
 * view, and the list still shows.
 */
export async function listNewAccounts(limit: number = NEW_ACCOUNTS_LIMIT): Promise<NewAccountsView> {
	// The two columns are added lazily; a failed ensure is not final (the migration may have run).
	await ensureAccountActivityColumns().catch(() => {});
	const res = await db.execute({ sql: NEW_ACCOUNTS_SQL, args: [limit] });
	const raw = res.rows as Record<string, unknown>[];
	const ids = raw.map((r) => String(r.id));
	const tenantOf = new Map(raw.map((r) => [String(r.id), text(r.active_tenant_id)]));
	const tenantIds = [...new Set([...tenantOf.values()].filter((t): t is string => !!t && t !== 'default'))];

	let withRecords: Set<string> | null = null;
	try {
		withRecords = await accountIdsWithPersonRecords(ids);
	} catch (error) {
		console.warn('[admin] new accounts: person-records check failed', message(error));
	}
	let verify: Map<string, AccountVerifyFacts> | null = null;
	try {
		verify = await verifyFactsByTenant(tenantIds);
	} catch (error) {
		console.warn('[admin] new accounts: Verify check failed', message(error));
	}

	const rows = raw
		.map((r): NewAccountFacts => {
			const id = String(r.id);
			const tenantId = tenantOf.get(id) ?? null;
			return {
				id,
				email: text(r.email),
				emailVerified: r.email_verified,
				createdAt: text(r.created_at),
				lastLogin: text(r.last_login),
				lastLoginCountry: text(r.last_login_country),
				signupService: text(r.signup_service),
				lastActiveOn: text(r.last_active_on),
				providers: String(r.providers ?? '').split(',').map((p) => p.trim()).filter(Boolean),
				hasPassword: toBool(r.has_password),
				hasPersonRecords: withRecords ? withRecords.has(id) : null,
				verify: (tenantId && verify?.get(tenantId)) || null,
			};
		})
		.sort(compareNewestFirst)
		.map(toNewAccountRow);
	return { rows, recordsKnown: withRecords !== null, verifyKnown: verify !== null };
}

export interface CountryCount {
	/** A two-letter country code, or null for accounts with no recorded sign-in country. */
	country: string | null;
	accounts: number;
}

/**
 * Accounts by the country of their last sign-in, most accounts first. It is where a sign-in
 * came from, so a VPN or a trip changes it; it is not a billing country. Throws on a database
 * error.
 */
export async function countAccountsByCountry(): Promise<CountryCount[]> {
	const res = await db.execute({
		sql: `SELECT last_login_country AS country, COUNT(*) AS accounts
		        FROM auth_users
		       GROUP BY last_login_country
		       ORDER BY COUNT(*) DESC, last_login_country ASC NULLS LAST`,
		args: [],
	});
	return (res.rows as Record<string, unknown>[]).map((r) => ({ country: text(r.country), accounts: Number(r.accounts ?? 0) }));
}
