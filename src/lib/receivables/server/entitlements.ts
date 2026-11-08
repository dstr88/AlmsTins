/**
 * What a receivables account may hold open: its contracts (tier T1; plan file
 * receivables-tier-and-close.claude.md, decisions D9 to D17).
 *
 * A CONTRACT is one open record on either paper: an active financing claim
 * (receivable_claims.status = 'active', a lapsed claim included, because lapse is an aging state
 * and not a status) or a sealed project on the work paper, not yet closed. The Free plan holds one
 * contract at a time, across both papers. Standard holds ten. The deployment owner's account has
 * no limit.
 *
 * Only a release frees a slot: dischargeClaim on the loan paper, a signed close on the work paper
 * (T5). A lapse never does (D10): it frees the invoice's headroom for the client, not the slot for
 * the banker. Test records (is_test) are neither counted nor limited.
 *
 * The limit is enforced where the record is written (addClaim, sealProject), never only in a
 * screen: a refused write answers 409 plan_limit with the limit and what the account holds now,
 * and a screen only words it. Release and close are never gated, so an account that holds more
 * than its limit on the day this ships keeps every record and is refused only new ones (D15).
 *
 * The plan comes from receivables_subscriptions, a table of this product's own; no row is the
 * Free plan. free_locked_at set (D11, written by the aging cron in T2 when two of the account's
 * claims lapse within a trailing year) means Free records no new contracts until the account
 * moves to Standard. The lock is account state: this module and the desk's plan line read it,
 * and no record or public response ever carries it.
 *
 * Imports neither registry (both import this), so the project count reads the work paper's table
 * directly and answers zero while that table does not exist yet.
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/owner';
import { CREATE_RECEIVABLES_SUBSCRIPTIONS } from '../schema';
import {
  FREE_PLAN_LOCKED, PLAN_FREE_LABEL, PLAN_LIMIT_FREE, PLAN_LIMIT_STANDARD,
  PLAN_STANDARD_LABEL, PLAN_UNLIMITED_LABEL,
} from '../copy/plan';

export type ReceivablesPlan = 'free' | 'standard';

/** What a plan allows. `null` is no limit. */
export interface ReceivablesLimits {
  /** Open contracts: active claims plus sealed, unclosed projects, over both papers. */
  contracts: number | null;
}

/** Why the free plan was locked: the two lapses, as the aging cron recorded them (T2). */
export interface LockReason {
  claimIds: string[];
  lapsedAts: string[];
}

export interface ReceivablesEntitlements {
  /** 'unlimited' is the deployment owner's account only. */
  plan: ReceivablesPlan | 'unlimited';
  /** What the plan is called on a screen. */
  label: string;
  limits: ReceivablesLimits;
  /** D11: when two lapses in a trailing year locked the free plan. Null when not locked, and
   *  always null on Standard and the owner. */
  freeLockedAt: string | null;
  freeLockedReason: LockReason | null;
}

export const FREE_LIMITS: ReceivablesLimits = { contracts: 1 };
export const STANDARD_LIMITS: ReceivablesLimits = { contracts: 10 };

const FREE: ReceivablesEntitlements = { plan: 'free', label: PLAN_FREE_LABEL, limits: FREE_LIMITS, freeLockedAt: null, freeLockedReason: null };
const STANDARD: ReceivablesEntitlements = { plan: 'standard', label: PLAN_STANDARD_LABEL, limits: STANDARD_LIMITS, freeLockedAt: null, freeLockedReason: null };
const UNLIMITED: ReceivablesEntitlements = { plan: 'unlimited', label: PLAN_UNLIMITED_LABEL, limits: { contracts: null }, freeLockedAt: null, freeLockedReason: null };

/** A subscription in one of these Stripe states is a live Standard plan. Anything else reads as Free. */
const LIVE_STATUSES = new Set(['active', 'trialing']);

// Single-flight, like the registry's ensure: the table is also in the registry's own table list
// (schema.ts RECEIVABLE_TABLE_CREATES), so whichever runs first creates it and the other is a no-op.
let ensurePromise: Promise<void> | null = null;
function ensureSubscriptionsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = db.execute({ sql: CREATE_RECEIVABLES_SUBSCRIPTIONS, args: [] }).then(() => undefined);
    ensurePromise = run;
    run.catch(() => { if (ensurePromise === run) ensurePromise = null; });
  }
  return ensurePromise;
}

function parseLockReason(raw: unknown): LockReason | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as { claimIds?: unknown; lapsedAts?: unknown };
    const strings = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map(String) : []);
    return { claimIds: strings(v?.claimIds), lapsedAts: strings(v?.lapsedAts) };
  } catch {
    return null;
  }
}

/**
 * The plan an account is on. Owner first (no row needed); then the account's own row; no row,
 * or a Standard row whose Stripe status is not live, is Free.
 */
