/**
 * POST /api/admin/promo/create
 * Admin-only endpoint to generate promo codes.
 *
 * Body (all optional except code):
 *   code          string   — the code itself (e.g. "LAUNCH2026"). Auto-uppercased.
 *   plan_id       string   — 'unlimited' | 'pro' | 'starter'  (default: 'unlimited')
 *   duration_days number   — days of access granted            (default: 365)
 *   max_uses      number   — max redemptions, omit for unlimited
 *   note          string   — internal label for your reference
 *   expires_at    string   — ISO date the code itself expires, omit for never
 *
 * Returns:
 *   200  { ok: true, code, plan_id, duration_days, max_uses, note, expires_at }
 *   400  { error: string }
 *   401 / 403   — not admin
 *   409  { error: string }  — code already exists
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { PLANS } from '@/lib/subscriptions';

export const POST: APIRoute = async ({ request }) => {
  await requireAdminSession(request);   // throws 401/403 if not admin

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code) return json({ error: '`code` is required.' }, 400);
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
    return json({ error: '`code` must be 2-32 characters: letters, numbers, hyphens, underscores.' }, 400);
  }

  const planId = String(body.plan_id ?? 'unlimited');
  if (!PLANS[planId as keyof typeof PLANS]) {
    return json({ error: `Unknown plan_id "${planId}". Valid: ${Object.keys(PLANS).join(', ')}` }, 400);
  }

  const durationDays = body.duration_days !== undefined ? Number(body.duration_days) : 365;
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    return json({ error: '`duration_days` must be a positive integer.' }, 400);
  }

  const maxUses = body.max_uses !== undefined ? Number(body.max_uses) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return json({ error: '`max_uses` must be a positive integer or omitted.' }, 400);
  }

  const note = body.note ? String(body.note).slice(0, 255) : null;
  const expiresAt = body.expires_at ? String(body.expires_at) : null;

  // Check for duplicate
  const existing = await db.execute({
    sql: `SELECT code FROM promo_codes WHERE code = ?`,
    args: [code],
  }).then(r => r.rows[0]);

  if (existing) {
    return json({ error: `Code "${code}" already exists.` }, 409);
  }

  await db.execute({
    sql: `INSERT INTO promo_codes (code, plan_id, duration_days, max_uses, note, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [code, planId, durationDays, maxUses, note, expiresAt],
  });

  return json({ ok: true, code, plan_id: planId, duration_days: durationDays, max_uses: maxUses, note, expires_at: expiresAt }, 200);
};

export const GET: APIRoute = async ({ request }) => {
  await requireAdminSession(request);

  const rows = await db.execute({
    sql: `SELECT pc.code, pc.plan_id, pc.duration_days, pc.max_uses, pc.note,
                 pc.created_at, pc.expires_at,
                 COUNT(pr.id) AS use_count
          FROM promo_codes pc
          LEFT JOIN promo_redemptions pr ON pr.code = pc.code
          GROUP BY pc.code
          ORDER BY pc.created_at DESC`,
    args: [],
  }).then(r => r.rows);

  return json({ ok: true, codes: rows }, 200);
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
