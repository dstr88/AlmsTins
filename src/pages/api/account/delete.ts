import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';

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

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getAuthSession(request).catch(() => null);
  if (!session?.user?.id) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  // Determine tenantId from tenant_memberships
  const userId = session.user.id;
  const memberRow = await db.execute({
    sql: `SELECT tenant_id FROM tenant_memberships WHERE user_id = ? LIMIT 1`,
    args: [userId],
  }).catch(() => null);

  const tenantId = (memberRow?.rows?.[0] as any)?.tenant_id as string | undefined;
  if (!tenantId) {
    return json({ ok: false, error: 'No account found.' }, 404);
  }

  // Safety: this handler wipes ALL data for the tenant (and every member's
  // membership). If the tenant has more than one member, a single member must
  // not be able to destroy shared data — refuse and route to support. Solo
  // tenants (the current model) are unaffected.
  const memberCount = await db
    .execute({ sql: `SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id = ?`, args: [tenantId] })
    .then((r) => Number((r.rows?.[0] as any)?.n ?? 0))
    .catch(() => 0);
  if (memberCount > 1) {
    return json({ ok: false, error: 'This account is shared. Please contact support to delete it.' }, 409);
  }

  try {
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

    // Remove tenant membership and user record
    await db.execute({ sql: `DELETE FROM tenant_memberships WHERE tenant_id = ?`, args: [tenantId] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM auth_users WHERE id = ?`, args: [userId] }).catch(() => {});

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
