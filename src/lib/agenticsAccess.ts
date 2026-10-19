/**
 * Agent Vault access. Owner-only while AGENTICS_VAULT_PUBLIC (./agenticsFlag.mjs) is false.
 *
 * The Agent Vault is the owner-private side of Agentics: one tin per agent, the destinations that
 * agent may send to, and (in later slices) the log of what it sent. Until the flag is flipped,
 * every Vault surface (every page under /dashboard/agentics/ and every /api/agentics endpoint)
 * answers anyone but the owner the way the app answers a path that does not exist: the 404 page,
 * with no redirect to a sign-in page and no hint that the page exists. Demo sessions, other
 * signed-in accounts and signed-out visitors are all refused.
 *
 * One path under that prefix is NOT the Vault: the exact path /dashboard/agentics, the free-signup
 * door's welcome letter (src/pages/dashboard/agentics/index.astro), which every signed-in,
 * non-demo account lands on after /agentics/login. It is exempt (isAgenticsDoorPath), so it goes
 * through the normal middleware chain exactly as it did before the Vault existed: a signed-out
 * visitor is sent to the Agentics sign-in, a demo session to the same sign-in by the page itself,
 * everyone else gets the letter. The exemption is the exact path, decided on the normalized path
 * (below) and never a prefix, so /dashboard/agentics/<anything> stays hidden.
 *
 * Deliberately NOT gated, because they are live and public: the Agentics landing /agentics, its
 * docs /agentics/docs and its sign-in /agentics/login, and the pre-send check /api/verify/check.
 * /agentics is why the prefix list below holds the two Vault prefixes only, never the bare word.
 *
 * This is the same gate as PetroTins (./petroTinsAccess.ts), kept as its own module so the two
 * products can be opened, closed or removed independently. src/middleware.ts calls
 * agenticsGate before anything else can render or run, so no public path entry and no page or
 * endpoint can bypass it. A refused request never reaches the Vault page or endpoint. Its first
 * pass answers a 404 with no body (agenticsRefusal), which Astro answers by rendering its own
 * 404 page for that same request, running the middleware again for that render (the gate's
 * 'not-found-page' case). A viewer with a session or the demo cookie goes through app.ts on
 * both passes, like an unknown path does, so the redirects, the demo write block and the
 * headers match too. Every Vault endpoint also checks canAccessAgenticsVault itself, so a
 * future change to this gate cannot open the data on its own.
 *
 * Import-light on purpose: src/middleware.ts loads this module for every request, so it must
 * never statically import db.ts or anything that does. The session is resolved through a
 * dynamic import, and only for Vault paths.
 */
import { isOwner } from './owner';
import { AGENTICS_VAULT_PUBLIC } from './agenticsFlag.mjs';

export { AGENTICS_VAULT_PUBLIC };

const AGENTICS_VAULT_PREFIXES = ['/dashboard/agentics', '/api/agentics'] as const;

/**
 * The door's welcome letter: the one exact path under a Vault prefix that is not the Vault. Never a
 * prefix: nothing below it is exempt.
 */
const AGENTICS_DOOR_PATH = '/dashboard/agentics';

/** Everything before the first `?` or `#`. */
const pathOnly = (s: string) => s.split(/[?#]/, 1)[0];

/**
 * The path as the gate compares it, for the Vault and the door alike.
 *
 * The middleware sees the raw request path, but Astro's router decodes it once (decodeURI) and
 * drops one leading slash before matching. This normalizes more than Astro does: it decodes up
 * to three times, turns backslashes into slashes, collapses every run of slashes, lowercases,
 * and ignores trailing slashes and any query or hash. Every variant Astro routes is therefore
 * covered, and gating a variant that routes nowhere costs nothing. Dot segments are not
 * resolved: the URL parser has already resolved them (a literal or %2e dot segment) by the time
 * the middleware reads a pathname, and any text left after /dashboard/agentics/ stays gated.
 */
export function normalizeAgenticsPath(pathname: string): string {
	let p = pathOnly(String(pathname ?? ''));
	for (let i = 0; i < 3; i++) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(p);
		} catch {
			break;
		}
		if (decoded === p) break;
		p = decoded;
	}
	return pathOnly(p)
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.toLowerCase()
		.replace(/\/+$/, '');
}

/**
 * True for the door's welcome letter and nothing else: the normalized path is exactly
 * /dashboard/agentics (so /dashboard/agentics/ and a query or hash on it count, every spelling
 * Astro routes to that page counts, and anything after it does not).
 */
export function isAgenticsDoorPath(pathname: string): boolean {
	return normalizeAgenticsPath(pathname) === AGENTICS_DOOR_PATH;
}

