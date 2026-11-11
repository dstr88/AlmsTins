/**
 * Which Almstins service a sign-in was headed for, and how it signed in, so the new-tenant
 * notice can say "Verify, Google" instead of nothing.
 *
 * Every login page posts a callbackUrl: /login returns to /dashboard/vault, /verify/login to
 * /dashboard/verify or a desk, /agentics/login to /dashboard/agentics. Auth.js carries it
 * through every method: in the form body for a password sign-in, in the callbackUrl query of
 * the emailed link, and in its callback-url cookie for Google and GitHub. The auth route reads
 * it once per request and runs Auth.js inside `runWithSignInContext`; the signIn callback adds
 * the method; tenant creation reads both with `getSignInContext`.
 *
 * This is a label for the owner's notice, not an access rule: nothing here grants or refuses a
 * product. A destination that cannot be read, or one outside every service, reads "Unknown".
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { verifyLoginMode } from './verifyLoginMode';

export type SignupServiceId = 'wallet-watcher' | 'verify' | 'receivables' | 'agent-vault' | 'unknown';

export interface SignupService {
	id: SignupServiceId;
	/** The service as the /learn page names it. */
	label: string;
}

const SERVICES: Record<SignupServiceId, SignupService> = {
	'wallet-watcher': { id: 'wallet-watcher', label: 'Wallet Watcher (almstins.com)' },
	verify: { id: 'verify', label: 'Verify' },
	receivables: { id: 'receivables', label: 'Receivables' },
	'agent-vault': { id: 'agent-vault', label: 'Agent Vault' },
	unknown: { id: 'unknown', label: 'Unknown' },
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The internal path of a callbackUrl: a relative path as given, or the path of an absolute URL.
 * Null for anything else (empty, unparsable, a protocol-relative "//host" URL).
 */
export function destinationPath(callbackUrl: string | null | undefined): string | null {
	const raw = (callbackUrl ?? '').trim();
	if (!raw) return null;
	if (raw.startsWith('/') && !raw.startsWith('//')) return raw.split(/[?#]/)[0] || null;
	try {
		return new URL(raw).pathname || null;
	} catch {
		return null;
	}
}

/** The service a return path belongs to. */
export function serviceForPath(path: string | null | undefined): SignupService {
	const p = destinationPath(path);
	if (!p) return SERVICES.unknown;
	if (under(p, '/dashboard/agentics') || under(p, '/agentics')) return SERVICES['agent-vault'];
	if (p === '/verify' || p === '/verify/') return SERVICES.verify;
	if (under(p, '/dashboard/verify') || under(p, '/verify') || under(p, '/receivables')) {
		// The Verify sign-in serves both services; its own rule decides which door this is.
		return verifyLoginMode(p) === 'verify' ? SERVICES.verify : SERVICES.receivables;
	}
	return SERVICES['wallet-watcher'];
}

/** A sign-in method as the notice words it. */
export function methodLabel(provider: string | null | undefined): string {
	switch (provider) {
		case 'google':
			return 'Google';
		case 'github':
			return 'GitHub';
		case 'email':
			return 'Email link';
		case 'credentials':
			return 'Email and password';
		default:
			return 'Unknown';
	}
}

/** The value of one cookie, URL-decoded, or null. */
function readCookie(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(';')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() !== name) continue;
		try {
			return decodeURIComponent(part.slice(eq + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Where this auth request is headed: the callbackUrl query (the emailed link), then the form's
 * callbackUrl (a password sign-in), then Auth.js's callback-url cookie (Google, GitHub).
 */
export function callbackUrlFromRequest(request: Request, formCallbackUrl?: string | null): string | null {
	let query: string | null = null;
	try {
		query = new URL(request.url, 'https://placeholder').searchParams.get('callbackUrl');
	} catch {
		query = null;
	}
	const cookies = request.headers.get('cookie');
	return (
		query ||
		formCallbackUrl ||
		readCookie(cookies, '__Secure-authjs.callback-url') ||
		readCookie(cookies, 'authjs.callback-url') ||
		null
	);
}

/**
 * The callbackUrl field of a form POST, read from a clone so the original body stays unread for
 * Auth.js. Null for any other request, or when the body cannot be read.
 */
export async function formCallbackUrl(request: Request): Promise<string | null> {
	if (request.method !== 'POST') return null;
	const type = request.headers.get('content-type') ?? '';
	if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) return null;
	try {
		const value = (await request.clone().formData()).get('callbackUrl');
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}

export interface SignInContext {
	service: SignupService;
	/** The provider id once the signIn callback knows it (google, github, email, credentials). */
	provider: string | null;
}

const storage = new AsyncLocalStorage<SignInContext>();

/** Run one auth request with its destination recorded. */
export function runWithSignInContext<T>(callbackUrl: string | null, fn: () => T): T {
	return storage.run({ service: serviceForPath(callbackUrl), provider: null }, fn);
}

/** The current auth request's context, or undefined outside one (onboarding, scripts). */
export function getSignInContext(): SignInContext | undefined {
	return storage.getStore();
}

/** Record the sign-in method on the current context; a no-op outside one. */
export function noteSignInProvider(provider: string | null | undefined): void {
	const ctx = storage.getStore();
	if (ctx && provider) ctx.provider = provider;
}
