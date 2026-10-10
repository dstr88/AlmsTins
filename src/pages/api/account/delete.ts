import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { invalidateUserAuthFacts } from '@/lib/sessionGate';
import { deleteVerifyAccountData } from '@/lib/verifyAccountDelete';
import { TENANT_TABLES, USER_TABLES } from '@/lib/accountDeleteTables';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  '__Host-authjs.session-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'authjs.callback-url',
  'authjs.pkce.code_verifier',
  'authjs.state',
];

/**
 * The tenant this deletion acts on: the one the app itself writes under. The session's
 * tenant (the JWT claim requireTenantSession trusts) when the user is still a member of
 * it, otherwise the membership the app would pick (owner first, oldest, never 'default',
 * the legacy shared tenant). Null when the user has no such membership.
 */
async function resolveTenantToDelete(userId: string, sessionTenantId: unknown): Promise<string | null> {
  const fromSession = typeof sessionTenantId === 'string' ? sessionTenantId.trim() : '';
  if (fromSession && fromSession !== 'default') {
    const member = await db.execute({
      sql: `SELECT 1 AS ok FROM tenant_memberships WHERE user_id = ? AND tenant_id = ? LIMIT 1`,
      args: [userId, fromSession],
    });
    if (member.rows.length) return fromSession;
  }
  const row = await db.execute({
    sql: `SELECT tenant_id FROM tenant_memberships
          WHERE user_id = ? AND tenant_id != 'default'
          ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC, id ASC
          LIMIT 1`,
    args: [userId],
  });
  const tenantId = (row.rows[0] as any)?.tenant_id;
  return tenantId ? String(tenantId) : null;
}

/**
 * The same person's other sign-in identities in this tenant: signing in with Google and
 * with GitHub under one email puts two auth users in one tenant (ensureTenantForUser).
 * Deleting the account removes both; a leftover identity would keep the email, its
 * provider link and sessions, pointing at a tenant that no longer exists.
 */
async function siblingIdentities(userId: string, tenantId: string): Promise<string[]> {
  const res = await db.execute({
    sql: `SELECT DISTINCT tm.user_id FROM tenant_memberships tm
          JOIN auth_users u ON u.id = tm.user_id
          JOIN auth_users me ON me.id = ?
          WHERE tm.tenant_id = ? AND tm.user_id <> ? AND u.email <> '' AND lower(u.email) = lower(me.email)`,
    args: [userId, tenantId, userId],
  });
  return res.rows.map((r: any) => String(r.user_id)).filter(Boolean);
}

/**
 * Every statement that removes the account, children before parents (most foreign keys
 * also cascade). A table the live database does not have, or that lacks the key column,
 * is skipped: it cannot hold this account's rows, and a statement on it would abort the
 * whole transaction. One catalog query decides.
 */
