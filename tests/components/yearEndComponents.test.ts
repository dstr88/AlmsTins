import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The year-end shared components (src/components/yearEnd). Each one keeps its styles in its own .css
 * file and keeps its markup free of style attributes and <style> blocks, so the logic and the look
 * stay apart. The pages that use them must not bring their own copy of the badge. The components
 * render inside Astro, which the unit runner does not load, so this pins the source.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const DIR = 'src/components/yearEnd';
const COMPONENTS = ['Badge', 'TermBadge', 'WalletTag', 'DataTable'] as const;

describe('year-end shared components keep their CSS out of the markup', () => {
	for (const name of COMPONENTS) {
		it(`${name}.astro has no style attribute and no <style> block`, () => {
			const src = read(`${DIR}/${name}.astro`);
			expect(src).not.toMatch(/\sstyle=/);
			expect(src).not.toMatch(/<style[\s>]/);
		});
	}

	for (const name of ['Badge', 'WalletTag', 'DataTable'] as const) {
		it(`${name}.astro imports its own stylesheet`, () => {
			expect(read(`${DIR}/${name}.astro`)).toMatch(new RegExp(`import '\\./${name}\\.css';`));
			expect(existsSync(path.join(ROOT, DIR, `${name}.css`))).toBe(true);
		});
	}

	it('the stylesheets use the design tokens, not hardcoded colors', () => {
		for (const name of ['Badge', 'WalletTag', 'DataTable'] as const) {
			const css = read(`${DIR}/${name}.css`);
			expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
			expect(css).not.toMatch(/\b(rgb|rgba|hsl)\(/);
		}
	});
});

describe('TermBadge is built on Badge', () => {
	it('renders through Badge and takes its labels from the page', () => {
		const src = read(`${DIR}/TermBadge.astro`);
		expect(src).toMatch(/import Badge from '\.\/Badge\.astro';/);
		expect(src).toMatch(/<Badge tone=/);
	});
});

describe('the Lot Manager uses the shared badge', () => {
	const lots = read('src/pages/dashboard/yearEnd/lots.astro');

	it('imports and renders Badge', () => {
		expect(lots).toMatch(/import Badge from '\.\.\/\.\.\/\.\.\/components\/yearEnd\/Badge\.astro';/);
		expect(lots).toMatch(/<Badge tone="warn">\{t\.needsAttention\}<\/Badge>/);
	});

	it('no longer carries its own badge styles', () => {
		expect(lots).not.toMatch(/\.lm-badge/);
	});
});

describe('wallets reach the tokens', () => {
	const breakdown = read('src/lib/annualBreakdown.ts');
	const lots = read('src/pages/dashboard/yearEnd/lots.astro');
	const gains = read('src/pages/dashboard/yearEnd/gains.astro');

	it('the lifecycle query joins each event to its source row and loads the wallets', () => {
		expect(breakdown).toMatch(/LEFT JOIN import_transactions i/);
		expect(breakdown).toMatch(/LEFT JOIN transactions t/);
		expect(breakdown).toMatch(/SELECT id, address FROM wallets WHERE tenant_id = \?/);
	});

	it('every lot records its wallet, and every settled and held item carries it', () => {
		expect(breakdown).toMatch(/list\.push\(\{ amount, timestamp, costUsd: nativeUsd, walletKey \}\)/);
		expect(breakdown).toMatch(/walletKey:  lot\.walletKey,/);
		expect(breakdown).toMatch(/walletKey:   lot\.walletKey,/);
		expect(breakdown).toMatch(/walletDisplay: walletDisplayOf\(lot\.walletKey\)/);
	});

	it('the Lot Manager shows the wallet on each sale and each open lot', () => {
		expect(lots).toMatch(/import WalletTag from/);
		expect(lots).toMatch(/<WalletTag label=\{d\.walletDisplay\}/);
		expect(lots).toMatch(/\{ol\.walletDisplay \? ` · \$\{ol\.walletDisplay\}` : ''\}/);
	});

	it('the gains table has a translated wallet column', () => {
		expect(gains).toMatch(/import WalletTag from/);
		expect(gains).toMatch(/<WalletTag label=\{lot\.walletDisplay\}/);
		expect(gains).toMatch(/\{t\.lotColWallet\}/);
	});

	it('the Lot Manager no longer carries its own term styles', () => {
		expect(lots).not.toMatch(/\.lm-term/);
	});
});
