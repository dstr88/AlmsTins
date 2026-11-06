// The one address a public page is known by, for its canonical tag, its og:url and its sitemap entry.
//
// Always https://almstins.com, never the request's own host: behind Render the server sees itself as
// localhost, and a canonical built from Astro.url told search engines that /about lived at
// https://localhost/about. No trailing slash (the root stays "/"): the auth middleware matches public
// pages exactly, so /about is public while /about/ redirects to the sign-in page, and a sitemap that
// listed /about/ was sending crawlers to a login. No query string: ?utm_source=... is the same page.

export const SITE_ORIGIN = 'https://almstins.com';

/** @param {string} pathname a path ("/about/") or an absolute URL */
export function canonicalUrl(pathname) {
	let path;
	try {
		path = new URL(pathname).pathname;
	} catch {
		path = String(pathname || '/').split(/[?#]/)[0];
	}
	if (!path.startsWith('/')) path = `/${path}`;
	const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
	return `${SITE_ORIGIN}${trimmed || '/'}`;
}
