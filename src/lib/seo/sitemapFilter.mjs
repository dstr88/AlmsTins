// Which pages the sitemap submits to search engines. Used by astro.config.mjs.
//
// Under /verify/ and /receivables/ the rule is an ALLOWLIST: only the public landings are
// submitted. Everything else there is a signed-in desk or a single-use-link page, and a
// sitemap is a public list, so a page that should stay unannounced must never appear in
// it. The allowlist names only public paths, so it never spells a private one.
//
// Every page under /guides/ is submitted: guides are public, indexable pages by design.
//
// Everywhere else the existing denylist applies unchanged.
//
// The tax pages (/tax, /tax-login, /year-summary) are left out: tax documents are the
// owner's alone (src/lib/taxAuth.ts), so for anyone else these paths are only redirects,
// and Almstins does not present itself to search engines as a tax product. Exact paths,
// so a public page whose name merely contains "tax" is unaffected.
//
// PetroTins pages are left out entirely while PetroTins is owner-only (PETRO_TINS_PUBLIC in
// src/lib/petroTinsFlag.mjs); they come back on their own when it is made public.
//
// @astrojs/sitemap passes absolute URLs ("https://almstins.com/verify/"), so match on the
// pathname, with or without a trailing slash.

import { PETRO_TINS_PUBLIC } from '../petroTinsFlag.mjs';

const PUBLIC_UNDER_PRODUCT_PREFIXES = new Set([
	'/verify/',
	'/verify/es/',
	'/verify/fr/',
	'/verify/agents/',
	'/receivables/',
]);

const OWNER_ONLY_PATHS = new Set(['/tax/', '/tax-login/', '/year-summary/']);

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
	if (OWNER_ONLY_PATHS.has(withSlash.toLowerCase())) return false;
	if (!PETRO_TINS_PUBLIC && withSlash.toLowerCase().startsWith('/petro-tins/')) return false;
	if (withSlash.startsWith('/verify/') || withSlash.startsWith('/receivables/')) {
		return PUBLIC_UNDER_PRODUCT_PREFIXES.has(withSlash);
	}
	// Guides are public by design, so a slug that happens to hold a denylisted word
	// ("welcome", "success", "cancel", ...) is still submitted.
	if (withSlash.startsWith('/guides/')) return true;
	return !DENY_SUBSTRINGS.some((s) => page.includes(s));
}