export async function getReceivablesEntitlements(tenantId: string): Promise<ReceivablesEntitlements> {
  if (isOwner(tenantId)) return UNLIMITED;
  await ensureSubscriptionsTable();
  const r = await db.execute({
    sql: `SELECT plan, status, free_locked_at, free_locked_reason_json
            FROM receivables_subscriptions WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return FREE;
  const live = LIVE_STATUSES.has(String(row.status ?? 'active'));
  if (String(row.plan) === 'standard' && live) return STANDARD;
  const lockedAt = typeof row.free_locked_at === 'string' && row.free_locked_at ? row.free_locked_at : null;
  if (!lockedAt) return FREE;
  return { ...FREE, freeLockedAt: lockedAt, freeLockedReason: parseLockReason(row.free_locked_reason_json) };
}

export interface ContractUse {
  /** Active claims by this account on real (non-test) receivables, lapsed ones included. */
  claims: number;
  /** Sealed, unclosed, non-test projects of this account on the work paper. */
  projects: number;
  total: number;
}

/** Postgres undefined_table, or the test double's wording for the same: the work paper creates
 *  its tables lazily through its own registry, so an account that never opened a project may
 *  ask before they exist. That is zero projects, not a failure. */
const isMissingRelation = (e: unknown): boolean => {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === '42P01' || /does not exist/i.test(String(err?.message ?? ''));
};

export async function countContracts(tenantId: string): Promise<ContractUse> {
  const claimRows = await db.execute({
    sql: `SELECT c.id AS id
            FROM receivable_claims c
            JOIN receivables r ON r.id = c.receivable_id
           WHERE c.tenant_id = ? AND c.status = 'active'
             AND (r.is_test IS NULL OR r.is_test = ?)`,
    args: [tenantId, false],
  });
  let projects = 0;
  try {
    // Until the work paper's close ships (T5, closed_at), every sealed project is open. A draft
    // (signed_at NULL) is not a contract yet: nothing relies on it, and sealing is where the gate sits.
    const projectRows = await db.execute({
      sql: `SELECT id FROM cairn_projects WHERE tenant_id = ? AND signed_at IS NOT NULL AND (is_test IS NULL OR is_test = ?)`,
      args: [tenantId, false],
    });
    projects = projectRows.rows.length;
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  const claims = claimRows.rows.length;
  return { claims, projects, total: claims + projects };
}

export type ContractGateRefusal =
  | { ok: false; error: 'plan_limit'; message: string; use: ContractUse; limit: number; plan: ReceivablesPlan }
  | { ok: false; error: 'free_plan_locked'; message: string; use: ContractUse; lockedAt: string; reason: LockReason | null };

export type ContractGate =
  | { ok: true; use: ContractUse; limit: number | null }
  | ContractGateRefusal;

const lockedMessage = (reason: LockReason | null): string => {
  const dates = reason?.lapsedAts.map((s) => s.slice(0, 10)).filter(Boolean) ?? [];
  return FREE_PLAN_LOCKED.replace('{dates}', dates.length ? ` (${dates.join(', ')})` : '');
};

/**
 * Whether this account may open one more contract now. Owner: always. Locked Free plan: no,
 * whatever it holds. Otherwise: yes while it holds fewer than its limit.
 */
export async function gateNewContract(tenantId: string): Promise<ContractGate> {
  const ent = await getReceivablesEntitlements(tenantId);
  const use = await countContracts(tenantId);
  if (ent.limits.contracts === null) return { ok: true, use, limit: null };
  if (ent.plan === 'free' && ent.freeLockedAt) {
    return { ok: false, error: 'free_plan_locked', message: lockedMessage(ent.freeLockedReason), use, lockedAt: ent.freeLockedAt, reason: ent.freeLockedReason };
  }
  const limit = ent.limits.contracts;
  if (use.total >= limit) {
    return {
      ok: false, error: 'plan_limit',
      message: ent.plan === 'standard' ? PLAN_LIMIT_STANDARD : PLAN_LIMIT_FREE,
      use, limit, plan: ent.plan as ReceivablesPlan,
    };
  }
  return { ok: true, use, limit };
}

/** The slots left under a limit: `null` when there is no limit, never below zero. */
export const slotsLeft = (limit: number | null, used: number): number | null => (limit === null ? null : Math.max(0, limit - used));

/** The plan, its limit and what the account holds now: what GET /api/verify/receivables/plan answers. */
export interface PlanSummary extends ReceivablesEntitlements {
  use: ContractUse;
}

export async function getPlanSummary(tenantId: string): Promise<PlanSummary> {
  const [entitlements, use] = await Promise.all([getReceivablesEntitlements(tenantId), countContracts(tenantId)]);
  return { ...entitlements, use };
}
