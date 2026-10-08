import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { invalidateUserAuthFacts } from '@/lib/sessionGate';
import { deleteVerifyAccountData } from '@/lib/verifyAccountDelete';

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

    // Delete all tenant data — PetroTins
    await db.execute({ sql: `DELETE FROM petro_tin_entries WHERE tin_id IN (SELECT id FROM petro_tins WHERE tenant_id = ?)`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM petro_tins WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM petro_subscriptions WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});

    // Almstins data
    await db.execute({ sql: `DELETE FROM import_transactions WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM wallet_snapshots WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM wallets WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM asset_lifecycle_events WHERE group_id IN (SELECT id FROM asset_lifecycle_groups WHERE tenant_id = ?)`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM asset_lifecycle_groups WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM tax_review_items WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM transfer_matches WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM address_labels WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM price_alerts WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM transaction_screenshots WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM monthly_digests WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM tenant_intake WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM wallet_defi_sync WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM wallet_sync_state WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});

    // Subscriptions / billing
    await db.execute({ sql: `DELETE FROM subscriptions WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});

    // Email campaigns (onboarding, Verify business): the enrollment row holds the address
    // the drip sends to, so it goes with the user.
    await db.execute({ sql: `DELETE FROM campaign_drip WHERE user_id = ?`, args: [userId] }).catch(() => {});

    // Remove tenant membership and user record
    await db.execute({ sql: `DELETE FROM tenant_memberships WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM auth_users WHERE id = ?`, args: [userId] }).catch(() => {});

    // Cut this user's other sessions in this process now, instead of when the session
    // gate's 60s cache of the user expires.
    invalidateUserAuthFacts(userId);

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
