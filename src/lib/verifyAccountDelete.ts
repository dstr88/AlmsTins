/**
 * Almstins Verify: remove one tenant's Verify data when its account is deleted.
 *
 * Verify answers the public about an account. A proven destination answers on the scan
 * page, the wallet checker and the agent check; a reserved business name and a
 * platform's mirrored address list answer there too. Deleting the account must take all
 * of it down, and must free the claim-once slots (the proven wallet or link, the business
 * name), so an owner who comes back can prove them again from a new account.
 *
 * Every statement is scoped by tenant_id, with the tenant id as its only argument, and
 * they all run in one transaction (db.batch): either every Verify row of the tenant goes,
 * or none does and the error reaches the caller, which then keeps the account so the
 * owner can retry. A table that was never created is skipped (one catalog query decides),
 * because it holds no rows and a DELETE on it would abort the whole transaction.
 *
 * Order. The tables have no foreign keys. The platform rows (verified_entities) go FIRST,
 * before their mirrored addresses, on purpose: a monitor pull that is replacing the
 * mirror locks the entity row first (pullEntity), so taking the same lock first here
 * means the two never deadlock, and the mirror DELETE, a later statement with a fresh
 * snapshot, also removes any rows that pull committed while this one waited. A pull that
 * loses the race finds the entity gone and inserts nothing.
 *
 * The satoshi-test issuance log goes too. It holds (tenant, address) pairs, so keeping it
 * would keep a link between the deleted account and its wallets. Its per-tenant caps mean
 * nothing for a tenant that no longer exists, and a new account starts a fresh history
 * either way.
 *
 * Receivable desk: two tenant-only steps, nothing else.
 *   - The tenant's own open requests (receivable_invites.from_tenant, not yet answered or
 *     revoked) are revoked. Left open, the link would still show the invoice and its
 *     documents to whoever holds it, an answer or the lapse cron would write new
 *     attestations under the deleted tenant, and an accept would grant access to a dead
 *     account. Answered and already-revoked invites stay as they are.
 *   - The tenant's read markers (receivable_seen) are deleted. They are its own UI state.
 * Milestone desk: the tenant's own open requests (cairn_invites.from_tenant) are revoked
 * for the same reason; its projects and attestations stay, like the receivable records.
 * Kept on purpose: receivables, claims, attestations, offers, access grants, documents and
 * re-verifications. Other parties' claims, confirmations and access hang off them, and
 * removing them would erase a financing record those parties rely on (and could let the
 * same invoice be financed twice). How long they are kept falls under the retention and
 * legal-hold terms of the privacy policy (sections 11 and 16), not under this module.
 *
 * Known, bounded gaps (not closed here):
 *   - An agent key SELECT already in flight when this commits can re-cache the key for up
 *     to the 60s auth-cache TTL. The key only reads public proof state; the effect is the
 *     keyed rate-limit tier for that minute. Other instances drop it within the TTL too.
 *   - A session on another device stays valid until the session gate sees the user gone
 *     (the caller clears this process's cache; other instances within 60s). The caller
 *     runs this sweep a second time after the account is gone to remove anything such a
 *     session wrote in between.
 */
import { db } from '@/lib/db';
import { forgetAgentKeys } from '@/lib/agentKeys';

/** Each statement takes exactly one argument: the tenant id. See the header for the order. */
const STEPS: ReadonlyArray<{ table: string; sql: string }> = [
  // The platform, then its mirrored address list (a public lookup source).
  { table: 'verified_entities', sql: `DELETE FROM verified_entities WHERE tenant_id = ?` },
  { table: 'verified_address_mirror', sql: `DELETE FROM verified_address_mirror WHERE tenant_id = ?` },
  // Agent API keys. RETURNING id so the auth cache can drop them in the same breath.
  { table: 'verify_agent_keys', sql: `DELETE FROM verify_agent_keys WHERE tenant_id = ? RETURNING id` },
  // The reserved business names (global keys, freed for their rightful owner).
  { table: 'verify_claimed_names', sql: `DELETE FROM verify_claimed_names WHERE tenant_id = ?` },
  // The satoshi test: open challenges (frees their pending amounts), then the issuance log.
  { table: 'verify_deposit_challenges', sql: `DELETE FROM verify_deposit_challenges WHERE tenant_id = ?` },
  { table: 'verify_deposit_amount_log', sql: `DELETE FROM verify_deposit_amount_log WHERE tenant_id = ?` },
  // Domain proofs (the watchman stops re-checking them), then the destinations themselves.
  { table: 'verify_domain_proofs', sql: `DELETE FROM verify_domain_proofs WHERE tenant_id = ?` },
  { table: 'verify_destinations', sql: `DELETE FROM verify_destinations WHERE tenant_id = ?` },
  // Receivable desk: close the tenant's own open requests, drop its read markers.
  {
    table: 'receivable_invites',
    sql: `UPDATE receivable_invites SET revoked_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
          WHERE from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
  },
  { table: 'receivable_seen', sql: `DELETE FROM receivable_seen WHERE tenant_id = ?` },
  // Milestone desk: close the tenant's own open inspection requests the same way. Left
  // open, a holder could still attest, and it would be written under the deleted tenant.
  {
    table: 'cairn_invites',
    sql: `UPDATE cairn_invites SET revoked_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
          WHERE from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
  },
];

export interface VerifyAccountDeleteResult {
  /** Rows affected per table (removed; for the two invite tables, revoked). Missing tables report 0. */
  affected: Record<string, number>;
}

/** Which of these tables exist, in one catalog query (to_regclass is null for a missing one). */
async function existingTables(tables: readonly string[]): Promise<Set<string>> {
  const cols = tables.map((_, i) => `to_regclass(?) AS t${i}`).join(', ');
  const res = await db.execute({ sql: `SELECT ${cols}`, args: [...tables] });
  const row = (res.rows[0] ?? {}) as Record<string, unknown>;
  return new Set(tables.filter((_, i) => row[`t${i}`] != null));
}

/**
 * Delete every Verify row that belongs to `tenantId` (and close its open receivable
 * requests), in one transaction, then drop the tenant's agent keys from the in-process
 * auth cache. Idempotent. Throws when the catalog check or the transaction fails; nothing
 * is changed in that case.
 */
export async function deleteVerifyAccountData(tenantId: string): Promise<VerifyAccountDeleteResult> {
  const id = String(tenantId ?? '').trim();
  if (!id) throw new Error('[verify] account delete needs a tenant id');

  const present = await existingTables(STEPS.map((s) => s.table));
  const steps = STEPS.filter((s) => present.has(s.table));

  const affected: Record<string, number> = Object.fromEntries(STEPS.map((s) => [s.table, 0]));
  if (!steps.length) return { affected };

  const results = await db.batch(steps.map((s) => ({ sql: s.sql, args: [id] })), 'write');

  const keyIds: string[] = [];
  steps.forEach((s, i) => {
    const res = results[i];
    affected[s.table] = Number(res?.rowsAffected ?? 0);
    if (s.table === 'verify_agent_keys') {
      for (const r of (res?.rows ?? []) as any[]) keyIds.push(String(r.id));
    }
  });
  forgetAgentKeys(keyIds);
  return { affected };
}
