/**
 * PetroTins subscription & promo code helpers
 */

import { db } from './db';

export type PetroTier = 'free' | 'paid';

export interface PetroSubscription {
  tenantId: string;
  tier: PetroTier;
  expiresAt: string | null; // null = lifetime
  promoCode: string | null;
  createdAt: string;
}

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS petro_subscriptions (
    tenant_id   TEXT NOT NULL PRIMARY KEY,
    tier        TEXT NOT NULL DEFAULT 'free',
    expires_at  TEXT,
    promo_code  TEXT,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE TABLE IF NOT EXISTS petro_promo_codes (
    code        TEXT NOT NULL PRIMARY KEY,
    discount    TEXT NOT NULL,       -- 'free_year' | 'half_off' | 'free_life'
    max_uses    INTEGER,             -- null = unlimited
    uses        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  );
`;

let ensured = false;
export async function ensureTables() {
  if (ensured) return;
  // Split into individual statements
  await db.execute(`CREATE TABLE IF NOT EXISTS petro_subscriptions (
    tenant_id   TEXT NOT NULL PRIMARY KEY,
    tier        TEXT NOT NULL DEFAULT 'free',
    expires_at  TEXT,
    promo_code  TEXT,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS petro_promo_codes (
    code        TEXT NOT NULL PRIMARY KEY,
    discount    TEXT NOT NULL,
    max_uses    INTEGER,
    uses        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`);
  // Seed promo codes if not present
  await db.execute({
    sql: `INSERT INTO petro_promo_codes (code, discount, max_uses) VALUES
      ('PETROYEAR', 'free_year',  10),
      ('PETRO50',   'half_off',   NULL),
      ('FOUNDER',   'free_life',  5),
      ('TIN202606', 'free_year',  10)
ON CONFLICT DO NOTHING`,
    args: [],
  });
  // Enforce max_uses cap on PETROYEAR in case it was seeded earlier with NULL
  await db.execute({
    sql: `UPDATE petro_promo_codes SET max_uses = 10 WHERE code = 'PETROYEAR' AND (max_uses IS NULL OR max_uses > 10)`,
    args: [],
  });
  ensured = true;
}

export async function getPetroSubscription(tenantId: string): Promise<PetroTier> {
  await ensureTables();
  const res = await db.execute({
    sql: `SELECT tier, expires_at FROM petro_subscriptions WHERE tenant_id = ?`,
    args: [tenantId],
  });
  if (!res.rows.length) return 'free';
  const row = res.rows[0] as any;
  if (row.tier === 'free') return 'free';
  // Check expiry
  if (row.expires_at === null) return 'paid'; // lifetime
  if (new Date(row.expires_at) > new Date()) return 'paid';
  return 'free'; // expired
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
  tier?: PetroTier;
  expiresAt?: string | null;
  discount?: string;
  requiresPayment?: boolean;
  amount?: number;
}

export async function redeemPromoCode(tenantId: string, code: string): Promise<RedeemResult> {
  await ensureTables();
  const upper = code.trim().toUpperCase();

  const res = await db.execute({
    sql: `SELECT code, discount, max_uses, uses, active FROM petro_promo_codes WHERE code = ?`,
    args: [upper],
  });
  if (!res.rows.length) return { ok: false, error: 'Invalid promo code.' };

  const promo = res.rows[0] as any;
  if (!promo.active) return { ok: false, error: 'This code is no longer active.' };
  if (promo.max_uses !== null && promo.uses >= promo.max_uses) {
    return { ok: false, error: 'This code has reached its maximum number of uses.' };
  }

  // Check if tenant already used a code
  const existing = await db.execute({
    sql: `SELECT promo_code FROM petro_subscriptions WHERE tenant_id = ?`,
    args: [tenantId],
  });
  if (existing.rows.length && (existing.rows[0] as any).promo_code) {
    return { ok: false, error: 'You have already redeemed a promo code.' };
  }

  // half_off requires payment — return payment intent info, don't activate yet
  if (promo.discount === 'half_off') {
    return { ok: true, requiresPayment: true, amount: 50, discount: 'half_off' };
  }

  // Activate subscription
  let expiresAt: string | null = null;
  if (promo.discount === 'free_year') {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    expiresAt = d.toISOString().slice(0, 10);
  }
  // free_life: expiresAt stays null

  // Atomically claim one use — the conditional WHERE means a concurrent burst of
  // redemptions can't push `uses` past `max_uses` (the earlier read-then-write
  // check was race-prone). Only activate if this request actually claimed a use.
  const claim = await db.execute({
    sql: `UPDATE petro_promo_codes SET uses = uses + 1
          WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)`,
    args: [upper],
  });
  if (Number(claim.rowsAffected ?? 0) < 1) {
    return { ok: false, error: 'This code has reached its maximum number of uses.' };
  }

  await db.execute({
    sql: `INSERT INTO petro_subscriptions (tenant_id, tier, expires_at, promo_code)
          VALUES (?, 'paid', ?, ?)
          ON CONFLICT(tenant_id) DO UPDATE SET
            tier = 'paid', expires_at = excluded.expires_at,
            promo_code = excluded.promo_code, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
    args: [tenantId, expiresAt, upper],
  });

  return { ok: true, tier: 'paid', expiresAt, discount: promo.discount };
}
