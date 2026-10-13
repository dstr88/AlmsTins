/**
 * Which door /verify/login is serving, decided by the `next` path the visitor is
 * headed to. The page uses it for its heading, blurb, and what sits under the card.
 *
 *   verify       Almstins Verify proper: the merchant dashboard, agent keys, and a bare
 *                /verify/login with no `next` (what someone types by hand).
 *   financier    the receivables financing desk (/verify/desk or /receivables/desk).
 *   project      the project desk (a financier too, with its own blurb).
 *   receivables  the /receivables landing: a role-neutral sign-in that returns there,
 *                so each person picks their own desk.
 *   client       every other financing destination (client portal, confirm, invite, ...).
 *
 * Matching is on whole path segments of an internal path, with any query or hash
 * ignored, so `/dashboard/verifyx` or a `next` that merely mentions a desk path
 * inside its query string never flips the mode.
 */
export type VerifyLoginMode = 'verify' | 'financier' | 'project' | 'receivables' | 'client';

const VERIFY_PATHS = ['/dashboard/verify', '/verify/agent-keys'];
const FINANCIER_PATHS = ['/verify/desk', '/receivables/desk'];
const PROJECT_PATHS = ['/verify/cairn', '/receivables/milestones'];

export function verifyLoginMode(next: string | null | undefined): VerifyLoginMode {
  const path = (next ?? '').split(/[?#]/)[0];
  const under = (p: string) => path === p || path.startsWith(p + '/');
  if (path === '') return 'verify';
  if (VERIFY_PATHS.some(under)) return 'verify';
  if (FINANCIER_PATHS.some(under)) return 'financier';
  if (PROJECT_PATHS.some(under)) return 'project';
  if (path === '/receivables' || path === '/receivables/') return 'receivables';
  return 'client';
}
