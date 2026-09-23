/**
 * Which door /verify/login is serving, decided by the `next` path the visitor is
 * headed to. The page uses it for its heading, blurb, and what sits under the card.
 *
 *   verify     Almstins Verify proper: the merchant dashboard and agent keys.
 *   financier  the receivables financing desk.
 *   project    the project desk (a financier too, with its own blurb).
 *   client     everything else, including a bare /verify/login with no `next`,
 *              so existing receivables links keep behaving as before.
 *
 * Matching is on whole path segments of an internal path, with any query or hash
 * ignored, so `/dashboard/verifyx` or a `next` that merely mentions a desk path
 * inside its query string never flips the mode.
 */
export type VerifyLoginMode = 'verify' | 'financier' | 'project' | 'client';

const VERIFY_PATHS = ['/dashboard/verify', '/verify/agent-keys'];
const FINANCIER_PATHS = ['/verify/desk'];
const PROJECT_PATHS = ['/verify/cairn'];

export function verifyLoginMode(next: string | null | undefined): VerifyLoginMode {
  const path = (next ?? '').split(/[?#]/)[0];
  const under = (p: string) => path === p || path.startsWith(p + '/');
  if (VERIFY_PATHS.some(under)) return 'verify';
  if (FINANCIER_PATHS.some(under)) return 'financier';
  if (PROJECT_PATHS.some(under)) return 'project';
  return 'client';
}
