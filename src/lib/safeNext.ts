/**
 * One sanitizer for every `next=` / post-login / post-logout destination.
 *
 * Returns a same-origin path + query (normalized, hash dropped), or null. Import-free, so
 * it is safe on the server and in the browser.
 *
 * "Starts with a single slash" is not enough on its own. Browsers treat a backslash as a
 * slash, percent-decoding can reveal one, and dot segments can normalize a path into a
 * protocol-relative URL, so each of these must be refused:
 *   /\evil.com   /%5Cevil.com   //evil.com   /%2F%2Fevil.com   /.//evil.com   /..//evil.com
 * The check therefore runs on the raw value, on its decoded form, and on the normalized
 * output, and the output is re-checked once more after decoding.
 */
const BAD = /[\\\u0000-\u001f\u007f]/;
const BASE = 'https://next.invalid';
const looksSafe = (s: string) => s.startsWith('/') && !s.startsWith('//') && !BAD.test(s);

/** A same-origin path + query, normalized, or null. The hash is dropped. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (!looksSafe(raw)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!looksSafe(decoded)) return null;
  let u: URL;
  try { u = new URL(raw, BASE); } catch { return null; }
  if (u.origin !== BASE) return null;
  const out = u.pathname + u.search;
  if (!looksSafe(out)) return null;
  try {
    const again = new URL(decodeURIComponent(out), BASE);
    if (again.origin !== BASE || again.pathname.startsWith('//')) return null;
  } catch { return null; }
  return out;
}

/**
 * Auth.js `redirect` callback: where to send the browser after sign-in or sign-out. Only
 * same-origin destinations that pass safeNextPath; anything else goes to `fallbackPath`.
 */
export function safeAuthRedirect(url: string, baseUrl: string, fallbackPath: string): string {
  const fallback = new URL(fallbackPath, baseUrl).toString();
  if (url === baseUrl || url === `${baseUrl}/`) return fallback;
  if (url.startsWith('/')) {
    const p = safeNextPath(url);
    return p ? new URL(p, baseUrl).toString() : fallback;
  }
  try {
    const u = new URL(url);
    if (u.origin !== new URL(baseUrl).origin) return fallback;
    const p = safeNextPath(u.pathname + u.search);
    return p ? new URL(p, baseUrl).toString() : fallback;
  } catch {
    return fallback;
  }
}
