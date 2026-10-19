/**
 * The plain words for an error code the Vault's API answered with. One place, so every form on
 * the Agentics pages says the same thing, and a code this page does not know (or one that is not
 * a code at all) is the plain fallback rather than anything the server sent.
 */
import { copy } from './copy';

/** What a create over a limit says: the cap it ran into and what the plan covers, calmly. */
export function planLimitText(cap: unknown, limit: unknown): string {
  if (typeof cap === 'string' && Object.prototype.hasOwnProperty.call(copy.plan.limit, cap) && typeof limit === 'number' && Number.isFinite(limit)) {
    return copy.plan.limit[cap as keyof typeof copy.plan.limit](limit);
  }
  return copy.errors.plan_limit;
}

/** `extra` carries what a `plan_limit` answer adds to the code: the cap and its limit. */
export function errorText(code: unknown, extra: { cap?: unknown; limit?: unknown } = {}): string {
  if (code === 'plan_limit') return planLimitText(extra.cap, extra.limit);
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(copy.errors, code) ? copy.errors[code] : copy.errors.generic;
}
