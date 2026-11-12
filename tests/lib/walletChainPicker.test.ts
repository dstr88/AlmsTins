import { describe, expect, it, vi } from 'vitest';

// chains.ts and the address pattern are plain data; nothing here touches the database.
vi.mock('@/lib/db', () => ({ db: {} }));

import { chainChoices, chainsAfterToggle, hasChainPicker } from '@/lib/walletChainPicker';

const WALLET = '0x000000000000000000000000000000000000a1a1';

describe('the chain picker appears on EVM wallets only', () => {
	it('an EVM address gets it', () => {
		expect(hasChainPicker(WALLET)).toBe(true);
	});

	it('other wallet kinds do not', () => {
		expect(hasChainPicker('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false);
		expect(hasChainPicker('So11111111111111111111111111111111111111112')).toBe(false);
		expect(hasChainPicker('0x' + 'a'.repeat(64))).toBe(false);
		expect(hasChainPicker(null)).toBe(false);
	});
});

describe('chainChoices', () => {
	it('shows one box per EVM chain, ticked where the list has it', () => {
		expect(chainChoices(['ethereum', 'arbitrum'])).toEqual([
			{ chain: 'ethereum', name: 'Ethereum', checked: true },
			{ chain: 'polygon', name: 'Polygon', checked: false },
			{ chain: 'avalanche', name: 'Avalanche', checked: false },
			{ chain: 'arbitrum', name: 'Arbitrum', checked: true },
		]);
	});

	it('reads a stored alias as its chain', () => {
		expect(chainChoices(['eth', 'matic']).map((c) => c.checked)).toEqual([true, true, false, false]);
	});
});

describe('chainsAfterToggle', () => {
	it('adds a chain the list does not have', () => {
		expect(chainsAfterToggle(['ethereum', 'polygon', 'avalanche'], 'arbitrum')).toEqual([
			'ethereum',
			'polygon',
			'avalanche',
			'arbitrum',
		]);
	});

	it('removes a chain the list has', () => {
		expect(chainsAfterToggle(['ethereum', 'polygon'], 'polygon')).toEqual(['ethereum']);
	});

	it('keeps the chains the boxes do not show', () => {
		expect(chainsAfterToggle(['ethereum', 'base', 'polygon'], 'polygon')).toEqual(['ethereum', 'base']);
	});

	it('removes an alias by its chain', () => {
		expect(chainsAfterToggle(['eth', 'polygon'], 'ethereum')).toEqual(['polygon']);
	});

	it('refuses an untick that would leave no chain', () => {
		expect(chainsAfterToggle(['ethereum'], 'ethereum')).toBeNull();
	});

	it('adds to an empty list', () => {
		expect(chainsAfterToggle([], 'arbitrum')).toEqual(['arbitrum']);
	});
});
