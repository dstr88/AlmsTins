/**
 * How the Agentics pages talk to the Vault's API from the browser. One small wrapper, so every
 * form handles a failed request, a non-JSON answer and a dropped connection the same way and ends
 * in the same plain words (./errors.ts). Nothing here builds HTML or reads anything from the page.
 *
 * `fetch` is a parameter, so the code that sequences several requests (./paste.ts) can be tested
 * with no network.
 */
import type { PlanSummary } from '@/lib/agentVault/entitlements';
import { errorText } from './errors';

/** The browser event that carries a fresh plan summary from a page to the meter. */
export const PLAN_EVENT = 'agentics:plan';

export interface ApiResult {
  /** The HTTP status, or 0 when the request never got an answer. */
  status: number;
  ok: boolean;
  /** The answer's JSON object, or null when there was none. */
  body: Record<string, unknown> | null;
}

export type Send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => Promise<ApiResult>;

/** The browser's fetch, as a Send. A network failure is status 0, never a thrown error. */
export const send: Send = async (method, url, body) => {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as unknown;
    const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    return { status: res.status, ok: res.ok && obj?.ok !== false, body: obj };
  } catch {
    return { status: 0, ok: false, body: null };
  }
};

/** The error code an answer carried: the API's own, `network` when there was no answer, else `server_error`. */
export function codeOf(r: ApiResult): string {
  if (r.status === 0) return 'network';
  return typeof r.body?.error === 'string' ? r.body.error : 'server_error';
}

/** A failed answer in plain words. A `plan_limit` also says which cap and what the plan covers. */
export function failureText(r: ApiResult): string {
  return errorText(codeOf(r), { cap: r.body?.cap, limit: r.body?.limit });
}

/** The plan summary an answer carries (what GET /api/agentics/plan says), or null when it is not one. */
export function planFactsOf(body: Record<string, unknown> | null): PlanSummary | null {
  if (!body) return null;
  const limits = body.limits as Record<string, unknown> | undefined;
  const use = body.use as Record<string, unknown> | undefined;
  const limit = (v: unknown): number | null | undefined => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (!limits || !use || typeof body.plan !== 'string' || typeof body.label !== 'string') return null;
  const [bots, addresses, walletsPerBot] = [limit(limits.bots), limit(limits.addresses), limit(limits.walletsPerBot)];
  if (bots === undefined || addresses === undefined || walletsPerBot === undefined) return null;
  if (typeof use.bots !== 'number' || typeof use.addresses !== 'number') return null;
  return {
    plan: body.plan === 'unlimited' ? 'unlimited' : 'free',
    label: body.label,
    limits: { bots, addresses, walletsPerBot },
    use: { bots: use.bots, addresses: use.addresses },
  };
}

/**
 * Reads the plan again, tells the usage meter in the page's bar (a browser event, so the meter and
 * the page need not know each other), and hands the plan back. Null when it could not be read: the
 * page then keeps what it showed.
 */
export async function announcePlan(call: Send = send): Promise<PlanSummary | null> {
  const plan = planFactsOf((await call('GET', '/api/agentics/plan')).body);
  if (plan && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail: plan }));
  return plan;
}
