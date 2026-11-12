/**
 * The owner's switch for Verify plans: put an account on Business or Pro by hand, take it back to
 * Free, and list the accounts that have a plan row.
 *
 * This is the only writer of verify_subscriptions so far. It is called from the admin route alone
 * (src/pages/api/admin/verify-plan.ts), which stands behind requireAdminSession and runs with no
 * tenant context, so its queries cross accounts. Nothing here checks who is asking.
 *
 * A paid plan is written as `active`, with the paid-through date, the note and the admin's user
 * id. Free does not delete the row: it marks it `canceled`, so the note and the day of the change
 * stay on record. The owner's own account is refused; it has no limit and a row would change
 * nothing. Which plan a row reads as is decided in ./verifyEntitlements.ts, not here.
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/owner';
import { ensureVerifyTables } from './verifyRegistry';
import { isLiveVerifySubscription } from './verifyEntitlements';
import { VERIFY_PLANS, VERIFY_PLAN_ORDER, isVerifyPaidPlan, type VerifyPlanId } from './verifyPlans';

/** The longest note a plan row holds. */
export const VERIFY_PLAN_NOTE_MAX = 500;
/** How many plan rows the list returns, newest change first. */
const LIST_LIMIT = 200;

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export type VerifyPlanAdminError =
  | 'account_required'
  | 'account_not_found'
  | 'owner_account'
  | 'invalid_plan'
  | 'invalid_paid_through'
  | 'paid_through_past'
  | 'note_too_long';

export interface VerifyPlanAccount {
  tenantId: string;
  /** The address of the account's first member, when it has one. */
  email: string | null;
}

/** The plan row as it stood before a change. */
export interface VerifyPlanPrevious {
  plan: string;
  status: string;
  paidThrough: string | null;
}

export type SetVerifyPlanResult =
  | {
      ok: true;
      account: VerifyPlanAccount;
      plan: VerifyPlanId;
      status: string;
      paidThrough: string | null;
      previous: VerifyPlanPrevious | null;
      /** False when the account was already on Free and nothing was written. */
      changed: boolean;
    }
  | { ok: false; error: VerifyPlanAdminError };

export interface VerifyPlanListRow extends VerifyPlanAccount {
  plan: string;
  status: string;
  paidThrough: string | null;
  note: string | null;
  setBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Whether the row is a live plan today. */
  live: boolean;
  /** The name of the plan the account is on today: the row's plan while it is live, Free otherwise. */
  readsAs: string;
  /** How many destinations the account holds. */
  destinations: number;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** The address of the first member of each account, by tenant id. */
async function emailsByTenant(tenantIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!tenantIds.length) return out;
  const r = await db.execute({
    sql: `SELECT m.tenant_id, u.email
            FROM tenant_memberships m JOIN auth_users u ON u.id = m.user_id
           WHERE m.tenant_id IN (${tenantIds.map(() => '?').join(', ')})
           ORDER BY m.created_at ASC`,
    args: tenantIds,
  });
  for (const row of r.rows as Array<Record<string, unknown>>) {
    const tenantId = String(row.tenant_id);
    const email = str(row.email);
    if (email && !out.has(tenantId)) out.set(tenantId, email);
  }
  return out;
}

/**
 * The account an email or a tenant id names. An email is the account its user is working in (the
 * one the Verify dashboard opens), or the first one it joined; anything without an @ is a tenant
 * id. Null when there is no such account.
 */
export async function resolveVerifyAccount(input: string): Promise<VerifyPlanAccount | null> {
  const raw = input.trim();
  if (!raw) return null;
  let tenantId: string | null = null;
  if (raw.includes('@')) {
    const u = await db.execute({
      sql: `SELECT id, active_tenant_id FROM auth_users WHERE email = ? LIMIT 1`,
      args: [raw.toLowerCase()],
    });
    const user = u.rows[0] as Record<string, unknown> | undefined;
    if (!user) return null;
    tenantId = str(user.active_tenant_id);
    if (!tenantId) {
      const m = await db.execute({
        sql: `SELECT tenant_id FROM tenant_memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`,
        args: [String(user.id)],
      });
      tenantId = str((m.rows[0] as Record<string, unknown> | undefined)?.tenant_id);
    }
  } else {
    const t = await db.execute({ sql: `SELECT id FROM tenants WHERE id = ? LIMIT 1`, args: [raw] });
    tenantId = str((t.rows[0] as Record<string, unknown> | undefined)?.id);
  }
  if (!tenantId) return null;
  return { tenantId, email: (await emailsByTenant([tenantId])).get(tenantId) ?? null };
}

/** A real calendar date in the shape paid_through is stored in (YYYY-MM-DD). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface SetVerifyPlanInput {
  /** An email or a tenant id. */
  account: string;
  /** free, business or pro. */
  plan: string;
  /** The last day the plan is paid for (YYYY-MM-DD), or empty for no end date. Ignored for Free. */
  paidThrough?: string | null;
  /** Why the plan was set: the invoice, the wire, who asked. */
  note?: string | null;
  /** The admin's user id. */
  setBy: string;
}

