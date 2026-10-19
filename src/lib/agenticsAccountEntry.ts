/**
 * Who may see /agentics/account, and where everyone else goes. A pure rule, so each case is a plain assertion.
 *
 * The page needs a real session with an account behind it. Three visitors are not that, and they go to
 * three places:
 *
 *   - No session at all, or a demo session (the shared demo tenant): the Agentics sign-in, back to this page.
 *   - A real sign-in that has no account yet (a user with no tenant): the account set-up. Sending this visitor to
 *     the sign-in would loop: the sign-in sees a signed-in user and sends them straight back here.
 *   - A real session with an account: the page.
 *
 * `signedIn` is whether the request carries a real sign-in (an Auth.js session with a user), apart from the demo
 * cookie. `session` is what requireTenantSession answered: null when there is no sign-in or no account.
 */
export const ACCOUNT_SIGN_IN = '/agentics/login?next=%2Fagentics%2Faccount';
export const ACCOUNT_SET_UP = '/onboarding/tenant-setup';

export type AccountEntry<S extends { tenantId: string; isDemo?: boolean }> = { kind: 'page'; session: S } | { kind: 'redirect'; to: string };

export function accountEntry<S extends { tenantId: string; isDemo?: boolean }>(input: { signedIn: boolean; session: S | null }): AccountEntry<S> {
  const { signedIn, session } = input;
  if (session && !session.isDemo) return { kind: 'page', session };
  if (signedIn && !session) return { kind: 'redirect', to: ACCOUNT_SET_UP };
  return { kind: 'redirect', to: ACCOUNT_SIGN_IN };
}
