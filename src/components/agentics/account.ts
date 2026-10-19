/**
 * What the answer to "delete my account" means for the account page. Pure, so every outcome is a plain
 * assertion. The request is POST /api/account/delete, the one the rest of the app uses: it cancels a paid
 * plan first (and keeps the whole account if that cannot be confirmed), then removes the account in one
 * transaction. Nothing here deletes anything; the page only asks.
 */
import type { ApiResult } from './client';
import { copy } from './copy';

export type DeleteOutcome = { kind: 'deleted' } | { kind: 'kept'; text: string };

export function deleteOutcome(r: ApiResult): DeleteOutcome {
  if (r.ok && r.body?.ok === true) return { kind: 'deleted' };
  if (r.status === 0) return { kind: 'kept', text: copy.account.network };
  // A paid plan that could not be canceled keeps the account whole, and says why.
  if (r.body?.code === 'billing_cancel_failed') return { kind: 'kept', text: copy.account.billingFailed };
  return { kind: 'kept', text: copy.account.failed };
}
