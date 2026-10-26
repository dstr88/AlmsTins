import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAINS } from '@/lib/chains';

/**
 * Chain facts and address formats are written in one place each: src/lib/addressFormats.ts and
 * src/lib/chains.ts. Five copies of the explorer list drifted apart (#15), four native coin maps
 * disagreed on MATIC and POL, and two bech32 checks accepted different prefixes. This fails the
 * day someone writes a new copy instead of importing the shared one:
 *   - an EVM address pattern (0x and a hex class of 40) outside addressFormats.ts,
 *   - a chain list literal (['ethereum', 'polygon', ...]) outside chains.ts,
 *   - a native coin map entry (polygon: 'POL', ethereum: { symbol: 'ETH' }) outside chains.ts,
 *   - the Routescan API address outside src/lib/etherscan.ts.
 *
 * ALLOWED lists the files that cannot move yet, each with the reason. It only shrinks: an entry
 * whose file no longer has the copy fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const CHAIN_IDS = Object.keys(CHAINS).join('|');
const NATIVE = [...new Set([...Object.values(CHAINS).map((c) => c.native.symbol), 'MATIC'])].join('|');

const RULES = {
	evmAddressPattern: {
		home: 'src/lib/addressFormats.ts',
		pattern: /0(?:x|\[xX\])\[[^\]\n]*\]\{40[,}]/g,
		fix: 'import EVM_ADDRESS (or a friend) from src/lib/addressFormats.ts',
	},
	chainList: {
		home: 'src/lib/chains.ts',
		pattern: new RegExp(`\\[\\s*['"](?:${CHAIN_IDS})['"]\\s*,\\s*['"](?:${CHAIN_IDS})['"]`, 'g'),
		fix: 'use a named list from src/lib/chains.ts, or add one there',
	},
	nativeCoinMap: {
		home: 'src/lib/chains.ts',
		pattern: new RegExp(
			`(?<![\\w.-])['"]?(?:${CHAIN_IDS})['"]?\\s*:\\s*(?:\\{[^}\\n]*?\\b(?:symbol|unit)\\s*:\\s*)?['"](?:${NATIVE})['"]` +
				`|\\bsymbol\\s*:\\s*['"](?:${NATIVE})['"]\\s*,\\s*type\\s*:\\s*['"]native['"]`,
			'g',
		),
		fix: "read the coin from CHAINS[chain].native or nativeSymbol() in src/lib/chains.ts",
	},
	routescanAddress: {
		home: 'src/lib/etherscan.ts',
		pattern: /api\\?\.routescan\\?\.io/g,
		fix: 'import SNOWTRACE_BASE_URL from src/lib/etherscan.ts',
	},
} as const;
type Rule = keyof typeof RULES;

const ALLOWED: Record<Rule, Record<string, string>> = {
	evmAddressPattern: {},
	chainList: {
		'src/pages/api/demo/start.ts':
			'seed data: the chains one demo wallet is tagged with when the demo is built, not a feature list.',
	},
	nativeCoinMap: {
		'src/lib/repriceMissingWalletTokens.ts':
			"CoinGecko coin ids (bitcoin, ethereum) mapped to tickers; the keys are CoinGecko's ids, not chain names.",
		'src/pages/api/import/venmo.ts':
			"the asset names in Venmo's CSV header (Bitcoin, Ethereum) mapped to tickers, not chain names.",
	},
	routescanAddress: {
		'src/lib/explorerGates.ts':
			'picks the rate gate by the request host; etherscan.ts imports this file, so importing the address back would be circular.',
	},
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(p);
	}
	return out;
}

const hits = new Map<Rule, Map<string, string[]>>();
for (const rule of Object.keys(RULES) as Rule[]) hits.set(rule, new Map());
for (const file of walk(path.join(ROOT, 'src'))) {
	const rel = path.relative(ROOT, file).split(path.sep).join('/');
	const text = readFileSync(file, 'utf8');
	for (const rule of Object.keys(RULES) as Rule[]) {
		const found = [...text.matchAll(RULES[rule].pattern)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
		if (found.length) hits.get(rule)!.set(rel, found);
	}
}

describe('chain facts and address formats have one home each', () => {
	for (const rule of Object.keys(RULES) as Rule[]) {
		const { home, fix } = RULES[rule];

		it(`${rule}: no copy outside ${home}`, () => {
			const strays = Object.fromEntries([...hits.get(rule)!].filter(([f]) => f !== home && !(f in ALLOWED[rule])));
			expect(strays, fix).toEqual({});
		});

		it(`${rule}: every allowlisted file still has its copy, and a reason`, () => {
			for (const [file, reason] of Object.entries(ALLOWED[rule])) {
				expect(hits.get(rule)!.has(file), `${file} no longer has a ${rule} copy: remove it from ALLOWED`).toBe(true);
				expect(reason.length).toBeGreaterThan(20);
			}
		});
	}

	it('the patterns still find the copies they are for', () => {
		const sample = [
			"const A = /^0x[a-fA-F0-9]{40}$/;",
			"const B = /0[xX][0-9a-f]{40,}/;",
			"const C = ['ethereum', 'polygon', 'avalanche'];",
			"const D = new Set(['bitcoin', 'litecoin']);",
			"const E = { polygon: 'MATIC' };",
			"const F = { ethereum: { symbol: 'ETH', decimals: 18 } };",
			"{ symbol: 'MATIC', type: 'native', decimals: 18 }",
			"const G = 'https://api.routescan.io/v2/x';",
		];
		const found = sample.map((line) => (Object.keys(RULES) as Rule[]).filter((r) => new RegExp(RULES[r].pattern.source).test(line)));
		expect(found).toEqual([
			['evmAddressPattern'], ['evmAddressPattern'], ['chainList'], ['chainList'],
			['nativeCoinMap'], ['nativeCoinMap'], ['nativeCoinMap'], ['routescanAddress'],
		]);
	});
});
