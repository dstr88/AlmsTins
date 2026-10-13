/**
 * Structured data for a guide page. GuidePage.astro puts both blocks in <head>.
 *
 * The FAQPage block is built from the same t.faq.items the page shows in its <details> list,
 * with each answer as plain text (link text kept, URLs dropped), so the markup always matches
 * the visible FAQ.
 */
import type { GuideCopy } from '@/i18n/guides/types';
import { plainText } from './inline';

const ORG = { '@type': 'Organization', name: 'Almstins', url: 'https://almstins.com' } as const;

/** JSON for a <script type="application/ld+json"> body; "<" is escaped so no string can close the tag. */
export function ldJson(data: unknown): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function faqPageJsonLd(t: GuideCopy) {
	return {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: t.faq.items.map((item) => ({
			'@type': 'Question',
			name: item.q,
			acceptedAnswer: { '@type': 'Answer', text: plainText(item.a) },
		})),
	};
}

export function articleJsonLd(t: GuideCopy) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Article',
		headline: t.h1,
		description: t.meta.description,
		inLanguage: 'en-US',
		datePublished: t.published,
		dateModified: t.reviewed.iso,
		mainEntityOfPage: t.canonical,
		url: t.canonical,
		image: 'https://almstins.com/og-default.png',
		author: ORG,
		publisher: ORG,
	};
}
