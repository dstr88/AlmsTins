import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The receivables link preview (S4): a shared /receivables link shows its own card, not the
 * site-wide wallet image, and the receivables pages' titles use a middle dot, not an em dash.
 * Reads files only.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const abs = (r: string) => path.join(ROOT, r);
const read = (r: string) => fs.readFileSync(abs(r), 'utf8');

describe('public/og-receivables.png', () => {
	const png = fs.readFileSync(abs('public/og-receivables.png'));

	it('is a 1200x630 PNG (IHDR)', () => {
		expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
		expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
		expect(png.readUInt32BE(16)).toBe(1200);
		expect(png.readUInt32BE(20)).toBe(630);
	});

	it('stays small enough for every preview scraper', () => {
		expect(png.length).toBeLessThan(300 * 1024);
	});

	it('is rendered from a committed 1200x630 SVG by a committed script', () => {
		const svg = read('scripts/og/receivables-og.svg');
		expect(svg).toMatch(/<svg [^>]*width="1200" height="630" viewBox="0 0 1200 630"/);
		expect(svg).toContain('>Receivables<');
		expect(svg).toContain('>almstins.com/receivables<');
		expect(svg).not.toContain('—');
		const script = read('scripts/render-og.mjs');
		expect(script).toContain("new URL('./og/receivables-og.svg', import.meta.url)");
		expect(script).toContain("new URL('../public/og-receivables.png', import.meta.url)");
	});
});

describe('the /receivables landing', () => {
	const src = () => read('src/pages/receivables.astro');

	it('passes its own preview image and alt text to LoginLayout', () => {
		expect(src()).toContain("const ogImage = 'https://almstins.com/og-receivables.png';");
		expect(src()).toMatch(/<LoginLayout [^>]*image=\{ogImage\} imageAlt=\{ogImageAlt\}>/);
	});

	it('titles itself with a middle dot (title, og:title and twitter:title all read it)', () => {
		expect(src()).toContain("const title = 'Receivables · Almstins Verify';");
		expect(src()).not.toMatch(/const title = '[^']*—/);
	});
});

describe('LoginLayout', () => {
	const src = () => read('src/layouts/LoginLayout.astro');

	it('keeps the site-wide image as the default, so every other page renders as before', () => {
		expect(src()).toContain("const ogImage = image ?? 'https://almstins.com/og-default.png';");
		expect(src()).toContain('<meta property="og:image" content={ogImage} />');
		expect(src()).toContain('<meta name="twitter:image" content={ogImage} />');
	});

	it('adds the size and alt tags only for a page that passes its own image', () => {
		for (const tag of ['og:image:width', 'og:image:height', 'og:image:alt', 'twitter:image:alt']) {
			const line = src().split('\n').find((l) => l.includes(`"${tag}"`)) ?? '';
			expect(line, tag).toMatch(/\{image && /);
		}
	});
});

describe('receivables page titles use a middle dot, not an em dash', () => {
	const PAGES = ['registry', 'desk', 'client', 'confirm', 'invite', 'offer', 'countersign', 'attest', 'authenticate', 'runsheet', 'guide', 'changelog', 'thanks', 'faq'];
	it.each(PAGES)('%s', (p) => {
		const title = /<title>([^<]*)<\/title>/.exec(read(`src/pages/verify/${p}.astro`))?.[1] ?? '';
		expect(title).toMatch(/ · Almstins (Verify|Receivables)$/);
		expect(title).not.toContain('—');
	});
});
