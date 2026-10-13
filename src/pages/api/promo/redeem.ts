/**
 * POST /api/promo/redeem
 *
 * Body: { code: string }
 *
 * Validates a promo code and grants the tenant the associated plan
 * for the configured duration. No credit card required.
 *
 * Returns:
 *   200  { ok: true, plan: string, expiresAt: string }
 *   400  { error: string }   — missing/invalid input
 *   401                      — not logged in
 *   404  { error: string }   — code not found or expired
 *   409  { error: string }   — already redeemed this code
 *   429  { error: string }   — code has reached its max uses
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { PLANS, type PlanId } from '@/lib/subscriptions';
import { randomUUID } from 'node:crypto';

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request).catch(() => null);
  if (!session?.tenantId) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { tenantId } = session;

  let code: string;
  try {
    const body = await request.json();
    code = String(body?.code ?? '').trim().toUpperCase();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!code) {
    return json({ error: 'Please enter a promo code.' }, 400);
  }

  // ── Look up the code ───────────────────────────────────────────────────────
  const codeRow = await db.execute({
    sql: `SELECT code, plan_id, duration_days, max_uses, expires_at
          FROM promo_codes
          WHERE code = ?`,
    args: [code],
  }).then(r => r.rows[0] as Record<string, unknown> | undefined).catch(() => undefined);

  if (!codeRow) {
    return json({ error: 'Promo code not found. Please check for typos.' }, 404);
  }

  // Code-level expiry (optional)
  if (codeRow.expires_at) {
    const codeExpiry = new Date(codeRow.expires_at as string);
    if (codeExpiry < new Date()) {
      return json({ error: 'This promo code has expired.' }, 404);
    }
  }

  // ── Check use count if max_uses is set ────────────────────────────────────
  if (codeRow.max_uses !== null && codeRow.max_uses !== undefined) {
    const useCount = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM promo_redemptions WHERE code = ?`,
      args: [code],
    }).then(r => Number((r.rows[0] as Record<string, unknown>)?.cnt ?? 0));

    if (useCount >= Number(codeRow.max_uses)) {
      return json({ error: 'This promo code has reached its maximum number of uses.' }, 429);
    }
  }

  // ── Check if this tenant already redeemed this code ───────────────────────
  const existing = await db.execute({
    sql: `SELECT id FROM promo_redemptions WHERE tenant_id = ? AND code = ?`,
    args: [tenantId, code],
  }).then(r => r.rows[0]);

  if (existing) {
    return json({ error: 'You have already redeemed this code.' }, 409);
  }

  // ── Grant access ──────────────────────────────────────────────────────────
  // duration_days = 0 means "never expires" — use a far-future sentinel date
  const durationDays = Number(codeRow.duration_days ?? 365);
  const accessExpiresIso = durationDays === 0
    ? '9999-12-31T23:59:59Z'
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() + durationDays);
        return d.toISOString().replace('.000Z', 'Z');
      })();

  const planId = String(codeRow.plan_id ?? 'unlimited') as PlanId;
  const plan = PLANS[planId] ?? PLANS.unlimited;

  await db.execute({
    sql: `INSERT INTO promo_redemptions (id, tenant_id, code, plan_id, access_expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [randomUUID(), tenantId, code, planId, accessExpiresIso],
  });

  return json({
    ok: true,
    plan: plan.label,
    expiresAt: accessExpiresIso,
  }, 200);
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
