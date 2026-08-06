/**
 * The real client IP, chosen so it can't be spoofed by the caller.
 *
 * The trap this replaced: it used to read the LEFTMOST `X-Forwarded-For` entry, which
 * is whatever the client put there (it showed up as `127.0.0.1` in probe logs). Anything
 * built on that — rate limits, bans, geoblock — was acting on an attacker-controlled
 * value and was trivially bypassable by rotating a fake header.
 *
 * Render fronts every service with its own Cloudflare, which sets `cf-connecting-ip` to
 * the real client and OVERWRITES any client-supplied value at the edge, so that header is
 * the one field we can trust. Prefer it above everything. `X-Forwarded-For` is used only
 * as a no-CF (local dev) fallback, and never its leftmost entry: each proxy APPENDS, so
 * the rightmost entry is the address the nearest trusted hop actually saw.
 */
export function getClientIp(request: Request): string | null {
	const cf = request.headers.get('cf-connecting-ip')?.trim();
	if (cf) return cf;

	// Single-value proxy headers, for non-Cloudflare deploys / local proxies.
	const single =
		request.headers.get('x-real-ip')?.trim() ||
		request.headers.get('fly-client-ip')?.trim() ||
		request.headers.get('fastly-client-ip')?.trim();
	if (single) return single;

	// Last resort: X-Forwarded-For, rightmost entry only (never the spoofable leftmost).
	const xff = request.headers.get('x-forwarded-for');
	if (xff) {
		const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
		if (parts.length) return parts[parts.length - 1];
	}

	return null;
}

