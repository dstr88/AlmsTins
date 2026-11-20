/**
 * The records a person makes or adds in Almstins, and the two things the owner's admin page
 * works out from them:
 *
 *   - "Set something up": the account has at least one such record (the New accounts list,
 *     src/lib/adminNewAccounts.ts).
 *   - Abandoned: the account signed up and never came back (the red outline on the Recent users
 *     list, src/pages/admin/index.astro).
 *
 * Both read the same table list, so the two can never disagree about what counts as a record.
 * Cross-tenant by design: these run from the admin page only, behind requireAdminSession, with
 * no tenant context.
 */
import { db } from './db';
import { ensureAccountActivityColumns } from './accountActivity';

/**
 * Tables that hold what a person makes or adds: wallets, imports, documents, receivables,
 * Verify, Agent Vault and the milestone desk. Each is keyed by tenant_id. The names are fixed
 * here and never come from a request, so they are safe to place in SQL.
 */
export const PERSON_RECORD_TABLES = [
	'wallets', 'transactions', 'import_transactions', 'exchange_accounts',
	'transaction_screenshots', 'petro_tins', 'verify_destinations', 'verify_agent_keys', 'verify_claimed_names',
	'agent_tins', 'receivables', 'receivable_claims', 'receivable_attestations', 'receivable_documents',
	'cairn_projects', 'cairn_documents',
] as const;

/**
 * SQL that is true when the auth_users row aliased `userAlias` has any of those records, in any
 * tenant it belongs to.
 */
export function hasPersonRecordsSql(userAlias = 'u'): string {
	return PERSON_RECORD_TABLES
		.map((t) => `EXISTS (SELECT 1 FROM ${t} x WHERE x.tenant_id IN (SELECT tm2.tenant_id FROM tenant_memberships tm2 WHERE tm2.user_id = ${userAlias}.id))`)
		.join(' OR ');
}

/**
 * Accounts that signed up and never came back. All of:
 *   - a known sign-up time (accounts from before it was kept are never marked);
 *   - no sign-in more than an hour after the account was made (the hour covers signing up,
 *     confirming the address and signing in for the first time);
 *   - no active day later than the sign-up day. A session lasts 30 days, so a person can return
 *     many times without signing in again; last_active_on is what shows it;
 *   - none of the records above, and no invite they accepted.
 */
export const ABANDONED_ACCOUNTS_SQL = `SELECT u.id FROM auth_users u
	WHERE u.created_at IS NOT NULL
	  AND (u.last_login IS NULL OR u.last_login::timestamp <= u.created_at::timestamp + interval '1 hour')
	  AND (u.last_active_on IS NULL OR u.last_active_on <= to_char(u.created_at::timestamp, 'YYYY-MM-DD'))
	  AND NOT (${hasPersonRecordsSql('u')})
	  AND NOT EXISTS (SELECT 1 FROM receivable_invites ri WHERE ri.accepted_by = u.id)
	  AND NOT EXISTS (SELECT 1 FROM cairn_invites ci WHERE ci.accepted_by = u.id)`;

/**
 * The ids of the abandoned accounts. The check stands on its own: a failure returns an empty
 * set, so it only drops the red outline, and it is logged, never silent.
 */
export async function listAbandonedAccountIds(): Promise<Set<string>> {
	try {
		// last_active_on is added lazily; a failed ensure is not final (the migration may have run).
		await ensureAccountActivityColumns().catch(() => {});
		const res = await db.execute({ sql: ABANDONED_ACCOUNTS_SQL, args: [] });
		return new Set((res.rows as Record<string, unknown>[]).map((r) => String(r.id)));
	} catch (error) {
		console.warn('[admin] abandoned-account check failed', error instanceof Error ? error.message : String(error));
		return new Set();
	}
}

/** Which of these accounts have at least one person record. Throws on a database error. */
export async function accountIdsWithPersonRecords(userIds: string[]): Promise<Set<string>> {
	if (!userIds.length) return new Set();
	const res = await db.execute({
		sql: `SELECT u.id FROM auth_users u
		      WHERE u.id IN (${userIds.map(() => '?').join(', ')}) AND (${hasPersonRecordsSql('u')})`,
		args: userIds,
	});
	return new Set((res.rows as Record<string, unknown>[]).map((r) => String(r.id)));
}
