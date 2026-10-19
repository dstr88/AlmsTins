/**
 * What the answer to "delete my account" means for the account page. Pure, so every outcome is a plain
 * assertion. The request is POST /api/account/delete, the one the rest of the app uses: it cancels a paid
 * plan first (and keeps the whole account if that cannot be confirmed), then removes the account in one
 * transaction. Nothing here deletes anything; the page only asks.
 *
 * The words never claim more than is known. "Your account was not deleted" is only said when the app itself
 * said so (a paid plan it could not cancel). A request that got no answer, or an answer from the host in front
 * of the app, may have finished: that says so, and tells the person how to find out.
 */
import type { ApiResult } from './client';
import { copy } from './copy';

export type DeleteOutcome = { kind: 'deleted' } | { kind: 'kept'; text: string };

/** How long the page waits for the delete request before it says it does not know. The host cuts a request at 30 seconds. */
export const DELETE_WAIT_MS = 35_000;

export function deleteOutcome(r: ApiResult): DeleteOutcome {
  if (r.ok && r.body?.ok === true) return { kind: 'deleted' };
  // No answer at all (a dropped connection, or the wait ran out): the request may have finished.
  if (r.status === 0) return { kind: 'kept', text: copy.account.unclear };
  // A paid plan that could not be canceled keeps the account whole, and says why.
  if (r.body?.code === 'billing_cancel_failed') return { kind: 'kept', text: copy.account.billingFailed };
  // The session is gone: either the account is (a repeat of a request that finished), or the session ran out.
  if (r.status === 401) return { kind: 'kept', text: copy.account.signedOut };
  // The host or a proxy answered, not the app (no JSON): whether the app finished is not known.
  if (r.status >= 500 && r.body === null) return { kind: 'kept', text: copy.account.unclear };
  return { kind: 'kept', text: copy.account.failed };
}

/**
 * A request raced against a clock: after `ms` it answers like a request that got no answer (status 0), so a
 * hung request ends the wait instead of leaving the button on "Deleting". The request itself is not canceled.
 */
export async function withWait(request: Promise<ApiResult>, ms: number = DELETE_WAIT_MS): Promise<ApiResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<ApiResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: 0, ok: false, body: null }), ms);
  });
  try {
    return await Promise.race([request, clock]);
  } finally {
    clearTimeout(timer);
  }
}
