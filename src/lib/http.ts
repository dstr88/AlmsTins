/**
 * The one JSON response helper for API routes, so the headers every route sends are set in
 * one place instead of in a local copy per file.
 *
 * Always sends Content-Type: application/json. `noStore` adds Cache-Control: no-store,
 * `pretty` indents the body by two spaces, and `headers` are laid on top last (a key given
 * there wins over the defaults, with the same spelling).
 *
 * The public read endpoints use src/lib/http/publicApi.ts instead (no-store always, plus 429
 * and 405 helpers); it is pinned to depend on rateLimit.ts only, so it keeps its own copy.
 */

export interface JsonOptions {
	/** Extra headers, applied after the defaults. */
	headers?: Record<string, string>;
	/** Indent the body (JSON.stringify(body, null, 2)). */
	pretty?: boolean;
	/** Add Cache-Control: no-store. */
	noStore?: boolean;
}

export function json(body: unknown, status = 200, options: JsonOptions = {}): Response {
	const { headers, pretty = false, noStore = false } = options;
	return new Response(pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...(noStore ? { 'Cache-Control': 'no-store' } : {}),
			...headers,
		},
	});
}
