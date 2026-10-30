/**
 * computeLedger with lot identifications: the owner's wallet-by-wallet years follow the entry in force
 * at each sale (and earliest acquired without one), a tenant outside the rollout is not touched, and
 * the figures read only that tenant's entries. The database is mocked; amounts are invented.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLedger, ledgerMemo } from '../../src/lib/tax/computeLedger';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { db } from '../../src/lib/db';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const base = { asset_symbol: 'ETH', group_id: 'g', tx_hash: null, source_type: 'import', import_source: 'coinbase', import_account_id: 'acct-1' };
const history = () => [
	{ ...base, direction: 'in', amount: 1, native_usd: 1_000, timestamp_utc: '2025-01-10T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'b1', import_kind: 'Buy' },
	{ ...base, direction: 'in', amount: 1, native_usd: 3_000, timestamp_utc: '2025-02-10T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'b2', import_kind: 'Buy' },
	{ ...base, direction: 'out', amount: 0.5, native_usd: 1_250, timestamp_utc: '2025-03-20T00:00:00Z', transaction_class: 'other', source_id: 's1', import_kind: 'Sell' },
	{ ...base, direction: 'out', amount: 0.5, native_usd: 1_500, timestamp_utc: '2025-04-10T00:00:00Z', transaction_class: 'other', source_id: 's2', import_kind: 'Sell' },
];

const entries = [
	{ id: 'id-1', tenant_id: OWNER_TENANT_ID, wallet_key: 'cex:coinbase:acct-1', method: 'highest_basis', effective_at: '2025-04-01T00:00:00.000Z', created_at: '2025-04-01T00:00:00.000Z', note: null, batch_id: 'b', source: 'manual' },
	{ id: 'id-other', tenant_id: 'someone-else', wallet_key: 'cex:coinbase:acct-1', method: 'latest', effective_at: '2025-01-01T00:00:00.000Z', created_at: '2025-01-01T00:00:00.000Z', note: null, batch_id: 'x', source: 'manual' },
];

let entryReads: unknown[][] = [];
beforeEach(() => {
	vi.resetAllMocks();
	ledgerMemo.enabled = false;
	entryReads = [];
	mockExecute.mockImplementation((arg: { sql?: string; args?: unknown[] } | string) => {
		const sql = typeof arg === 'string' ? arg : arg.sql ?? '';
		const args = typeof arg === 'string' ? [] : arg.args ?? [];
		if (sql.includes('/* tax:source */')) return Promise.resolve({ rows: [] });
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) return Promise.resolve({ rows: history() });
		if (/FROM lot_identifications WHERE tenant_id/.test(sql)) {
			entryReads.push(args);
			return Promise.resolve({ rows: entries.filter((e) => e.tenant_id === args[0]) });
		}
		return Promise.resolve({ rows: [] });
	});
});

const costs = (res: Awaited<ReturnType<typeof computeLedger>>, ref: string) =>
	res.result.slices.filter((s) => s.sourceRef.endsWith(ref)).reduce((a, s) => a + (s.cost ?? 0), 0);

describe('computeLedger and lot identifications', () => {
	it('the owner\'s sales follow the entry in force: earliest before it, highest cost after', async () => {
		const res = await computeLedger(OWNER_TENANT_ID, 'lifecycle', 'fifo');
		expect(res.basisMethod).toBe('per_wallet_fifo_from_2025');
		expect(res.result.selections.map((s) => [s.at.slice(0, 10), s.identificationId])).toEqual([
			['2025-03-20', null],
			['2025-04-10', 'id-1'],
		]);
		// The first sale predates the entry and takes the earliest lot; the second takes the highest-cost lot.
		expect(costs(res, 's1')).toBe(500);
		expect(costs(res, 's2')).toBe(1_500);
	});

	it('reads only the signed-in tenant\'s entries', async () => {
		await computeLedger(OWNER_TENANT_ID, 'lifecycle');
		expect(entryReads).toEqual([[OWNER_TENANT_ID]]);
	});

	it('does not touch a tenant outside the rollout and does not read entries for it', async () => {
		const res = await computeLedger('tenant-not-owner', 'lifecycle', 'hifo');
		expect(res.basisMethod).toBe('universal_fifo');
		expect(res.result.selections).toEqual([]);
		expect(entryReads).toEqual([]);
	});
});
