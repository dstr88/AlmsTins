/**
 * Admin only: the owner's switch for Verify plans. Until billing is wired, this is how an account
 * is put on Business or Pro: the customer pays an invoice, the owner sets the plan here.
 *
 * GET  /api/admin/verify-plan
 *        -> { ok, rows }     every account with a plan row, newest change first: its tenant id and
 *                            email, the row (plan, status, paidThrough, note, setBy, dates), whether
 *                            it is live, the plan it reads as today and how many destinations it holds
 * POST /api/admin/verify-plan   { account, plan, paidThrough?, note? }
 *        -> { ok, tenantId, email, plan, status, paidThrough, changed }
 *
 * `account` is an email or a tenant id. `plan` is free, business or pro. `paidThrough` is the last
 * day paid for (YYYY-MM-DD, not in the past); without it a paid plan has no end date. Free keeps
 * the row and marks it canceled; an account already on Free answers `changed: false` and nothing
 * is written. The owner's own account is refused (409 `owner_account`): it has no limit.
 *
 * Every change writes one line in admin_activity_log under the account's tenant id: the plan, the
 * status and what the row said before. The line carries no email and no note; the note stays on
 * the row. The rules are in src/lib/verifyPlanAdmin.ts.
 */
import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { logActivity } from '@/lib/activityLog';
import { json } from '@/lib/http';
import { listVerifyPlans, setVerifyPlan, type VerifyPlanAdminError } from '@/lib/verifyPlanAdmin';
import { VERIFY_PLANS } from '@/lib/verifyPlans';

export const prerender = false;

/** The admin's session, or the response to return instead (requireAdminSession throws one). */
async function adminOrRefusal(request: Request): Promise<{ userId: string } | Response> {
  try {
    return await requireAdminSession(request);
  } catch (e) {
    return e instanceof Response ? json({ ok: false, error: e.status === 401 ? 'unauthorized' : 'forbidden' }, e.status, { noStore: true }) : json({ ok: false, error: 'forbidden' }, 403, { noStore: true });
  }
}

const ERROR_STATUS: Record<VerifyPlanAdminError, number> = {
  account_required: 400,
  invalid_plan: 400,
  invalid_paid_through: 400,
  paid_through_past: 400,
  note_too_long: 400,
  account_not_found: 404,
  owner_account: 409,
};

export const GET: APIRoute = async ({ request }) => {
  const admin = await adminOrRefusal(request);
  if (admin instanceof Response) return admin;
  try {
    return json({ ok: true, rows: await listVerifyPlans() }, 200, { noStore: true });
  } catch (err) {
    console.error('[admin] verify plan list failed', { name: String((err as { name?: unknown })?.name ?? 'Error') });
    return json({ ok: false, error: 'unavailable' }, 500, { noStore: true });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await adminOrRefusal(request);
  if (admin instanceof Response) return admin;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ ok: false, error: 'invalid_body' }, 400, { noStore: true });
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400, { noStore: true });
  }
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');

  try {
    const result = await setVerifyPlan({
      account: text(body.account),
      plan: text(body.plan),
      paidThrough: text(body.paidThrough),
      note: text(body.note),
      setBy: admin.userId,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, ERROR_STATUS[result.error], { noStore: true });

    if (result.changed) {
      logActivity(result.account.tenantId, 'verify_plan_set', `Verify plan set to ${VERIFY_PLANS[result.plan].name}`, {
        plan: result.plan,
        status: result.status,
        paidThrough: result.paidThrough,
        previousPlan: result.previous?.plan ?? null,
        previousStatus: result.previous?.status ?? null,
      });
    }
    return json({
      ok: true,
      tenantId: result.account.tenantId,
      email: result.account.email,
      plan: result.plan,
      status: result.status,
      paidThrough: result.paidThrough,
      changed: result.changed,
    }, 200, { noStore: true });
  } catch (err) {
    console.error('[admin] verify plan set failed', { name: String((err as { name?: unknown })?.name ?? 'Error') });
    return json({ ok: false, error: 'unavailable' }, 500, { noStore: true });
  }
};
