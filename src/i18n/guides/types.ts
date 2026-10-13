/**
 * The shape of one public guide (the weekly search series under /guides/<slug>).
 *
 * A guide is copy as data: src/components/guides/GuidePage.astro renders any GuideCopy, and a
 * thin page under src/pages/guides/ passes one in. Paragraphs, list items, FAQ answers and
 * source entries are inline markup (src/lib/guides/inline.ts), so every citation stays inline
 * and exactly as written. FAQ questions are plain text; the FAQPage JSON-LD is built from the
 * same items the page shows.
 *
 * House rules for guide copy (pinned by tests/seo/guides.test.ts): American English, no em
 * dashes, outside links only to official US government sources, and the not-tax-advice line
 * once, in the body where the reviewed draft puts it (the template adds no copy of its own).
 * Almstins organizes records; it never files taxes, gives tax advice or promises how anything
 * will be treated.
 */

export interface GuideLink {
	label: string;
	href: string;
	/** rel="nofollow", for links crawlers should not follow (e.g. /api/demo/start). */
	nofollow?: boolean;
	primary?: boolean;
}

export type GuideBlock =
	| { kind: 'p'; md: string }
	| { kind: 'ul'; items: string[] }
	| { kind: 'ol'; items: string[] }
	| { kind: 'cta'; links: GuideLink[] };

export interface GuideSection {
	id: string;
	h2: string;
	blocks: GuideBlock[];
}

export interface GuideFaqItem {
	/** Plain text. */
	q: string;
	/** Inline markup; the JSON-LD carries its plain text. */
	a: string;
}

export interface GuideSourceGroup {
	heading: string;
	items: string[];
}

export interface GuideCopy {
	lang: 'en';
	/** The path, e.g. '/guides/crypto-holding-period-after-transfer'. */
	slug: string;
	/** https://almstins.com + slug, no trailing slash (the repo convention). */
	canonical: string;
	meta: { title: string; description: string };
	nav: { brand: string; links: GuideLink[] };
	eyebrow: string;
	h1: string;
	/** Shown near the top; iso is the same day as YYYY-MM-DD (JSON-LD dateModified). */
	reviewed: { label: string; iso: string };
	/** YYYY-MM-DD (JSON-LD datePublished). */
	published: string;
	/** Blocks before the first section (the short answer). */
	intro: GuideBlock[];
	sections: GuideSection[];
	faq: { id: string; heading: string; items: GuideFaqItem[] };
	sources: { id: string; heading: string; intro: string; groups: GuideSourceGroup[] };
}
