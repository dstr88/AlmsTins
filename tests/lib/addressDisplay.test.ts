import { describe, expect, it } from 'vitest';
import { SHORT_HEAD, SHORT_TAIL, shortenAddress } from '../../src/lib/addressDisplay';

/**
 * How an address looks shortened (Area 4, decision D4): its first 8 characters, an ellipsis and
 * its last 6. Address poisoning sends dust from a look-alike that matches the first and last 4 or
 * 5 characters, so a look-alike must differ somewhere in what is shown.
 */

const EVM = '0x5e1f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b';
const LOOKALIKE = '0x5e1f000000000000000000000000000000001a2b';

describe('shortenAddress', () => {
	it('keeps the first 8 and the last 6 characters, with one ellipsis between', () => {
		expect(SHORT_HEAD).toBe(8);
		expect(SHORT_TAIL).toBe(6);
		expect(shortenAddress(EVM)).toBe('0x5e1f0a…091a2b');
	});

	it('tells apart a look-alike that copies the first and last 4 characters', () => {
		expect(shortenAddress(LOOKALIKE)).not.toBe(shortenAddress(EVM));
	});

	it('shortens every kind of long id the same way: Bitcoin, Solana, a transaction hash', () => {
		expect(shortenAddress('bc1q9h7garjx4kfsf3wzvfnpu7p0dh5y0rtnz6cvqs')).toBe('bc1q9h7g…z6cvqs');
		expect(shortenAddress('Fx7Qm2Nd8KpTs4Wv9ZbRc3Hj6Ly1Ue5Ag2Mn8Pq4Rt')).toBe('Fx7Qm2Nd…8Pq4Rt');
		const hash = `0x${'ab'.repeat(32)}`;
		expect(shortenAddress(hash)).toBe('0xababab…ababab');
	});

	it('shows a value of 16 characters or fewer whole, since cutting it would save nothing', () => {
		expect(shortenAddress('0x1234')).toBe('0x1234');
		expect(shortenAddress('a'.repeat(16))).toBe('a'.repeat(16));
		expect(shortenAddress('a'.repeat(17))).toBe(`${'a'.repeat(8)}…${'a'.repeat(6)}`);
	});

	it('gives empty text for nothing, and trims stray spaces', () => {
		expect(shortenAddress(null)).toBe('');
		expect(shortenAddress(undefined)).toBe('');
		expect(shortenAddress('')).toBe('');
		expect(shortenAddress(`  ${EVM} `)).toBe('0x5e1f0a…091a2b');
	});

	it('never changes the case of what it keeps (Solana and Bitcoin legacy addresses are case-sensitive)', () => {
		const sol = 'Fx7Qm2Nd8KpTs4Wv9ZbRc3Hj6Ly1Ue5Ag2Mn8Pq4Rt';
		const out = shortenAddress(sol);
		expect(out.startsWith(sol.slice(0, 8))).toBe(true);
		expect(out.endsWith(sol.slice(-6))).toBe(true);
	});
});
