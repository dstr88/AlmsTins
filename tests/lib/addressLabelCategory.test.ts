import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: the Address Labels form saved a wallet the user controls as category `personal`,
 * while autoClassify only reads `own_wallet` (and `exchange`). The label looked right on screen and
 * never made a transfer to that wallet resolve as the user's own. The form now saves `own_wallet`,
 * the API writes `personal` as `own_wallet`, and autoClassify still honours rows stored as `personal`.
 *
 * Every address here is invented. No database, no network.
 */

const OWN = '0x00000000000000000000000000000000000000a1';
const EXCH = '0x00000000000000000000000000000000000000b2';

const state = vi.hoisted(() => ({
	labels: [] as Array<{ address: string; label: string; category: string }>,
	txs: [] as Array<Record<string, unknown>>,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
}));

function answer(sql: string) {
	if (/FROM wallets/i.test(sql)) return { rows: [], rowsAffected: 0 };
	if (/FROM address_labels/i.test(sql)) {
		// Honour the query's own category filter, as Postgres would.
		const list = sql.match(/category IN \(([^)]*)\)/i);
		const allowed = list ? list[1].split(',').map((s) => s.trim().replace(/'/g, '')) : null;
		const rows = allowed ? state.labels.filter((l) => allowed.includes(l.category)) : state.labels;
		return { rows, rowsAffected: 0 };
	}
	if (/FROM import_transactions/i.test(sql)) return { rows: state.txs, rowsAffected: 0 };
	return { rows: [], rowsAffected: 1 };
}

vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async (q: { sql: string; args: unknown[] } | string) => {
			const sql = typeof q === 'string' ? q : q.sql;
			state.calls.push({ sql, args: typeof q === 'string' ? [] : q.args });
			return answer(sql);
		}),
		batch: vi.fn(async (qs: Array<{ sql: string; args: unknown[] }>) => {
			for (const q of qs) state.calls.push(q);
			return qs.map((q) => answer(q.sql));
		}),
	},
}));

import { normalizeLabelCategory } from '../../src/lib/addressLabelCategory';
import { autoClassifyOwnWalletTransfers } from '../../src/lib/autoClassify';

beforeEach(() => {
	state.labels = [];
	state.txs = [];
	state.calls = [];
});

describe('normalizeLabelCategory', () => {
	it('writes the old "personal" value as own_wallet', () => {
		expect(normalizeLabelCategory('personal')).toBe('own_wallet');
		expect(normalizeLabelCategory(' Personal ')).toBe('own_wallet');
	});
	it('keeps every other category, and defaults a missing one to counterparty', () => {
		for (const c of ['own_wallet', 'exchange', 'defi', 'bridge', 'other', 'counterparty']) {
			expect(normalizeLabelCategory(c)).toBe(c);
		}
		expect(normalizeLabelCategory(undefined)).toBe('counterparty');
		expect(normalizeLabelCategory('')).toBe('counterparty');
	});
});

describe('autoClassify reads labels saved as "personal"', () => {
	it('resolves a send to a wallet labelled personal as the user\'s own', async () => {
		state.labels = [{ address: OWN, label: 'Exodus', category: 'personal' }];
		state.txs = [{ id: 'tx1', description: `Sent 1 ETH to ${OWN}`, tx_hash: null, asset_symbol: 'ETH', amount: -1 }];

		expect(await autoClassifyOwnWalletTransfers('t1')).toBe(1);
	});

	it('still never resolves a send to an exchange-labelled address', async () => {
		state.labels = [
			{ address: OWN, label: 'Exodus', category: 'personal' },
			{ address: EXCH, label: 'Coinbase', category: 'exchange' },
		];
		state.txs = [{ id: 'tx1', description: `Sent 1 ETH to ${EXCH}`, tx_hash: null, asset_symbol: 'ETH', amount: -1 }];

		expect(await autoClassifyOwnWalletTransfers('t1')).toBe(0);
	});
});
