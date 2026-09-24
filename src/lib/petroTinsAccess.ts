/**
 * PetroTins access. Owner-only while PETRO_TINS_PUBLIC (./petroTinsFlag.mjs) is false.
 *
 * PetroTins is a personal tool. Until the flag is flipped, every PetroTins surface (the
 * /petro-tins pages, the /dashboard/petro-tins pages and every /api/petro-tins endpoint)
 * answers anyone but the owner the way the app answers a path that does not exist: the 404
 * page, with no redirect to a sign-in page and no hint that the page exists. Demo sessions,
 * other signed-in accounts and signed-out visitors are all refused.
 *
 * src/middleware.ts calls petroTinsGate before anything else can render or run, so no public
 * path entry and no page or endpoint can bypass it. A refused request never reaches the
 * PetroTins page or endpoint. Its first pass answers a 404 with no body (petroTinsRefusal),
 * which Astro answers by rendering its own 404 page for that same request, exactly as for a
 * path that does not exist (same page, same path shown), running the middleware again for that
 * render (the gate's 'not-found-page' case). A viewer with a session or the demo cookie goes
 * through app.ts on both passes, like an unknown path does, so the redirects, the demo write
 * block and the headers match too. Every 404 the middleware returns is no-store and noindex
 * (withNotFoundHeaders in ../middleware/securityHeaders), and the owner's PetroTins responses
 * are private, no-store and noindex (withPetroTinsOwnerHeaders).
 *
 * Known residuals, accepted:
 *   - A signed-out visitor can still tell the PetroTins paths apart: an unknown page sends them
 *     to sign in (303 to /login) and an unknown /api path answers 401, while a PetroTins path
 *     answers the 404 page, because a sign-in redirect would reveal it.
 *   - The PetroTins client bundles (/_astro/PetroTinsGrid.<hash>.js, ReceiptRegistry.<hash>.js,
 *     petro-tins.<hash>.css) are static files the adapter serves before any middleware runs, so
 *     they are NOT gated. They hold UI code and API paths only (the same code is in the public
 *     repo), no data, and only owner-rendered pages link to them.
 *
 * Import-light on purpose: src/middleware.ts loads this module for every request, so it must
 * never statically import db.ts or anything that does. The session is resolved through a
 * dynamic import, and only for PetroTins paths.
 */
import { isOwner } from './owner';
import { PETRO_TINS_PUBLIC } from './petroTinsFlag.mjs';

export { PETRO_TINS_PUBLIC };

const PETRO_TINS_PREFIXES = ['/petro-tins', '/dashboard/petro-tins', '/api/petro-tins'] as const;

