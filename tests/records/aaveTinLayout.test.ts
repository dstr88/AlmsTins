import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Vault's DeFi tin shows one white-bordered box per Aave position, one per chain, and the
 * closed tin shows every chain's health factor in a row. Before, positions from all chains were
 * merged into one list (the same symbol on two chains became one row) and the closed tin showed
 * only the first chain's health factor. The island and the page script cannot run here, so this
 * pins the source.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const island = read('src/components/dashboard/AaveHealthSummary.tsx');
const css = read('src/pages/dashboard/vault.css');
const page = read('src/pages/dashboard/vault.astro');

describe('one position per chain', () => {
	it('builds each chain\'s collateral from that chain\'s supplies only', () => {
		expect(island).toMatch(/const positions: ChainPosition\[\] = activeChainEntries\.map\(\(\[chain, summary\]\) =>/);
		expect(island).toMatch(/\(summary\.userSupplies \?\? \[\]\)\.reduce<CollateralRow\[\]>/);
		expect(island).toMatch(/\(summary\.userBorrows \?\? \[\]\)\.reduce/);
		expect(island).not.toMatch(/state\.collateralBreakdown/);
	});

	it('takes each box\'s totals and health factor from its own market', () => {
		expect(island).toMatch(/healthFactor: summary\.healthFactor \?\? null/);
		expect(island).toMatch(/Number\(summary\.totalCollateralBase \?\? 0\)/);
		expect(island).toMatch(/Number\(summary\.totalDebtBase \?\? 0\)/);
	});

	it('renders one bordered section per position, with rows keyed by chain and symbol', () => {
		expect(island).toMatch(/<section className="aave-position" key=\{p\.chain\}/);
		expect(island).toMatch(/`\$\{p\.chain\}-\$\{item\.symbol\}`/);
		expect(css).toMatch(/\.defi-summary-tin \.aave-position \{[^}]*border: 1px solid #fff;/);
	});
});

describe('the closed tin lists every chain\'s health factor', () => {
	it('each position\'s health row names its chain for the summary', () => {
		expect(island).toMatch(/className="stat-row health"[\s\S]{0,200}data-chain-name=\{chainName\}/);
	});

	it('the page summary reads every chain row, not just the first, and writes text only', () => {
		const fn = page.slice(page.indexOf('const updateDefiSummary'), page.indexOf('const attachSummaryObserver'));
		expect(fn).toMatch(/querySelectorAll\('\.stat-row\.health\[data-chain-name\]'\)/);
		expect(fn).toMatch(/replaceChildren\(/);
		expect(fn).toMatch(/textContent = e\.value/);
		expect(fn).not.toMatch(/innerHTML/);
		expect(css).toMatch(/\.wallet-stack \.tin-summary__value--multi \{/);
	});
});
