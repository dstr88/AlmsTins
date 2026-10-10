/**
 * The shell Almstins' public JSON endpoints share: one set of headers, and one way to answer
 * "too many requests" and "wrong method", so the public surfaces cannot drift apart.
 *
 * Built only on src/lib/rateLimit.ts (the keyed tier will add src/lib/agentKeys.ts).
 *
 * No CORS by default. An endpoint that serves browsers on other origins adds
 * Access-Control-Allow-Origin itself, on exactly the responses that need it, so a public read
 * never becomes cross-origin by accident. Every answer is no-store: these are live reads of a
 * registry that changes, and a cached "not found" or "unfinanced" is a wrong answer.
 */
import { clientIpKey, type FixedWindowLimiter } from '@/lib/rateLimit';

export const PUBLIC_JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	'Content-Type': 'application/json',
	'Cache-Control': 'no-store',
});

/** A JSON answer with the public headers, plus any extra headers given. */
export function publicJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { ...PUBLIC_JSON_HEADERS, ...extra } });
}

/** 429 with the endpoint's own body and a Retry-After in whole seconds. */
export function tooManyRequests(body: unknown, retryAfterSeconds: number): Response {
	return publicJson(body, 429, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) });
}

/** 405 with the endpoint's own body and an Allow header naming the methods it does take. */
export function methodNotAllowed(body: unknown, allow: string): Response {
	return publicJson(body, 405, { Allow: allow });
}

/**
 * A per-client IP limiter for public read endpoints such as the receivables lookup: count one
 * hit against the caller's IP bucket (clientIpKey: the trusted client address, an IPv6 address
 * by its /64). Returns the 429 to send when that bucket is over the limiter's budget, or null to
 * go ahead.
 *
 * Not an anonymous tier for "Seen before?": those answers have no anonymous branch and always
 * need a signed-in session or an agent key (owner decision 9, Oct 10).
 */
export function admitByIp(
	limiter: FixedWindowLimiter,
	request: Request,
	over: { body: unknown; retryAfterSeconds: number },
): Response | null {
	if (!limiter.hit(clientIpKey(request))) return null;
	return tooManyRequests(over.body, over.retryAfterSeconds);
}
