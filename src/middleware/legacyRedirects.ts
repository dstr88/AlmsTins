/**
 * The move of the financing pages from /verify/<name> to /receivables/<name>.
 * Pure: no db, no env, no I/O. Called first in src/middleware.ts, after the geoblock.
 *
 * Phases (see the restructure plan, section 4.3):
 *   alias     today. The pages still live under /verify/. /receivables/<name> is served by
 *             rewriting to /verify/<name> with the query string verbatim. /verify/* unchanged.
 *   rewrite   after the files move. /verify/<name> is served by rewriting to /receivables/<name>.
 *   redirect  final. /verify/<name> answers 308 to /receivables/<name>, forever.
 *
 * NEVER REMOVE A PAIR. Emailed tokens (7 to 14 days; offers up to 90), ?id= links (no expiry),
 * printed run sheets, chat threads and magic links depend on these. Exact paths only, with one
 * optional trailing slash: never a /verify prefix (it would catch /verify-record), and never a
 * /verify/cairn prefix (it would catch cairn-attest).
 */
import { safeNextPath } from '../lib/safeNext';

const MOVED = [
  'registry', 'desk', 'client', 'confirm', 'invite', 'offer', 'countersign', 'attest',
  'authenticate', 'runsheet', 'guide', 'changelog', 'thanks', 'faq',
] as const;

export const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ...MOVED.map((p) => [`/verify/${p}`, `/receivables/${p}`] as const),
  ['/verify/cairn', '/receivables/milestones'],
  ['/verify/cairn-attest', '/receivables/milestone-check'],
  // Takes effect only once the static demo file is replaced by a page (redirect phase).
  ['/artifacts/cairn', '/receivables/milestones-demo'],
];

export type RouteMode = 'alias' | 'rewrite' | 'redirect';
export const ROUTE_MODE: RouteMode = 'alias';
export const FORWARD_FINANCING_LOGIN = false;

const OLD_TO_NEW = new Map<string, string>(PAIRS);
// The private milestone pages are left out of the alias phase: nothing links to their new
// names yet, and a guessable /receivables name answering differently from a made-up one
// would announce that the desk exists. They join in the rewrite phase, when links use them.
const PRIVATE_OLD = new Set(['/verify/cairn', '/verify/cairn-attest']);
const NEW_TO_OLD = new Map<string, string>([
  ...PAIRS.filter(([o]) => !o.startsWith('/artifacts/') && !PRIVATE_OLD.has(o))
    .map(([o, n]) => [n, o] as [string, string]),
  // Alias phase only: the financing sign-in is the /verify/login page until it gets its own.
  ['/receivables/login', '/verify/login'],
]);

const strip = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

const respond = (status: 307 | 308, location: string) =>
  new Response(null, {
    status,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });

const ROLE: Record<string, string> = { financier: 'financier', client: 'client', borrower: 'client', buyer: 'buyer' };

export type LegacyAction =
  | { kind: 'rewrite'; to: string }
  | { kind: 'respond'; response: Response }
  | null;

/** What the middleware should do with this URL, if anything. The query string is kept verbatim. */
export function routeLegacy(
  url: URL,
  mode: RouteMode = ROUTE_MODE,
  forward: boolean = FORWARD_FINANCING_LOGIN,
): LegacyAction {
  const p = strip(url.pathname);
  if (!(p.startsWith('/verify/') || p.startsWith('/receivables/') || p === '/artifacts/cairn')) return null;

  if (mode === 'alias') {
    // A bare /receivables/login is the role-neutral financing sign-in that returns to the
    // landing; a bare /verify/login is the Verify sign-in, so give it the landing as `next`.
    if (p === '/receivables/login' && !url.searchParams.has('next') && !url.searchParams.has('callbackUrl')) {
      const rest = url.search ? '&' + url.search.slice(1) : '';
      return { kind: 'rewrite', to: `/verify/login?next=%2Freceivables${rest}` };
    }
    const old = NEW_TO_OLD.get(p);
    return old ? { kind: 'rewrite', to: old + url.search } : null;
  }

  const neu = OLD_TO_NEW.get(p);
  if (neu) {
    return mode === 'rewrite'
      ? { kind: 'rewrite', to: neu + url.search }
      : { kind: 'respond', response: respond(308, neu + url.search) };
  }

  if (forward && p === '/verify/login') {
    const target = financingNext(url.searchParams.get('next') ?? url.searchParams.get('callbackUrl'));
    if (target) {
      const q = new URLSearchParams({ next: target });
      const role = ROLE[url.searchParams.get('role') ?? ''];
      if (role) q.set('role', role);
      return { kind: 'respond', response: respond(307, `/receivables/login?${q}`) };
    }
  }
  return null;
}

/** A safe `next` that points at a financing page, mapped to its /receivables path; else null. */
export function financingNext(raw: string | null): string | null {
  const safe = safeNextPath(raw);
  if (!safe) return null;
  const u = new URL(safe, 'https://x.invalid');
  const p = strip(u.pathname);
  const mapped = OLD_TO_NEW.get(p);
  if (mapped) return mapped + u.search;
  return (p === '/receivables' || p.startsWith('/receivables/')) && p !== '/receivables/login' ? p + u.search : null;
}
