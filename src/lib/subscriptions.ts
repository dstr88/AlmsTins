import { db } from './db';

// ── Plan definitions ──────────────────────────────────────────────────────────
// To change limits or add new tiers, only this object needs updating.

export type PlanId = 'free' | 'starter' | 'pro' | 'unlimited';

export interface PlanConfig {
  id: PlanId;
  label: string;
  walletLimit: number; // max wallets (tins). 0 = unlimited
  monthlyPrice: number; // USD, 0 = free
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    label: 'Free',
    walletLimit: 3,
    monthlyPrice: 0,
  },
  starter: {
    id: 'starter',
    label: 'Starter',
    walletLimit: 8,
    monthlyPrice: 7,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    walletLimit: 20,
    monthlyPrice: 19,
  },
  unlimited: {
    id: 'unlimited',
    label: 'Unlimited',
    walletLimit: 0,
    monthlyPrice: 39,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve the active plan for a tenant. Falls back to 'free' if no row exists. */
export async function getActivePlan(tenantId: string): Promise<PlanConfig & { promoExpiresAt?: string }> {
  // ── Promo check (takes priority over Stripe subscription) ─────────────────
  try {
    const promoResult = await db.execute({
      sql: `SELECT plan_id, access_expires_at FROM promo_redemptions
            WHERE tenant_id = ? AND access_expires_at > to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
            ORDER BY access_expires_at DESC LIMIT 1`,
      args: [tenantId],
    });
    const promoRow = promoResult.rows[0] as Record<string, unknown> | undefined;
    if (promoRow?.plan_id) {
      const planId = promoRow.plan_id as string;
      const plan = PLANS[planId as PlanId] ?? PLANS.free;
      return { ...plan, promoExpiresAt: promoRow.access_expires_at as string };
    }
  } catch {
    // Table may not exist yet during migration — fall through to subscription check
  }

  // ── Stripe subscription check ─────────────────────────────────────────────
  const result = await db.execute({
    sql: `SELECT plan_id, status FROM subscriptions WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;

  // If status is not active/trialing, treat as free
  const status = (row?.status as string | undefined) ?? 'active';
  const isActive = status === 'active' || status === 'trialing';
  const planId = (isActive ? (row?.plan_id as string | undefined) : undefined) ?? 'free';

  return PLANS[planId as PlanId] ?? PLANS.free;
}

/** Ensure a free subscription row exists for a tenant (idempotent). */
export async function ensureFreeSubscription(tenantId: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO subscriptions (tenant_id, plan_id, status, created_at)
          VALUES (?, 'free', 'active', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
    args: [tenantId],
  });
}

export interface WalletLimitResult {
  allowed: boolean;
  current: number;
  limit: number; // 0 means unlimited
  plan: PlanConfig;
  message?: string;
}

/** Check whether a tenant can create another wallet under their current plan. */
export async function checkWalletLimit(tenantId: string): Promise<WalletLimitResult> {
  const plan = await getActivePlan(tenantId);

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM wallets WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const current = Number((countResult.rows[0] as Record<string, unknown>)?.cnt ?? 0);

  // 0 = unlimited
  if (plan.walletLimit === 0) {
    return { allowed: true, current, limit: 0, plan };
  }

  const allowed = current < plan.walletLimit;
  const message = allowed
    ? undefined
    : `You've reached the ${plan.walletLimit}-tin limit on the ${plan.label} plan. Upgrade to add more.`;

  return { allowed, current, limit: plan.walletLimit, plan, message };
}
