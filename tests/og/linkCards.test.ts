import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OG_AGENTICS_CARD, OG_VERIFY_CARD } from '../../src/lib/ogCards';
import { copy } from '../../src/i18n/verify';
import { agenticsCopy } from '../../src/i18n/agentics';

/**
 * Link-preview cards for /agentics and /verify (EN, ES, FR), Nov 21, 2026. A shared link to
 * either page showed the site-wide wallet image (the tracker). Each now shows its own card in the
 * same family as /receivables: rendered from a committed SVG by scripts/render-og.mjs, 1200x630,
 * small, with alt text, and worded without em dashes or "protect". Reads files only.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = (r: string) => path.join(ROOT, r);
const read = (r: string) => fs.readFileSync(abs(r), 'utf8');

const CARDS = [
	{ svg: 'scripts/og/agentics-og.svg', png: 'public/og-agentics.png', url: OG_AGENTICS_CARD, head: 'Agentics', link: 'almstins.com/agentics' },
	{ svg: 'scripts/og/verify-og.svg', png: 'public/og-verify.png', url: OG_VERIFY_CARD.en, head: 'Verify', link: 'almstins.com/verify' },
	{ svg: 'scripts/og/verify-es-og.svg', png: 'public/og-verify-es.png', url: OG_VERIFY_CARD.es, head: 'Verify', link: 'almstins.com/verify/es' },
	{ svg: 'scripts/og/verify-fr-og.svg', png: 'public/og-verify-fr.png', url: OG_VERIFY_CARD.fr, head: 'Verify', link: 'almstins.com/verify/fr' },
];
const PROTECTS = /protect|proteg|protég|protèg/i;

describe.each(CARDS)('the $head card ($link)', ({ svg, png, url, head, link }) => {
	it('is a 1200x630 PNG, small enough for every preview scraper', () => {
		const buf = fs.readFileSync(abs(png));
		expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
		expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
		expect(buf.readUInt32BE(16)).toBe(1200);
		expect(buf.readUInt32BE(20)).toBe(630);
		expect(buf.length).toBeLessThan(300 * 1024);
	});

	it('is served at the address the page uses', () => {
		expect(url).toBe(`https://almstins.com/${path.basename(png)}`);
	});

	it('comes from a committed 1200x630 SVG with its headline and address, and no em dash or "protect"', () => {
		const s = read(svg);
		expect(s).toMatch(/<svg [^>]*width="1200" height="630" viewBox="0 0 1200 630"/);
		expect(s).toContain(`>${head}<`);
		expect(s).toContain(`>${link}<`);
		expect(s).not.toContain('—');
		expect(s).not.toMatch(PROTECTS);
	});

	it('is rendered by the committed script', () => {
		const script = read('scripts/render-og.mjs');
		expect(script).toContain(`new URL('./og/${path.basename(svg)}', import.meta.url)`);
		expect(script).toContain(`new URL('../public/${path.basename(png)}', import.meta.url)`);
	});
});

describe('the Verify landing (EN, ES, FR)', () => {
	it('passes its language card and alt text to LoginLayout', () => {
		expect(read('src/components/VerifyPage.astro')).toMatch(
			/<LoginLayout [^>]*image=\{OG_VERIFY_CARD\[lang\]\} imageAlt=\{t\.meta\.ogImageAlt\}>/,
		);
	});

	it.each(['en', 'es', 'fr'] as const)('has %s alt text naming its own address, without an em dash or "protect"', (lang) => {
		const alt = copy[lang].meta.ogImageAlt;
		expect(alt).toContain(lang === 'en' ? 'almstins.com/verify' : `almstins.com/verify/${lang}`);
		expect(alt).not.toContain('—');
		expect(alt).not.toMatch(PROTECTS);
	});
});

describe('the Agentics landing', () => {
	const src = () => read('src/pages/agentics/index.astro');

	it('uses the Agentics card, with its size and alt tags', () => {
		expect(src()).toContain('const ogImage = OG_AGENTICS_CARD;');
		expect(src()).not.toContain('og-default.png');
		expect(src()).toContain('<meta property="og:image:width" content="1200" />');
		expect(src()).toContain('<meta property="og:image:height" content="630" />');
		expect(src()).toContain('<meta property="og:image:alt" content={l.ogImageAlt} />');
		expect(src()).toContain('<meta name="twitter:image:alt" content={l.ogImageAlt} />');
	});

	it.each([false, true])('has alt text in both vault states (open: %s)', (open) => {
		const alt = agenticsCopy(open).landing.ogImageAlt;
		expect(alt).toContain('almstins.com/agentics');
		expect(alt).not.toContain('—');
		expect(alt).not.toMatch(PROTECTS);
	});
});
