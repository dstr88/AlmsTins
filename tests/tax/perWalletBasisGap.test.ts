/**
 * Per-wallet cost basis: what the engines do today, and the target for 2025 and later.
 *
 * Since January 1, 2025, US basis for digital assets is identified wallet by wallet
 * (Treas. Reg. 1.1012-1(j)(1), (j)(3)(i)): without a specific identification recorded by
 * the time of the sale, units are sold first-in, first-out WITHIN the wallet or account
 * they are sold from, ordered by original acquisition date (transfer-in dates are
 * disregarded, IRS digital asset FAQ 86). Both engines here still pool every lot of an
 * asset across all wallets and accounts (a universal pool). That is unchanged for 2024 and
 * earlier, but it is not the per-wallet rule for disposals from 2025 on.
 *
 * One worked example runs through both engines twice: with the per-wallet rule on (the 2025+
 * target, switched on for a tenant by tax/basisMethod.ts) and with it off (one pool per coin
 * across all wallets and accounts, which is what every year before 2025 uses and what a tenant
 * outside the rollout keeps).
 *
 * Transfers are MOVES in both engines: a send between two of the owner's own wallets or accounts
 * is not a sale, and the arrival does not open a second lot. The coins keep their original date
 * and cost. With the per-wallet rule on, a sale draws only on the lots of the wallet it was made
 * from, and a move takes the oldest lots of the wallet it leaves.
 *
 * Worked example (amounts in USD, 1 BTC per lot):
 *   Wallet A (Coinbase account)   A1  bought 2023-01-10 for 20,000
 *                                 A2  bought 2023-06-01 for 30,000
 *   Wallet B (self-custody)       B1  bought 2024-09-01 for 60,000
 *   2025-02-01  send 1 BTC from A to B (worth 100,000 that day)
 *   2025-06-01  sell 2 BTC from B for 180,000 (90,000 each)
 *
 *   Universal FIFO (what the pipeline computes today): the sale takes the two oldest lots
 *   anywhere, A1 and A2. Basis 50,000, gain 130,000, all long-term. B1 is left over.
 *
 *   Per-wallet FIFO (the 2025+ rule): the send moves A1 to B with its 2023-01-10 date and
 *   20,000 basis (FIFO out of A). B then holds A1 and B1, so the sale takes A1 (long-term
 *   gain 70,000) and B1 (short-term gain 30,000, held under a year). A2 stays in A.
 *
 * Hermetic: the pipeline engine (runFifo) is pure; the lifecycle engine reads through a
 * mocked db, as in annualBreakdown.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runFifo } from '../../src/lib/yearEnd/pass4';
import { classifyImportTxPass1 } from '../../src/lib/yearEnd/pass1';
import type { ClassificationResult, RawImportTx, RawOnchainTx } from '../../src/lib/yearEnd/types';
import { buildAnnualBreakdown } from '../../src/lib/annualBreakdown';
import { db } from '../../src/lib/db';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { PER_WALLET_FROM } from '../../src/lib/tax/basisMethod';

vi.mock('../../src/lib/db', () => ({
	db: { execute: vi.fn() },
}));

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const WALLET_B = '0xb0b0000000000000000000000000000000000b0b';
const OUTSIDE  = '0x0de0000000000000000000000000000000000de0';

// Per-wallet target for the 2025-06-01 sale, shared by both engines' it.fails cases.
const PER_WALLET_SALE = [
	{ buyDate: '2023-01-10', costUsd: 20_000, gainLossUsd: 70_000, shortTerm: false }, // A1, moved A -> B
	{ buyDate: '2024-09-01', costUsd: 60_000, gainLossUsd: 30_000, shortTerm: true },  // B1
];

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline engine (pass4 runFifo) — feeds tax_lots / tax_disposals, the Form 8949-style
// summary, and the Year Summary once the tax pipeline has run for a year.
// ─────────────────────────────────────────────────────────────────────────────

function importRow(o: Partial<RawImportTx> & { id: string; timestamp_utc: string }): RawImportTx {
	return {
		asset_symbol: 'BTC', direction: 'in', kind: 'Buy', amount: 1, to_amount: null,
		native_usd: null, tx_hash: null, source: 'coinbase', notes: null, category: null,
		description: null,
		...o,
	};
}

function onchainRow(o: Partial<RawOnchainTx> & { id: string; timestamp: string }): RawOnchainTx {
	return {
		token_symbol: 'BTC', value: '1', from_address: OUTSIDE, to_address: WALLET_B,
		tx_type: 'incoming', usd_value: null, chain: 'bitcoin', wallet_address: WALLET_B,
		...o,
	};
}

function pipelineExample(perWalletFrom: string | null = null) {
	const importRows: RawImportTx[] = [
		importRow({ id: 'a1', timestamp_utc: '2023-01-10T00:00:00Z', native_usd: 20_000 }),
		importRow({ id: 'a2', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: 30_000 }),
		importRow({ id: 'send', timestamp_utc: '2025-02-01T00:00:00Z', kind: 'Send', direction: 'out', native_usd: 100_000 }),
	];
	const onchainRows: RawOnchainTx[] = [
		onchainRow({ id: 'b1', timestamp: '2024-09-01T00:00:00Z', usd_value: 60_000 }),
		onchainRow({ id: 'arrive', timestamp: '2025-02-01T00:30:00Z', usd_value: 100_000 }),
		onchainRow({
			id: 'sale', timestamp: '2025-06-01T00:00:00Z', value: '2', usd_value: 180_000,
			from_address: WALLET_B, to_address: OUTSIDE, tx_type: 'outgoing',
		}),
	];

	// Import rows get their real pass 1 classification (Coinbase Buy -> buy, Send -> transfer).
	const classifications = new Map<string, ClassificationResult>();
	for (const r of importRows) {
		const c = classifyImportTxPass1(r);
		if (c) classifications.set(`import:${r.id}`, c);
	}
	const onchain = (id: string, category: ClassificationResult['category'], extra: Partial<ClassificationResult> = {}) =>
		classifications.set(`onchain:${id}`, { sourceType: 'onchain', sourceId: id, category, confidence: 1, ...extra });
	onchain('b1', 'buy');
	onchain('arrive', 'transfer', { linkedTxId: 'send', linkedSourceType: 'import' });
	onchain('sale', 'sell');

	return runFifo('tenant-1', importRows, onchainRows, classifications, { perWalletFrom });
}

describe('Pipeline engine: two wallets, a transfer, a 2025 sale from the receiving wallet', () => {
	it('pass 1 classifies the Coinbase Send as a transfer, so it is not a disposal', () => {
		const c = classifyImportTxPass1(importRow({ id: 'send', timestamp_utc: '2025-02-01T00:00:00Z', kind: 'Send', direction: 'out' }));
		expect(c?.category).toBe('transfer');
		// No link to the arrival: pass 2 only pairs rows pass 1 left unclassified.
		expect(c?.linkedTxId).toBeUndefined();
	});

	it('one pool per coin (before 2025, or outside the per-wallet rollout): the sale takes the two oldest lots anywhere (A1 + A2)', () => {
		const { lots, disposals } = pipelineExample();
		const sale = disposals.filter((d) => d.sourceId === 'sale');
		const lotById = new Map(lots.map((l) => [l.id, l]));

		expect(sale.map((d) => lotById.get(d.lotId)?.sourceId)).toEqual(['a1', 'a2']);
		expect(sum(sale.map((d) => d.costBasisUsd))).toBe(50_000);
		expect(sum(sale.map((d) => d.gainLossUsd))).toBe(130_000);
		expect(sale.every((d) => d.isShortTerm === false)).toBe(true);

		// B1 is what remains, though B1 was in the wallet that sold.
		const open = lots.filter((l) => l.remainingQty > 0);
		expect(open.map((l) => l.sourceId)).toEqual(['b1']);
	});

	it('one pool per coin: a transfer moves no lot, so no lot is split', () => {
		const { lots } = pipelineExample();
		for (const l of lots) expect(l.originLotId).toBeNull();
	});

	it('per wallet from 2025: the sale takes A1 (moved with its 2023 date and cost) and B1 from wallet B', () => {
		const { lots, disposals } = pipelineExample(PER_WALLET_FROM);
		const sale = disposals.filter((d) => d.sourceId === 'sale');
		const lotById = new Map(lots.map((l) => [l.id, l]));
		expect(sale.map((d) => ({
			buyDate: lotById.get(d.lotId)?.acquiredAt.slice(0, 10),
			costUsd: d.costBasisUsd,
			gainLossUsd: d.gainLossUsd,
			shortTerm: d.isShortTerm,
		}))).toEqual(PER_WALLET_SALE);
		// The units that moved are a lot cut from A1: it names its parent and keeps the date and cost.
		const moved = lots.find((l) => l.originLotId !== null);
		expect(moved).toMatchObject({ acquiredAt: '2023-01-10T00:00:00Z', costBasisUsd: 20_000 });
		expect(lotById.get(moved?.originLotId as string)?.sourceId).toBe('a1');
		// A2 is the lot that stays in wallet A.
		expect(lots.filter((l) => l.remainingQty > 0).map((l) => l.sourceId)).toEqual(['a2']);
	});

	it('an exchange-to-exchange transfer is a move: the deposit opens no second lot', () => {
		// Coinbase Buy, Coinbase Send, Kraken deposit of the same coin. Pass 1 marks both legs as
		// transfers with no link; the resolver pairs them (same coin, different accounts, the
		// deposit 2 hours after the send, same quantity). The Coinbase lot is the only lot, with
		// its 2023 date and 20,000 cost, so 1 BTC held is 1 BTC of open lots.
		const rows = [
			importRow({ id: 'buy', timestamp_utc: '2023-01-10T00:00:00Z', native_usd: 20_000 }),
			importRow({ id: 'send', timestamp_utc: '2025-02-01T00:00:00Z', kind: 'Send', direction: 'out', native_usd: 100_000 }),
			importRow({ id: 'dep', timestamp_utc: '2025-02-01T02:00:00Z', kind: 'deposit', direction: 'in', source: 'kraken', native_usd: 100_000 }),
		];
		const classifications = new Map<string, ClassificationResult>();
		for (const r of rows) {
			const c = classifyImportTxPass1(r);
			if (c) classifications.set(`import:${r.id}`, c);
		}
		expect(classifications.get('import:dep')?.category).toBe('transfer');

		const { lots, disposals, findings } = runFifo('tenant-1', rows, [], classifications);
		expect(lots.map((l) => [l.sourceId, l.acquiredAt.slice(0, 10), l.costBasisUsd, l.lotType])).toEqual([
			['buy', '2023-01-10', 20_000, 'purchase'],
		]);
		expect(sum(lots.map((l) => l.remainingQty))).toBe(1);
		expect(disposals).toEqual([]);
		// Paired by amount and time only, so the owner is asked to look at it.
		expect(findings.map((f) => f.reason)).toEqual(['transfer_link_unconfirmed']);
	});

	it('a send nothing was found for consumes the coins and is listed, not booked as a sale', () => {
		const rows = [
			importRow({ id: 'buy', timestamp_utc: '2023-01-10T00:00:00Z', native_usd: 20_000 }),
			importRow({ id: 'send', timestamp_utc: '2025-02-01T00:00:00Z', kind: 'Send', direction: 'out', native_usd: 100_000 }),
		];
		const classifications = new Map<string, ClassificationResult>();
		for (const r of rows) {
			const c = classifyImportTxPass1(r);
			if (c) classifications.set(`import:${r.id}`, c);
		}
		const { lots, disposals, findings } = runFifo('tenant-1', rows, [], classifications);
		expect(disposals).toEqual([]);
		expect(sum(lots.map((l) => l.remainingQty))).toBe(0);
		expect(findings.map((f) => f.reason)).toEqual(['unmatched_transfer']);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle engine (buildAnnualBreakdown, source 'lifecycle') — Bookkeeping, the P&L
// figure, and every 'auto' caller for a year the tax pipeline has not run.
// ─────────────────────────────────────────────────────────────────────────────

type EvInput = {
	direction: 'in' | 'out'; timestamp_utc: string; native_usd: number;
	amount?: number; source_type: 'import' | 'onchain'; source_id: string;
	transaction_class?: string; tx_hash?: string;
	// The source row the lifecycle query joins back to.
	import_source?: string; import_kind?: string; import_account_id?: string;
	tx_wallet_id?: string; tx_chain?: string; from_address?: string; to_address?: string;
};

function ev(o: EvInput) {
	return {
		asset_symbol: 'BTC', amount: 1, transaction_class: 'other', group_id: 'g-btc', tx_hash: null, ...o,
	};
}

const buy = (id: string, at: string, usd: number) =>
	ev({ direction: 'in', timestamp_utc: at, native_usd: usd, source_type: 'import', source_id: id, transaction_class: 'owned_acquisition', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-a' });

const lifecycleEvents = [
	buy('a1', '2023-01-10T00:00:00Z', 20_000),
	buy('a2', '2023-06-01T00:00:00Z', 30_000),
	ev({ direction: 'in', timestamp_utc: '2024-09-01T00:00:00Z', native_usd: 60_000, source_type: 'onchain', source_id: 'b1', tx_wallet_id: 'w-b', tx_chain: 'bitcoin', from_address: OUTSIDE, to_address: WALLET_B, tx_hash: 'h-b1' }),
	// The Coinbase withdrawal and the on-chain arrival share a transaction hash.
	ev({ direction: 'out', timestamp_utc: '2025-02-01T00:00:00Z', native_usd: 100_000, source_type: 'import', source_id: 'send', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-a', tx_hash: 'h-send' }),
	ev({ direction: 'in', timestamp_utc: '2025-02-01T00:30:00Z', native_usd: 100_000, source_type: 'onchain', source_id: 'arrive', tx_wallet_id: 'w-b', tx_chain: 'bitcoin', from_address: OUTSIDE, to_address: WALLET_B, tx_hash: 'h-send' }),
	ev({ direction: 'out', timestamp_utc: '2025-06-01T00:00:00Z', native_usd: 180_000, amount: 2, source_type: 'onchain', source_id: 'sale', tx_wallet_id: 'w-b', tx_chain: 'bitcoin', from_address: WALLET_B, to_address: OUTSIDE, tx_hash: 'h-sale' }),
];

function setupLifecycleMock() {
	mockExecute.mockImplementation(({ sql }: { sql: string }) => {
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) return Promise.resolve({ rows: lifecycleEvents });
		if (sql.includes('FROM wallets')) return Promise.resolve({ rows: [{ id: 'w-b', address: WALLET_B }] });
		return Promise.resolve({ rows: [] });
	});
}

describe('Lifecycle engine: the same example through buildAnnualBreakdown', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		setupLifecycleMock();
	});

	it('the Coinbase-to-wallet send is a move, not a 2025 sale', async () => {
		const bd = await buildAnnualBreakdown('tenant-1', 2025);
		expect([...bd.shortTerm, ...bd.longTerm].filter((l) => l.sellDate.startsWith('2025-02-01'))).toEqual([]);
		expect(bd.needsAttention).toEqual([]);
	});

	it('the arrival opens no new lot: the coins keep their 2023 date and 20,000 cost', async () => {
		const bd = await buildAnnualBreakdown('tenant-1', 2025);
		// A1 and A2 are still pooled with B1 until the sale; the send and the arrival add nothing.
		const before = await buildAnnualBreakdown('tenant-1', 2024);
		expect(before.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd])).toEqual([
			['2023-01-10', 20_000], ['2023-06-01', 30_000], ['2024-09-01', 60_000],
		]);
		expect(bd.stillHolding.map((h) => h.acquiredDate.slice(0, 10))).not.toContain('2025-02-01');
	});

	it('outside the per-wallet rollout the 2025-06-01 sale takes A1 and A2 from the one pool, B1 is left', async () => {
		const bd = await buildAnnualBreakdown('tenant-1', 2025);
		const sale = [...bd.shortTerm, ...bd.longTerm]
			.filter((l) => l.sellDate.startsWith('2025-06-01'))
			.sort((a, b) => a.buyDate.localeCompare(b.buyDate));
		expect(sale.map((l) => [l.buyDate.slice(0, 10), l.costUsd, l.gainLossUsd])).toEqual([
			['2023-01-10', 20_000, 70_000],
			['2023-06-01', 30_000, 60_000],
		]);
		// 2025 realized gain: only the sale, 180,000 less 50,000 of basis.
		expect(bd.totals.longTermGain + bd.totals.shortTermGain).toBe(130_000);
		expect(bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd])).toEqual([['2024-09-01', 60_000]]);
	});

	it('per wallet from 2025 (a tenant in the rollout): the send is not a sale, and wallet B sells A1 then B1', async () => {
		const bd = await buildAnnualBreakdown(OWNER_TENANT_ID, 2025);
		expect(bd.basisMethod).toBe('per_wallet_fifo_from_2025');
		expect(bd.rule).toBe('per_wallet');
		const realized = [...bd.longTerm, ...bd.shortTerm]
			.sort((a, b) => a.buyDate.localeCompare(b.buyDate))
			.map((l) => ({ buyDate: l.buyDate.slice(0, 10), costUsd: l.costUsd, gainLossUsd: l.gainLossUsd, shortTerm: bd.shortTerm.includes(l) }));
		expect(realized).toEqual(PER_WALLET_SALE);
		expect(bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd])).toEqual([['2023-06-01', 30_000]]);
		// A2 is still in the Coinbase account it was bought in.
		expect(bd.stillHolding.map((h) => h.walletKey)).toEqual(['cex:coinbase:acct-a']);
		// Each sale slice names the wallet it was sold from.
		expect([...bd.longTerm, ...bd.shortTerm].every((l) => l.walletKey === `bitcoin:${WALLET_B}`)).toBe(true);
	});

	it('the years before 2025 keep one pool under either method, so a 2024 figure does not move', async () => {
		const pooled = await buildAnnualBreakdown('tenant-1', 2024);
		const perWallet = await buildAnnualBreakdown(OWNER_TENANT_ID, 2024);
		expect(perWallet.rule).toBe('universal');
		expect(pooled.rule).toBe('universal');
		expect(perWallet.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd])).toEqual(
			pooled.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd]),
		);
	});
});
