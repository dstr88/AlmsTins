import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isSpamToken } from '../../src/lib/knownContracts';

/**
 * One spam-token rule for the whole app (Nov 17, 2026). The pricing service and the Avalanche
 * holdings route used to keep their own word lists, which hid real tokens with "reward" or "bonus"
 * in their names in one place and let link-less "Claim your USDT" tokens through in another.
 */

describe('isSpamToken', () => {
	it('flags names with links or domains, as before', () => {
		expect(isSpamToken('USDT', 'Visit https://get-usdc.com to claim rewards')).toBe(true);
		expect(isSpamToken('PAWS', 'PAWS | t.me/s/BD_PAWS | visit to claim')).toBe(true);
		expect(isSpamToken('A-ZKF', 'A-ZKF [www.zkfair.events]')).toBe(true);
	});

	it('flags the words only spam uses, even with no link', () => {
		for (const name of ['Claim your USDT', 'Airdrop', 'Free airdrops', 'Giveaway token', 'ETH Voucher', 'Visit to receive', 'Promo pass']) {
			expect(isSpamToken('X', name), name).toBe(true);
		}
		expect(isSpamToken('CLAIM')).toBe(true);
	});

	it('leaves real tokens alone, including reward and bonus names', () => {
		for (const [sym, name] of [
			['WBTC', 'Wrapped BTC'],
			['AAVE', 'Aave Token'],
			['stkAAVE', 'Staked Aave Reward'],
			['BONUS', 'Bonus Token'],
			['RCL', 'Reclaim'],
			['USDC', 'USD Coin'],
		]) {
			expect(isSpamToken(sym, name), `${sym} ${name}`).toBe(false);
		}
	});
});

describe('one rule', () => {
	it('no file defines its own isSpamToken', () => {
		const root = path.resolve(__dirname, '../../src');
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const n of readdirSync(dir)) {
				const p = path.join(dir, n);
				if (statSync(p).isDirectory()) walk(p);
				else if (/\.(ts|tsx|astro|mjs)$/.test(n)) files.push(p);
			}
		};
		walk(root);
		const definers = files.filter((f) => /function isSpamToken\s*\(/.test(readFileSync(f, 'utf8')));
		expect(definers.map((f) => path.relative(root, f))).toEqual(['lib/knownContracts.ts']);
	});
});