/** Everything before the first `?` or `#`. */
const pathOnly = (s: string) => s.split(/[?#]/, 1)[0];

/**
 * True for any path Astro could route to a PetroTins page or endpoint.
 *
 * The middleware sees the raw request path, but Astro's router decodes it once (decodeURI)
 * and drops one leading slash before matching, so `/petro%2Dtins` and `//petro-tins` both
 * reach PetroTins. This normalizes more than Astro does: it decodes up to three times, turns
 * backslashes into slashes, collapses every run of slashes, lowercases, and ignores trailing
 * slashes and any query or hash. Every variant Astro routes is therefore covered, and gating a
 * variant that routes nowhere costs nothing.
 */
export function isPetroTinsPath(pathname: string): boolean {
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
	p = pathOnly(p)
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.toLowerCase()
		.replace(/\/+$/, '');
	return PETRO_TINS_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export type PetroTinsViewer = { tenantId?: string | null; isDemo?: boolean } | null | undefined;

/**
 * Whether this session may use PetroTins. Public mode allows everyone; otherwise only a real
 * (non-demo) session whose tenant is the owner tenant.
 */
export function canAccessPetroTins(session: PetroTinsViewer, isPublic: boolean = PETRO_TINS_PUBLIC): boolean {
	if (isPublic) return true;
	return !!session && !session.isDemo && isOwner(session.tenantId);
}

/**
 * The viewer, resolved the way the PetroTins pages and endpoints resolve it
 * (requireTenantSession: a real session wins over the demo cookie, the demo cookie alone is the
 * demo tenant, an older token without a tenant ID falls back to the database). Null when signed
 * out or when the session cannot be resolved.
 */
export async function resolvePetroTinsViewer(request: Request): Promise<PetroTinsViewer> {
	try {
		const { requireTenantSession } = await import('./requireTenantSession');
		return await requireTenantSession(request);
	} catch {
		return null;
	}
}

type SessionLike = { user?: { id?: string | null } | null; tenantId?: string | null } | null | undefined;

/**
 * Whether an already-read auth session is the PetroTins owner, agreeing with the gate. The
 * tenant comes from the token; an older token without one is resolved the way the gate does.
 * A demo or signed-out viewer (no user) is never the owner.
 */
export async function isPetroTinsOwnerSession(request: Request, session: SessionLike): Promise<boolean> {
	if (!session?.user?.id) return false;
	if (session.tenantId) return isOwner(session.tenantId);
	return canAccessPetroTins(await resolvePetroTinsViewer(request), false);
}

/**
 * Where PetroTins shows up outside its own pages. While owner-only, links and stats render for
 * the owner alone and the public changelog leaves the PetroTins entries out.
 */
export function petroTinsVisibility(
	viewer: { isOwner: boolean; isAdmin?: boolean; isTradfiDomain?: boolean },
	isPublic: boolean = PETRO_TINS_PUBLIC,
) {
	const tradfi = !!viewer.isTradfiDomain;
	return {
		/** tradifitins.com: the PetroTins nav (Dashboard, Docs, Upgrade) instead of the Almstins nav. */
		tradfiNav: tradfi && (isPublic || viewer.isOwner),
		/** The "PetroTins" link in the Almstins nav: every admin while public, the owner alone otherwise. */
		navLink: !tradfi && (isPublic ? !!viewer.isAdmin : viewer.isOwner),
		/** The PetroTins visit stats, routes and pages on the admin and analytics pages. */
		adminStats: isPublic || viewer.isOwner,
		/** The PetroTins entries on the public changelog. */
		changelog: isPublic,
	};
}

/** Rows whose path is not a PetroTins path, or every row when `show` is true. */
export function withoutPetroTinsRows<T>(rows: T[], pathOf: (row: T) => unknown, show: boolean): T[] {
	return show ? rows : rows.filter((row) => !isPetroTinsPath(String(pathOf(row) ?? '')));
}

/**
 * The gate's decision:
 *   open:   not a PetroTins path, or PetroTins is public. Nothing to do.
 *   owner:  the owner on a PetroTins path. Let through, with private headers.
 *   hidden: anyone else on a PetroTins path. Refuse (petroTinsRefusal); nothing PetroTins runs.
 *           `hasSession` is true for a signed-in or demo viewer, who goes through app.ts like
 *           any unknown path; a signed-out visitor skips it (app.ts would send them to sign in).
 *   not-found-page: Astro is now rendering its 404 page (route /404, never a PetroTins route)
 *           for a request refused on its first pass. Render it as for an unknown path.
 */
export type PetroTinsGate =
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
export async function petroTinsGate(request: Request, pathname: string, routePattern?: string): Promise<PetroTinsGate> {
	if (PETRO_TINS_PUBLIC) return { kind: 'open' };
	const refusedWithSession = refused.get(request);
	if (refusedWithSession !== undefined && routePattern === '/404') {
		return { kind: 'not-found-page', hasSession: refusedWithSession };
	}
	if (!isPetroTinsPath(pathname)) return { kind: 'open' };
	const viewer = await resolvePetroTinsViewer(request);
	if (canAccessPetroTins(viewer)) return { kind: 'owner' };
	return { kind: 'hidden', hasSession: !!viewer };
}

/**
 * The refusal, on the first pass: a 404 with no body. The PetroTins page or endpoint never runs.
 * Astro answers a bodiless 404 by rendering its 404 page for this same request (the page and
 * the path it shows are then exactly those of a path that does not exist) and merging this
 * response's headers into it; the gate's 'not-found-page' case handles that render.
 */
export function petroTinsRefusal(request: Request, hasSession: boolean): Response {
	refused.set(request, hasSession);
	return new Response(null, { status: 404 });
}

/**
 * Astro marks a render of its 404 page with X-Astro-Reroute and strips the marker when it serves
 * that page directly. The refused request's 404 page is merged into the refusal instead, where
 * nothing strips it, so it is removed here.
 */
export function withoutRerouteMarker(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.delete('X-Astro-Reroute');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The owner's PetroTins responses: never stored by the browser or any shared cache (the same URL
 * is a 404 for everyone else), keyed on the cookie, never indexed. Overrides a route's own
 * Cache-Control, such as the receipt photo's short private max-age.
 */
export function withPetroTinsOwnerHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'private, no-store');
	const vary = headers.get('Vary');
	if (!vary || !/(^|,)\s*cookie\s*(,|$)/i.test(vary)) headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
	headers.set('X-Robots-Tag', 'noindex, nofollow');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