/** Put an account on a plan by hand. */
export async function setVerifyPlan(input: SetVerifyPlanInput): Promise<SetVerifyPlanResult> {
  const plan = String(input.plan ?? '').trim().toLowerCase();
  if (!VERIFY_PLAN_ORDER.includes(plan as VerifyPlanId)) return { ok: false, error: 'invalid_plan' };
  const note = String(input.note ?? '').trim();
  if (note.length > VERIFY_PLAN_NOTE_MAX) return { ok: false, error: 'note_too_long' };
  const paidThrough = isVerifyPaidPlan(plan) ? String(input.paidThrough ?? '').trim() : '';
  if (paidThrough) {
    if (!isCalendarDate(paidThrough)) return { ok: false, error: 'invalid_paid_through' };
    if (paidThrough < todayUtc()) return { ok: false, error: 'paid_through_past' };
  }
  if (!String(input.account ?? '').trim()) return { ok: false, error: 'account_required' };

  await ensureVerifyTables();
  const account = await resolveVerifyAccount(String(input.account));
  if (!account) return { ok: false, error: 'account_not_found' };
  if (isOwner(account.tenantId)) return { ok: false, error: 'owner_account' };

  const before = await db.execute({
    sql: `SELECT plan, status, paid_through FROM verify_subscriptions WHERE tenant_id = ? LIMIT 1`,
    args: [account.tenantId],
  });
  const row = before.rows[0] as Record<string, unknown> | undefined;
  const previous: VerifyPlanPrevious | null = row
    ? { plan: String(row.plan), status: String(row.status), paidThrough: str(row.paid_through) }
    : null;
  const now = nowUtc();

  if (!isVerifyPaidPlan(plan)) {
    // Free is "no live row". An account with no row, or one already canceled, is there already.
    if (!previous || previous.status === 'canceled') {
      return { ok: true, account, plan: 'free', status: previous?.status ?? 'none', paidThrough: null, previous, changed: false };
    }
    await db.execute({
      sql: `UPDATE verify_subscriptions SET status = ?, note = ?, set_by = ?, updated_at = ? WHERE tenant_id = ?`,
      args: ['canceled', note || null, input.setBy, now, account.tenantId],
    });
    return { ok: true, account, plan: 'free', status: 'canceled', paidThrough: null, previous, changed: true };
  }

  // The Stripe ids are left as they are: a plan set by hand does not touch a subscription's link.
  await db.execute({
    sql: `INSERT INTO verify_subscriptions (tenant_id, plan, status, paid_through, note, set_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id) DO UPDATE SET plan = excluded.plan, status = excluded.status,
            paid_through = excluded.paid_through, note = excluded.note, set_by = excluded.set_by,
            updated_at = excluded.updated_at`,
    args: [account.tenantId, plan, 'active', paidThrough || null, note || null, input.setBy, now],
  });
  return { ok: true, account, plan, status: 'active', paidThrough: paidThrough || null, previous, changed: true };
}

/** Every account with a plan row, newest change first, with what each row means today. */
export async function listVerifyPlans(): Promise<VerifyPlanListRow[]> {
  await ensureVerifyTables();
  const r = await db.execute({
    sql: `SELECT tenant_id, plan, status, paid_through, note, set_by, created_at, updated_at
            FROM verify_subscriptions
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT ?`,
    args: [LIST_LIMIT],
  });
  const rows = r.rows as Array<Record<string, unknown>>;
  const tenantIds = rows.map((row) => String(row.tenant_id));
  if (!tenantIds.length) return [];

  const marks = tenantIds.map(() => '?').join(', ');
  const [emails, held] = await Promise.all([
    emailsByTenant(tenantIds),
    db.execute({ sql: `SELECT tenant_id FROM verify_destinations WHERE tenant_id IN (${marks})`, args: tenantIds }),
  ]);
  const counts = new Map<string, number>();
  for (const d of held.rows as Array<Record<string, unknown>>) {
    const id = String(d.tenant_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const today = todayUtc();
  return rows.map((row) => {
    const tenantId = String(row.tenant_id);
    const plan = String(row.plan);
    const live = isVerifyPaidPlan(plan) && isLiveVerifySubscription(row, today);
    return {
      tenantId,
      email: emails.get(tenantId) ?? null,
      plan,
      status: String(row.status),
      paidThrough: str(row.paid_through),
      note: str(row.note),
      setBy: str(row.set_by),
      createdAt: str(row.created_at),
      updatedAt: str(row.updated_at),
      live,
      readsAs: live && isVerifyPaidPlan(plan) ? VERIFY_PLANS[plan].name : VERIFY_PLANS.free.name,
      destinations: counts.get(tenantId) ?? 0,
    };
  });
}
