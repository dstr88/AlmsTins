// Which pages the sitemap submits to search engines. Used by astro.config.mjs.
//
// Under /verify/ and /receivables/ the rule is an ALLOWLIST: only the public landings are
// submitted. Everything else there is a signed-in desk or a single-use-link page, and a
// sitemap is a public list, so a page that should stay unannounced must never appear in
// it. The allowlist names only public paths, so it never spells a private one.
//
// Everywhere else the existing denylist applies unchanged.
//
// @astrojs/sitemap passes absolute URLs ("https://almstins.com/verify/"), so match on the
// pathname, with or without a trailing slash.

const PUBLIC_UNDER_PRODUCT_PREFIXES = new Set([
	'/verify/',
	'/verify/es/',
	'/verify/fr/',
	'/verify/agents/',
	'/receivables/',
]);

const DENY_SUBSTRINGS = [
	'/dashboard',
	'/admin',
	'/api/',
	'/onboarding',
	'/login',
	'/signup',
	'/cancel',
	'/success',
	'/transition',
	'/welcome',
];

/** @param {string} page absolute URL or path */
export function sitemapFilter(page) {
	let path;
	try {
		path = new URL(page).pathname;
	} catch {
		path = page;
	}
	const withSlash = path.endsWith('/') ? path : `${path}/`;
	if (withSlash.startsWith('/verify/') || withSlash.startsWith('/receivables/')) {
		return PUBLIC_UNDER_PRODUCT_PREFIXES.has(withSlash);
	}
	return !DENY_SUBSTRINGS.some((s) => page.includes(s));
}