/**
 * True for any path Astro could route to a Vault page or endpoint, in any spelling
 * (normalizeAgenticsPath), except the door's welcome letter (isAgenticsDoorPath). The exemption is
 * decided after normalizing, so no spelling of a Vault path can pass as the door.
 */
export function isAgenticsVaultPath(pathname: string): boolean {
	const p = normalizeAgenticsPath(pathname);
	if (p === AGENTICS_DOOR_PATH) return false;
	return AGENTICS_VAULT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export type AgenticsViewer = { tenantId?: string | null; isDemo?: boolean } | null | undefined;

/**
 * Whether this viewer is the deployment owner, for the one use outside the gate: telling the analytics
 * tag that the owner's own visits to the Agentics pages are internal, the way the app's Layout does for
 * its own pages. It is not an access rule (canAccessAgenticsVault is), and the Agentics pages ask it of
 * this file so that the gate stays the one place in the front end that knows who the owner is.
 */
export function isInternalAgenticsViewer(session: AgenticsViewer): boolean {
	return isOwner(session?.tenantId ?? null);
}

/**
 * Whether this session may use the Agent Vault. Owner-only while the flag is false; otherwise
 * any real (non-demo) session that has a tenant. Never a signed-out or demo viewer.
 */
export function canAccessAgenticsVault(session: AgenticsViewer, isPublic: boolean = AGENTICS_VAULT_PUBLIC): boolean {
	if (!session || session.isDemo || !session.tenantId) return false;
	return isPublic ? true : isOwner(session.tenantId);
}

/**
 * The viewer, resolved the way the Vault endpoints resolve it (requireTenantSession: a real
 * session wins over the demo cookie, the demo cookie alone is the demo tenant, an older token
 * without a tenant ID falls back to the database). Null when signed out or when the session
 * cannot be resolved.
 */
export async function resolveAgenticsViewer(request: Request): Promise<AgenticsViewer> {
	try {
		const { requireTenantSession } = await import('./requireTenantSession');
		return await requireTenantSession(request);
	} catch {
		return null;
	}
}

/**
 * The gate's decision:
 *   open:   not a Vault path (this includes the door's welcome letter, isAgenticsDoorPath), or the
 *           Vault is open to every account. Nothing to do.
 *   owner:  the owner on a Vault path. Let through, with private headers.
 *   hidden: anyone else on a Vault path. Refuse (agenticsRefusal); nothing in the Vault runs.
 *           `hasSession` is true for a signed-in or demo viewer, who goes through app.ts like
 *           any unknown path; a signed-out visitor skips it (app.ts would send them to sign in).
 *   not-found-page: Astro is now rendering its 404 page (route /404, never a Vault route) for a
 *           request refused on its first pass. Render it as for an unknown path.
 */
export type AgenticsGate =
	| { kind: 'open' }
	| { kind: 'owner' }
	| { kind: 'hidden'; hasSession: boolean }
	| { kind: 'not-found-page'; hasSession: boolean };

/** Requests refused on their first pass (value: hasSession), until Astro renders their 404 page. */
const refused = new WeakMap<Request, boolean>();

/**
 * The middleware gate. `routePattern` is the route Astro is rendering (context.routePattern).
 * Fails closed: if the session cannot be resolved, the request is hidden.
 */
export async function agenticsGate(request: Request, pathname: string, routePattern?: string): Promise<AgenticsGate> {
	if (AGENTICS_VAULT_PUBLIC) return { kind: 'open' };
	const refusedWithSession = refused.get(request);
	if (refusedWithSession !== undefined && routePattern === '/404') {
		return { kind: 'not-found-page', hasSession: refusedWithSession };
	}
	if (!isAgenticsVaultPath(pathname)) return { kind: 'open' };
	const viewer = await resolveAgenticsViewer(request);
	if (canAccessAgenticsVault(viewer)) return { kind: 'owner' };
	return { kind: 'hidden', hasSession: !!viewer };
}

/**
 * The refusal, on the first pass: a 404 with no body. The Vault page or endpoint never runs.
 * Astro answers a bodiless 404 by rendering its 404 page for this same request (the page and the
 * path it shows are then exactly those of a path that does not exist) and merging this
 * response's headers into it; the gate's 'not-found-page' case handles that render.
 */
export function agenticsRefusal(request: Request, hasSession: boolean): Response {
	refused.set(request, hasSession);
	return new Response(null, { status: 404 });
}

/**
 * The owner's Vault responses: never stored by the browser or any shared cache (the same URL is
 * a 404 for everyone else), keyed on the cookie, never indexed.
 */
export function withAgenticsOwnerHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'private, no-store');
	const vary = headers.get('Vary');
	if (!vary || !/(^|,)\s*cookie\s*(,|$)/i.test(vary)) headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
	headers.set('X-Robots-Tag', 'noindex, nofollow');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
