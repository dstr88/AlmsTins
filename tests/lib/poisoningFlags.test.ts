import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));

import { flagOf, flagsFor, transferFromHistoryRow } from '../../src/lib/poisoningFlags';
import type { HistoryRow } from '../../src/lib/historyRows';
import type { AddressBookEntry } from '../../src/lib/addressPoisoning';
import { getPoisonWarning, poisonSentence, poisonTag } from '../../src/i18n/components/poisonWarning';

/**
 * Phase 2 of the poisoning warnings: the account's own history and address book fed to the rules,
 * for the addresses a screen shows. Addresses are invented; they only have the EVM shape.
 */

const MY_WALLET = `0x${'0'.repeat(39)}1`;
const COINBASE = `0xabcd${'1'.repeat(32)}9f3e`;
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const AIRDROPPER = `0x${'5'.repeat(40)}`;
const FRIEND = `0x${'6'.repeat(40)}`;

const book: AddressBookEntry[] = [{ address: COINBASE, label: 'Coinbase deposit', source: 'user' }];

let n = 0;
function row(o: Partial<HistoryRow>): HistoryRow {
	n++;
	return {
		origin: 'onchain',
		id: String(n),
		ref: { id: 'w1', label: 'Main', address: MY_WALLET },
		source: 'ethereum',
		chain: 'ethereum',
		date: '2026-11-01 00:00:00',
		sortKey: `2026-11-${String((n % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
		direction: 'in',
		asset: 'USDT',
		amount: '0.01',
		usdValue: '0.01',
		fee: '',
		feeAsset: '',
		txHash: `0x${String(n).padStart(64, '0')}`,
		counterparty: AIRDROPPER,
		category: '',
		notes: '',
		failed: false,
		...o,
	} as HistoryRow;
}

const transfers = (rows: HistoryRow[]) => rows.map(transferFromHistoryRow).filter((t) => t !== null);

describe('transferFromHistoryRow', () => {
	it('leaves out failed transactions and rows with no counterparty or direction', () => {
		expect(transferFromHistoryRow(row({ failed: true }))).toBeNull();
		expect(transferFromHistoryRow(row({ counterparty: '' }))).toBeNull();
		expect(transferFromHistoryRow(row({ direction: '' }))).toBeNull();
		expect(transferFromHistoryRow(row({ direction: 'lost' }))).toBeNull();
	});

	it('reads an empty USD value as no price', () => {
		expect(transferFromHistoryRow(row({ usdValue: '' }))?.usd).toBeNull();
	});

	it("marks the chain's own coin with no value as valueUnknown, and a token as not", () => {
		expect(transferFromHistoryRow(row({ asset: 'ETH', usdValue: '' }))?.valueUnknown).toBe(true);
		expect(transferFromHistoryRow(row({ asset: 'FAKE', usdValue: '' }))?.valueUnknown).toBe(false);
	});
});

describe('flagsFor', () => {
	it('flags an address that only ever sent dust', () => {
		const flags = flagsFor([AIRDROPPER], transfers([row({}), row({ asset: 'ARB', usdValue: '0.2' })]), book, [MY_WALLET]);
		expect(flagOf(flags, AIRDROPPER)).toEqual({ signal: 'dust-only', imitates: null });
	});

	it('judges dust-only on the whole history, not the token on screen', () => {
		// Dust in USDT, but the user paid this address in ETH: a real counterparty.
		const history = transfers([
			row({ counterparty: FRIEND }),
			row({ counterparty: FRIEND, direction: 'out', asset: 'ETH', amount: '0.5', usdValue: '1500' }),
		]);
		expect(flagsFor([FRIEND], history, book, [MY_WALLET]).size).toBe(0);
	});

	it('flags the classic pattern and names the saved address it imitates', () => {
		const flags = flagsFor([POISON], transfers([row({ counterparty: POISON, amount: '0', usdValue: '' })]), book, [MY_WALLET]);
		expect(flagOf(flags, POISON)).toEqual({ signal: 'both', imitates: 'Coinbase deposit' });
	});

	it('flags a look-alike even when the history does not carry it yet', () => {
		expect(flagOf(flagsFor([POISON], [], book, [MY_WALLET]), POISON)).toEqual({ signal: 'lookalike', imitates: 'Coinbase deposit' });
	});

	it("never flags the account's own wallets or an address the user saved", () => {
		const history = transfers([row({ counterparty: MY_WALLET }), row({ counterparty: COINBASE })]);
		expect(flagsFor([MY_WALLET, COINBASE], history, book, [MY_WALLET]).size).toBe(0);
	});

	it('only answers for the addresses asked about', () => {
		const flags = flagsFor([FRIEND], transfers([row({})]), book, [MY_WALLET]);
		expect(flagOf(flags, AIRDROPPER)).toBeNull();
	});

	it('ignores empty values and exchange ids', () => {
		expect(flagsFor([null, '', 'cex:coinbase:1'], transfers([row({})]), book, [MY_WALLET]).size).toBe(0);
	});
});

describe('poison warning copy', () => {
	it('names the saved address in every language and never claims a crime', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getPoisonWarning(lang);
			expect(poisonSentence(t, 'both', 'Coinbase deposit')).toContain('Coinbase deposit');
			expect(poisonSentence(t, 'lookalike', 'Coinbase deposit')).toContain('Coinbase deposit');
			expect(poisonSentence(t, 'dust-only', null)).toBe(t.dustOnly);
			expect(poisonTag(t, 'both')).toBe(t.tagBoth);
			for (const s of [t.dustOnly, t.lookalike('X'), t.both('X')]) {
				expect(s).not.toMatch(/—/);
				expect(s.toLowerCase()).not.toMatch(/\bscam(mer)?\b|\bstolen\b/);
			}
		}
	});
});

describe('look-alike save prompt copy', () => {
	it('names the saved address and has every string in every language', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getPoisonWarning(lang);
			expect(t.didYouMean('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.lookalikeExplain('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.savedAs('Coinbase deposit')).toContain('Coinbase deposit');
			for (const s of [t.youEntered, t.saveAnyway, t.cancel]) expect(s.length).toBeGreaterThan(0);
			expect(t.lookalikeExplain('X')).not.toMatch(/—/);
		}
	});
});
