/**
 * The official US government sites a guide may cite. Every outside link in a guide points at
 * one of these (pinned by tests/seo/guides.test.ts), and the page labels each such link as an
 * official source.
 */
export const OFFICIAL_SOURCE_HOSTS = [
	'irs.gov',
	'ecfr.gov',
	'federalregister.gov',
	'govinfo.gov',
	'uscode.house.gov',
] as const;

/**
 * The listed site an https link points at ("irs.gov" for https://www.irs.gov/...), or null
 * when the link is not on one of them. Only the bare host or its www. form counts.
 */
export function officialSourceHost(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	const host = url.hostname.toLowerCase();
	return OFFICIAL_SOURCE_HOSTS.find((h) => host === h || host === `www.${h}`) ?? null;
}
