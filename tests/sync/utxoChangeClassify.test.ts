import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * autoClassify's Bitcoin and Litecoin lookup pass (src/lib/autoClassify.ts, pass 5) reads a send's
 * outputs from the explorer and marks the send own_wallet when an output is one of the user's
 * wallets. A send almost always has change back to the sending address, and that address is the
 * user's wallet, so every send with change was marked a transfer to their own wallet. With Litecoin
 * history imported, every Litecoin send would have been too. An output back to one of the
 * transaction's inputs is change and is skipped; a real transfer to another own wallet still matches.
 *
 * Hermetic: the database and fetch are stubs. Every address and hash is invented.
 */

const OWN_LTC = 'ltc1qchangeownxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const OWN_LTC_2 = 'ltc1qchangesecondxxxxxxxxxxxxxxxxxxxxxxxx';
const SHOP = 'LChangeShopLegacyAddr234567892';
const OWN_BTC = 'bc1qchangeownbtcxxxxxxxxxxxxxxxxxxxxxxxxx';
const BTC_SHOP = '1ChangeShopLegacyAddr23456789';

const state = vi.hoisted(() => ({
	txs: [] as Array<Record<string, unknown>>,
	updates: [] as Array<unknown[]>,
	explorer: {} as Record<string, { vin: string[]; vout: string[] }>,
	fetched: [] as string[],
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args?: unknown[] }) => {
			const { sql } = stmt;
			if (/FROM wallets/.test(sql)) return { rows: [{ address: OWN_LTC, label: 'LTC main' }, { address: OWN_LTC_2, label: 'LTC savings' }, { address: OWN_BTC, label: 'BTC main' }] };
			if (/FROM address_labels/.test(sql)) return { rows: [] };
			if (/FROM import_transactions/.test(sql)) return { rows: state.txs };
			if (/^\s*UPDATE import_transactions/.test(sql)) {
				state.updates.push(stmt.args ?? []);
				return { rows: [], rowsAffected: 1 };
			}
			throw new Error(`unexpected SQL: ${sql}`);
		},
	},
}));

import { autoClassifyOwnWalletTransfers } from '../../src/lib/autoClassify';

const h = (c: string) => c.repeat(64);

beforeEach(() => {
	state.txs = [];
	state.updates = [];
	state.explorer = {};
	state.fetched = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = String(input);
			state.fetched.push(url);
			const tx = state.explorer[url.slice(url.lastIndexOf('/') + 1)];
			if (!tx) return new Response('not found', { status: 404 });
			return new Response(JSON.stringify({
				vin: tx.vin.map((a) => ({ prevout: { scriptpubkey_address: a } })),
				vout: tx.vout.map((a) => ({ scriptpubkey_address: a })),
			}));
		}),
	);
});

const classified = () => state.updates.map((args) => args[1]);

describe('autoClassify on Bitcoin and Litecoin sends', () => {
	it('a send to a shop with change back to the sender is not a transfer to your own wallet', async () => {
		state.txs = [
			{ id: 'ltc-shop', description: 'send', tx_hash: h('1'), asset_symbol: 'LTC', amount: -0.26 },
			{ id: 'btc-shop', description: 'send', tx_hash: h('2'), asset_symbol: 'BTC', amount: -0.01 },
		];
		state.explorer[h('1')] = { vin: [OWN_LTC], vout: [OWN_LTC, SHOP] };
		state.explorer[h('2')] = { vin: [OWN_BTC], vout: [OWN_BTC, BTC_SHOP] };

		expect(await autoClassifyOwnWalletTransfers('t1')).toBe(0);
		expect(state.fetched).toEqual([`https://litecoinspace.org/api/tx/${h('1')}`, `https://blockstream.info/api/tx/${h('2')}`]);
	});

	it('a send to another of your wallets still is, with or without change', async () => {
		state.txs = [
			{ id: 'ltc-move', description: 'send', tx_hash: h('3'), asset_symbol: 'LTC', amount: -1 },
			{ id: 'ltc-move-all', description: 'send', tx_hash: h('4'), asset_symbol: 'LTC', amount: -2 },
		];
		state.explorer[h('3')] = { vin: [OWN_LTC], vout: [OWN_LTC, OWN_LTC_2] };
		state.explorer[h('4')] = { vin: [OWN_LTC], vout: [OWN_LTC_2] };

		expect(await autoClassifyOwnWalletTransfers('t1')).toBe(2);
		expect(classified()).toEqual(['ltc-move', 'ltc-move-all']);
		for (const args of state.updates) expect(String(args[0])).toContain(OWN_LTC_2);
	});
});
