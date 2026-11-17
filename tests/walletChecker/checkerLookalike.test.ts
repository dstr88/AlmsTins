import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findLookalike, type AddressBookEntry } from '../../src/lib/addressPoisoning';
import { getPoisonWarning } from '../../src/i18n/components/poisonWarning';

/**
 * The public checker, signed in: a look-alike of an address in the user's own book is flagged,
 * compared in the browser. The checker's promise ("a check sends the address or link and nothing
 * about you") must stay true: the address book is fetched on its own, without the checked
 * address, and the check still sends only the address.
 */

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const component = read('src/components/poisoning/CheckerLookalike.tsx');
const checker = read('src/components/WalletChecker.tsx');

describe('privacy', () => {
	it('fetches only the user\'s own address book, once, and never with the checked address', () => {
		const fetches = [...component.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
		expect(fetches).toEqual(["'/api/address-labels', { credentials: 'same-origin' }"]);
		expect(component).toMatch(/let bookPromise/);
	});

	it('leaves the check itself sending only the address', () => {
		expect(checker).toMatch(/fetch\('\/api\/wallet-check', \{[\s\S]*?body: JSON\.stringify\(\{ address: addr \}\)/);
	});
});

describe('the comparison', () => {
	const book: AddressBookEntry[] = [
		{ address: `0xabcd${'1'.repeat(32)}9f3e`, label: 'Coinbase deposit', source: 'user' },
		{ address: `0x1234${'2'.repeat(32)}5678`, label: 'Matched', source: 'auto' },
	];

	it('flags a look-alike of a saved address, and not of an automatic entry', () => {
		expect(findLookalike(`0xabcd${'7'.repeat(32)}9f3e`, book)?.label).toBe('Coinbase deposit');
		expect(findLookalike(`0x1234${'9'.repeat(32)}5678`, book)).toBeNull();
	});

	it('names the saved address and says nothing was sent, in every language', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getPoisonWarning(lang);
			expect(t.checkerLookalike('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.checkerNote.length).toBeGreaterThan(0);
			expect(t.checkerLookalike('X')).not.toMatch(/—/);
		}
	});
});