async function accountDeleteStatements(tenantId: string, userIds: string[]): Promise<Array<{ sql: string; args: string[] }>> {
  const tables = [...new Set([...TENANT_TABLES, ...USER_TABLES, 'petro_tins', 'asset_lifecycle_groups',
    'protocol_events', 'promo_redemptions', 'tenant_memberships', 'tenants', 'auth_users'])];
  const res = await db.execute({
    sql: `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name IN (${tables.map(() => '?').join(', ')})`,
    args: tables,
  });
  const cols = new Map<string, Set<string>>();
  for (const r of res.rows as any[]) {
    const t = String(r.table_name);
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t)!.add(String(r.column_name));
  }
  const has = (t: string, c: string) => cols.get(t)?.has(c) ?? false;

  const out: Array<{ sql: string; args: string[] }> = [];
  // Children reached only through a parent's id.
  if (has('petro_tin_entries', 'tin_id') && has('petro_tins', 'tenant_id')) {
    out.push({ sql: `DELETE FROM petro_tin_entries WHERE tin_id IN (SELECT id FROM petro_tins WHERE tenant_id = ?)`, args: [tenantId] });
  }
  if (has('asset_lifecycle_events', 'group_id') && has('asset_lifecycle_groups', 'tenant_id')) {
    out.push({ sql: `DELETE FROM asset_lifecycle_events WHERE group_id IN (SELECT id FROM asset_lifecycle_groups WHERE tenant_id = ?)`, args: [tenantId] });
  }
  if (has('protocol_events', 'wallet_id') && has('wallets', 'tenant_id')) {
    out.push({ sql: `DELETE FROM protocol_events WHERE wallet_id IN (SELECT id FROM wallets WHERE tenant_id = ?)`, args: [tenantId] });
  }
  for (const t of TENANT_TABLES) {
    if (!has(t, 'tenant_id')) continue;
    // The legacy users row cascades to wallets by user_id; never let that reach a wallet
    // that belongs to another tenant.
    if (t === 'users' && has('wallets', 'user_id')) {
      out.push({ sql: `DELETE FROM users WHERE tenant_id = ? AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = users.id AND w.tenant_id <> ?)`, args: [tenantId, tenantId] });
      continue;
    }
    out.push({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [tenantId] });
  }
  // Promo redemptions stay, unlinked: a code's max_uses counts them, and deleting them
  // would let a code be redeemed again by signing up, deleting and signing up again.
  if (has('promo_redemptions', 'tenant_id') && has('promo_redemptions', 'id')) {
    out.push({ sql: `UPDATE promo_redemptions SET tenant_id = 'deleted:' || id WHERE tenant_id = ?`, args: [tenantId] });
  }
  for (const id of userIds) {
    for (const t of USER_TABLES) if (has(t, 'user_id')) out.push({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [id] });
  }
  // The account itself, last: memberships, any other user's pointer at this tenant, the
  // tenant row, then each sign-in identity (its links, password hash, sessions and
  // support threads cascade too).
  if (has('tenant_memberships', 'tenant_id')) out.push({ sql: `DELETE FROM tenant_memberships WHERE tenant_id = ?`, args: [tenantId] });
  if (has('auth_users', 'active_tenant_id')) out.push({ sql: `UPDATE auth_users SET active_tenant_id = NULL WHERE active_tenant_id = ?`, args: [tenantId] });
  if (has('tenants', 'id')) out.push({ sql: `DELETE FROM tenants WHERE id = ?`, args: [tenantId] });
  for (const id of userIds) out.push({ sql: `DELETE FROM auth_users WHERE id = ?`, args: [id] });
  return out;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getAuthSession(request).catch(() => null);
  if (!session?.user?.id) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const userId = session.user.id;
  const tenantId = await resolveTenantToDelete(userId, session.tenantId).catch(() => null);
  if (!tenantId) {
    return json({ ok: false, error: 'No account found.' }, 404);
  }

  try {
    // Verify first: its claims answer publicly (scan, wallet checker, agent check) and
    // are claim-once. One transaction, every statement scoped by tenant_id. Unlike the
    // best-effort deletes below, a failure here stops the whole request before the
    // account is touched, so the owner can retry; carrying on would leave the claims
    // public with no account left to remove them.
    await deleteVerifyAccountData(tenantId);

    // Everything else the account holds, in ONE transaction: either all of it goes, with
    // the account, or none of it does and the owner can retry. (Before, each delete was
    // best effort, so a failed one left rows behind with no account left to remove them.)
    // Every statement is scoped by this tenant or these users; the ids come from the
    // session above, never from the request. tests/privacy/accountDeleteCoverage.test.ts
    // fails if a per-account table is neither listed nor deliberately kept.
    const userIds = [userId, ...(await siblingIdentities(userId, tenantId))];
    const statements = await accountDeleteStatements(tenantId, userIds);
    await db.batch(statements, 'write');

    // Cut these users' other sessions in this process now, instead of when the session
    // gate's 60s cache of the user expires.
    for (const id of userIds) invalidateUserAuthFacts(id);

    // Sweep Verify once more: another tab or device of this account could have written a
    // claim between the first pass and the account going away, and no account would be
    // left to remove it. Idempotent; the account is already gone, so failures are logged.
    await deleteVerifyAccountData(tenantId).catch((err) => {
      console.error('[delete-account] final Verify sweep failed', err);
    });

    // Clear session cookies
    for (const name of COOKIE_NAMES) {
      cookies.delete(name, { path: '/' });
      cookies.delete(name, { path: '/', secure: true });
    }

    return json({ ok: true });
  } catch (err: any) {
    console.error('[delete-account]', err);
    return json({ ok: false, error: 'Failed to delete account. Please contact support.' }, 500);
  }
};
