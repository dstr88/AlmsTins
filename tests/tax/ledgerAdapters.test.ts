/**
 * The two ledger adapters (lifecycle and pipeline): which rows are transfer legs, what a leg is
 * when nothing is paired with it, and that a paired transfer leaves the ledger with no sale, no
 * second lot and the original date and cost. Pure: no database. Every address, id and amount here
 * is invented.
 */

import { describe, it, expect } from 'vitest';
import { lifecycleToLedger, type LifecycleEventRow } from '../../src/lib/tax/ledgerAdapters/lifecycle';
import { onchainQuantity, pipelineToLedger } from '../../src/lib/tax/ledgerAdapters/pipeline';
import { runLotLedger, type LedgerEvent } from '../../src/lib/tax/lotLedger';
import type { OwnerIndex } from '../../src/lib/walletIdentity';
import type { ClassificationResult, RawImportTx, RawOnchainTx } from '../../src/lib/yearEnd/types';

const A = `0x${'a'.repeat(40)}`; // the owner's wallet 1
const B = `0x${'b'.repeat(40)}`; // the owner's wallet 2
const FAR = `0x${'f'.repeat(40)}`; // an address the owner does not track
const HASH = `0x${'1'.repeat(64)}`;
const noOwners: OwnerIndex = { byKey: new Map(), byAddress: new Map() };
const wallets = [
	{ id: 'wa', address: A },
	{ id: 'wb', address: B },
];

// ── Lifecycle rows ───────────────────────────────────────────────────────────

function lrow(o: Partial<LifecycleEventRow> & { direction: 'in' | 'out'; timestamp_utc: string; source_id: string; source_type: 'import' | 'onchain' | 'sui' }): LifecycleEventRow {
	return { asset_symbol: 'BTC', amount: 1, native_usd: 10_000, transaction_class: 'other', group_id: 'g', tx_hash: null, ...o };
}
const buy = (id: string, at: string, usd = 10_000) =>
	lrow({ direction: 'in', timestamp_utc: at, source_id: id, source_type: 'import', native_usd: usd, transaction_class: 'owned_acquisition', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' });
const kinds = (events: LedgerEvent[]) => events.map((e) => e.kind).sort();
const gains = (events: LedgerEvent[]) => runLotLedger(events);

describe('lifecycleToLedger', () => {
	it('an exchange withdrawal and the on-chain arrival with the same hash are one move: no sale, no second lot', () => {
		const { events } = lifecycleToLedger({
			events: [
				buy('buy-1', '2022-01-10T00:00:00Z', 20_000),
				lrow({ direction: 'out', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'send-1', source_type: 'import', native_usd: 100_000, import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1', tx_hash: HASH }),
				lrow({ direction: 'in', timestamp_utc: '2023-02-01T00:30:00Z', source_id: 'arrive-1', source_type: 'onchain', native_usd: 100_000, tx_wallet_id: 'wa', tx_chain: 'bitcoin', from_address: FAR, to_address: A, tx_hash: HASH }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		expect(kinds(events)).toEqual(['acquire', 'move']);
		const r = gains(events);
		expect(r.slices).toEqual([]);
		expect(r.unmatched).toEqual([]);
		expect(r.lots.map((l) => [l.acquiredAt.slice(0, 10), l.costUsd, l.remainingQty])).toEqual([['2022-01-10', 20_000, 1]]);
		// Linked by the transaction, so nothing to confirm.
		expect(r.findings).toEqual([]);
	});

	it('one on-chain row with both ends tracked is a move between two wallets, whichever wallet synced it', () => {
		const row = lrow({ direction: 'out', timestamp_utc: '2023-03-01T00:00:00Z', source_id: 'self-1', source_type: 'onchain', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: B, tx_hash: HASH });
		const { events } = lifecycleToLedger({
			events: [lrow({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', source_id: 'in-a', source_type: 'onchain', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: FAR, to_address: A, tx_hash: `0x${'2'.repeat(64)}` }), row],
			wallets,
			ownerIndex: noOwners,
		});
		const moves = events.filter((e) => e.kind === 'move');
		expect(moves).toHaveLength(1);
		expect(moves[0]).toMatchObject({ fromWallet: `ethereum:${A}`, toWallet: `ethereum:${B}`, link: 'hash', qtyOut: 1, qtyIn: 1 });
		expect(events.some((e) => e.kind === 'dispose')).toBe(false);
		const r = gains(events);
		expect(r.slices).toEqual([]);
		expect(r.lots).toHaveLength(1);
	});

	it('the same self-send stored twice is counted once', () => {
		const dup = (id: string) => lrow({ direction: 'out', timestamp_utc: '2023-03-01T00:00:00Z', source_id: id, source_type: 'onchain', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: B, tx_hash: HASH });
		const { events } = lifecycleToLedger({ events: [dup('s1'), dup('s2')], wallets, ownerIndex: noOwners });
		expect(events.filter((e) => e.kind === 'move')).toHaveLength(1);
	});

	it('an on-chain send to an address Almstins does not track stays a sale', () => {
		const { events } = lifecycleToLedger({
			events: [
				lrow({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', source_id: 'in-a', source_type: 'onchain', native_usd: 5_000, tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: FAR, to_address: A }),
				lrow({ direction: 'out', timestamp_utc: '2023-01-01T00:00:00Z', source_id: 'pay-1', source_type: 'onchain', native_usd: 9_000, tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: FAR }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		const sale = events.find((e) => e.kind === 'dispose');
		expect(sale).toMatchObject({ kind: 'dispose', taxable: true, proceedsUsd: 9_000 });
		expect(gains(events).slices.map((s) => [s.taxable, s.gain])).toEqual([[true, 4_000]]);
	});

	it('an exchange Send nothing was found for consumes the coins, is listed, and is not a sale', () => {
		const { events } = lifecycleToLedger({
			events: [
				buy('buy-1', '2022-01-10T00:00:00Z', 20_000),
				lrow({ direction: 'out', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'send-1', source_type: 'import', native_usd: 100_000, import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1' }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		expect(kinds(events)).toEqual(['acquire', 'sendUnmatched']);
		const r = gains(events);
		expect(r.slices.every((s) => !s.taxable)).toBe(true);
		expect(r.findings.map((f) => f.reason)).toEqual(['unmatched_transfer']);
	});

	it('an arrival from a source that is not tracked opens a lot at its value on arrival, as it always has', () => {
		const { events } = lifecycleToLedger({
			events: [lrow({ direction: 'in', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'dep-1', source_type: 'import', native_usd: 50_000, import_source: 'kraken', import_kind: 'deposit', import_account_id: 'k1' })],
			wallets,
			ownerIndex: noOwners,
		});
		expect(events).toMatchObject([{ kind: 'acquire', costUsd: 50_000, origin: 'transfer_in_untracked' }]);
		expect(gains(events).findings.map((f) => f.reason)).toEqual(['estimated_transfer_basis']);
	});

	it('a deposit and the Withdrawal that is later paired by amount and time are a move the owner is asked to check', () => {
		const { events } = lifecycleToLedger({
			events: [
				buy('buy-1', '2022-01-10T00:00:00Z', 20_000),
				lrow({ direction: 'out', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'send-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1' }),
				lrow({ direction: 'in', timestamp_utc: '2023-02-01T02:00:00Z', source_id: 'dep-1', source_type: 'import', import_source: 'kraken', import_kind: 'deposit', import_account_id: 'k1' }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		expect(events.find((e) => e.kind === 'move')).toMatchObject({ link: 'heuristic' });
		const r = gains(events);
		expect(r.slices).toEqual([]);
		expect(r.lots).toHaveLength(1);
		expect(r.findings.map((f) => f.reason)).toEqual(['transfer_link_unconfirmed']);
	});

	it('a transfer_matches row the owner rejected is never linked', () => {
		const { events } = lifecycleToLedger({
			events: [
				buy('buy-1', '2022-01-10T00:00:00Z', 20_000),
				lrow({ direction: 'out', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'send-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1' }),
				lrow({ direction: 'in', timestamp_utc: '2023-02-01T02:00:00Z', source_id: 'dep-1', source_type: 'import', import_source: 'kraken', import_kind: 'deposit', import_account_id: 'k1' }),
			],
			wallets,
			ownerIndex: noOwners,
			transferMatches: [{ outId: 'send-1', inId: 'dep-1', status: 'rejected' }],
		});
		expect(events.some((e) => e.kind === 'move')).toBe(false);
		expect(kinds(events)).toEqual(['acquire', 'acquire', 'sendUnmatched']);
	});

	it('an entered basis on a leg that turns out to be a transfer is ignored, and the ledger says so', () => {
		const { events } = lifecycleToLedger({
			events: [
				lrow({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', source_id: 'in-a', source_type: 'onchain', native_usd: 1, asset_symbol: 'USDC', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: FAR, to_address: A }),
				lrow({ direction: 'out', timestamp_utc: '2023-03-01T00:00:00Z', source_id: 'self-1', source_type: 'onchain', native_usd: 1, asset_symbol: 'USDC', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: B, tx_hash: HASH }),
			],
			wallets,
			ownerIndex: noOwners,
			manualBasis: new Map([['self-1', { pricePerToken: 1, buyDateIso: '2022-01-01T00:00:00Z' }]]),
		});
		const r = gains(events);
		expect(r.slices).toEqual([]);
		expect(r.findings.map((f) => f.reason)).toEqual(['manual_basis_on_transfer']);
	});

	it('collateral deposits and repayments use up lots without a gain, and are never transfers', () => {
		const { events, refs } = lifecycleToLedger({
			events: [
				lrow({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', source_id: 'in-a', source_type: 'onchain', native_usd: 1_000, asset_symbol: 'USDC', transaction_class: 'owned_acquisition', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: FAR, to_address: A }),
				lrow({ direction: 'out', timestamp_utc: '2023-01-01T00:00:00Z', source_id: 'dep-1', source_type: 'onchain', native_usd: 1_000, asset_symbol: 'USDC', transaction_class: 'collateral_deposit', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: FAR, tx_hash: HASH }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		expect(events.find((e) => e.kind === 'dispose')).toMatchObject({ taxable: false, category: 'collateral_deposit' });
		expect(refs.get('dep-1')).toMatchObject({ transactionClass: 'collateral_deposit', txHash: HASH });
		expect(gains(events).slices.map((s) => [s.taxable, s.category])).toEqual([[false, 'collateral_deposit']]);
	});

	it('fiat is not a transfer leg: it keeps the treatment it always had', () => {
		const { events } = lifecycleToLedger({
			events: [lrow({ direction: 'out', timestamp_utc: '2023-02-01T00:00:00Z', source_id: 'w-usd', source_type: 'import', asset_symbol: 'USD', amount: 500, native_usd: 500, import_source: 'coinbase', import_kind: 'Withdrawal', import_account_id: 'acct-1' })],
			wallets,
			ownerIndex: noOwners,
		});
		expect(events).toMatchObject([{ kind: 'dispose', taxable: true, asset: 'USD' }]);
	});

	it('a Sui or custom entry with no source row is a plain lot or sale in the unresolved pool', () => {
		const { events } = lifecycleToLedger({
			events: [
				lrow({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z', source_id: '', source_type: 'sui', asset_symbol: 'SUI', native_usd: 100, transaction_class: 'owned_acquisition' }),
				lrow({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', source_id: '', source_type: 'sui', asset_symbol: 'SUI', native_usd: 150, transaction_class: 'owned_acquisition' }),
			],
			wallets,
			ownerIndex: noOwners,
		});
		const r = gains(events);
		expect(r.slices.map((s) => s.gain)).toEqual([50]);
	});

	it('the owner labels on two wallets make the move a transfer between owners', () => {
		const owners: OwnerIndex = {
			byKey: new Map([[`ethereum:${A}`, 'Me'], [`ethereum:${B}`, 'Spouse']]),
			byAddress: new Map(),
		};
		const { events } = lifecycleToLedger({
			events: [
				lrow({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', source_id: 'in-a', source_type: 'onchain', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: FAR, to_address: A }),
				lrow({ direction: 'out', timestamp_utc: '2023-03-01T00:00:00Z', source_id: 'self-1', source_type: 'onchain', tx_wallet_id: 'wa', tx_chain: 'ethereum', from_address: A, to_address: B, tx_hash: HASH }),
			],
			wallets,
			ownerIndex: owners,
		});
		const r = gains(events);
		expect(r.slices).toEqual([]);
		expect(r.findings.map((f) => f.reason)).toEqual(['transfer_between_owners']);
	});
});

// ── Pipeline rows ────────────────────────────────────────────────────────────

function irow(o: Partial<RawImportTx> & { id: string; timestamp_utc: string }): RawImportTx {
	return {
		asset_symbol: 'BTC', direction: 'in', kind: 'Buy', amount: 1, to_amount: null, native_usd: null, tx_hash: null,
		source: 'coinbase', notes: null, category: null, description: null, account_id: 'acct-1', ...o,
	};
}
function orow(o: Partial<RawOnchainTx> & { id: string; timestamp: string }): RawOnchainTx {
	return {
		token_symbol: 'ETH', value: '1', from_address: FAR, to_address: A, tx_type: 'incoming', usd_value: null, chain: 'ethereum',
		wallet_address: A, wallet_id: 'wa', ...o,
	};
}
const cls = (entries: [string, ClassificationResult['category'], Partial<ClassificationResult>?][]) =>
	new Map<string, ClassificationResult>(entries.map(([key, category, extra]) => {
		const [sourceType, sourceId] = key.split(':') as ['import' | 'onchain', string];
		return [key, { sourceType, sourceId, category, confidence: 1, ...extra }];
	}));
const walletMap = new Map(wallets.map((w) => [w.id, { address: w.address }]));

describe('pipelineToLedger', () => {
	it('maps buy, income and airdrop to lots, and sell, swap-out and burn to sales', () => {
		const { events } = pipelineToLedger({
			importRows: [
				irow({ id: 'b', timestamp_utc: '2022-01-01T00:00:00Z', native_usd: 100 }),
				irow({ id: 'i', timestamp_utc: '2022-02-01T00:00:00Z', kind: 'Staking Income', native_usd: 5 }),
				irow({ id: 'a', timestamp_utc: '2022-03-01T00:00:00Z', kind: 'Airdrop', native_usd: 1 }),
				irow({ id: 's', timestamp_utc: '2022-06-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 0.5, native_usd: 80 }),
				irow({ id: 'sw-out', timestamp_utc: '2022-07-01T00:00:00Z', direction: 'out', kind: 'Convert', amount: 0.1, native_usd: 20 }),
				irow({ id: 'sw-in', timestamp_utc: '2022-07-01T00:00:00Z', direction: 'in', kind: 'Convert', asset_symbol: 'ETH', amount: 2, native_usd: 20 }),
			],
			onchainRows: [],
			classifications: cls([
				['import:b', 'buy'], ['import:i', 'income'], ['import:a', 'airdrop'], ['import:s', 'sell'], ['import:sw-out', 'swap'], ['import:sw-in', 'swap'],
			]),
			ownerIndex: noOwners,
		});
		expect(events.map((e) => [e.kind, (e as { origin?: string }).origin ?? (e as { category?: string }).category])).toEqual([
			['acquire', 'purchase'], ['acquire', 'income'], ['acquire', 'airdrop'], ['dispose', 'sell'], ['dispose', 'swap'], ['acquire', 'swap_in'],
		]);
	});

	it('a swap received leg opens a lot at its value, and fiat never opens one', () => {
		const { events } = pipelineToLedger({
			importRows: [irow({ id: 'usd', timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'USD', amount: 500, native_usd: 500 })],
			onchainRows: [],
			classifications: cls([['import:usd', 'buy']]),
			ownerIndex: noOwners,
		});
		expect(events).toEqual([]);
	});

	it('a priced deposit nothing is paired with opens a lot at its value; an unpriced one opens nothing', () => {
		const { events } = pipelineToLedger({
			importRows: [
				irow({ id: 'priced', timestamp_utc: '2023-01-01T00:00:00Z', kind: 'deposit', source: 'kraken', native_usd: 40_000 }),
				irow({ id: 'unpriced', timestamp_utc: '2023-02-01T00:00:00Z', kind: 'deposit', source: 'kraken', native_usd: null }),
			],
			onchainRows: [],
			classifications: cls([['import:priced', 'transfer'], ['import:unpriced', 'transfer']]),
			ownerIndex: noOwners,
		});
		expect(events).toMatchObject([{ kind: 'acquire', id: 'priced', costUsd: 40_000, origin: 'transfer_in_untracked' }]);
	});

	it('principal returning from Crypto.com Earn is not a transfer and opens no lot', () => {
		const { events } = pipelineToLedger({
			importRows: [irow({ id: 'earn', timestamp_utc: '2023-01-01T00:00:00Z', kind: 'crypto_earn_program_withdrawn', source: 'crypto_com', native_usd: 40_000 })],
			onchainRows: [],
			classifications: cls([['import:earn', 'transfer']]),
			ownerIndex: noOwners,
		});
		expect(events).toEqual([]);
	});

	it("pass 2's own pairs link the legs, and the owner's are confirmed", () => {
		const input = {
			importRows: [irow({ id: 'send', timestamp_utc: '2023-02-01T00:00:00Z', direction: 'out' as const, kind: 'Send', native_usd: 9 })],
			onchainRows: [orow({ id: 'arrive', timestamp: '2023-02-03T00:00:00Z', token_symbol: 'BTC', value: '1', usd_value: 9 })],
			ownerIndex: noOwners,
			wallets: walletMap,
		};
		// Two days apart, so the arrival window does not pair them; only the classification's link does.
		const auto = pipelineToLedger({ ...input, classifications: cls([['import:send', 'transfer', { linkedTxId: 'arrive' }], ['onchain:arrive', 'transfer', { linkedTxId: 'send' }]]) });
		expect(auto.events.find((e) => e.kind === 'move')).toMatchObject({ link: 'heuristic' });
		const manual = pipelineToLedger({
			...input,
			classifications: cls([['import:send', 'transfer'], ['onchain:arrive', 'transfer', { linkedTxId: 'send' }]]),
			manualKeys: new Set(['onchain:arrive']),
		});
		expect(manual.events.find((e) => e.kind === 'move')).toMatchObject({ link: 'confirmed' });
		const none = pipelineToLedger({ ...input, classifications: cls([['import:send', 'transfer'], ['onchain:arrive', 'transfer']]) });
		expect(none.events.some((e) => e.kind === 'move')).toBe(false);
	});

	it('an on-chain row between two tracked wallets that nothing classified is a move', () => {
		const { events } = pipelineToLedger({
			importRows: [],
			onchainRows: [orow({ id: 'self', timestamp: '2023-03-01T00:00:00Z', from_address: A, to_address: B, tx_type: 'outgoing', hash: HASH })],
			classifications: new Map(),
			ownerIndex: noOwners,
			wallets: walletMap,
		});
		expect(events).toMatchObject([{ kind: 'move', link: 'hash', fromWallet: `ethereum:${A}`, toWallet: `ethereum:${B}` }]);
	});

	it('an on-chain row to an address that is not tracked and was never classified is left alone', () => {
		const { events } = pipelineToLedger({
			importRows: [],
			onchainRows: [orow({ id: 'x', timestamp: '2023-03-01T00:00:00Z', from_address: A, to_address: FAR, tx_type: 'outgoing' })],
			classifications: new Map(),
			ownerIndex: noOwners,
			wallets: walletMap,
		});
		expect(events).toEqual([]);
	});

	it("applies the owner's entered basis to the sale it was entered for", () => {
		const { events } = pipelineToLedger({
			importRows: [irow({ id: 's', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Sell', native_usd: 80 })],
			onchainRows: [],
			classifications: cls([['import:s', 'sell']]),
			ownerIndex: noOwners,
			manualBasis: new Map([['s', { pricePerToken: 30, buyDateIso: '2020-01-01T00:00:00Z' }]]),
		});
		const r = runLotLedger(events);
		expect(r.slices.map((s) => [s.basisSource, s.cost, s.gain, s.term])).toEqual([['manual', 30, 50, 'long']]);
		expect(r.unmatched).toEqual([]);
	});

	it('keeps each exchange account its own wallet', () => {
		const { events } = pipelineToLedger({
			importRows: [
				irow({ id: 'b1', timestamp_utc: '2022-01-01T00:00:00Z', native_usd: 100, account_id: 'acct-1' }),
				irow({ id: 'b2', timestamp_utc: '2022-01-02T00:00:00Z', native_usd: 100, account_id: 'acct-2' }),
				irow({ id: 'b3', timestamp_utc: '2022-01-03T00:00:00Z', native_usd: 100, account_id: null }),
			],
			onchainRows: [],
			classifications: cls([['import:b1', 'buy'], ['import:b2', 'buy'], ['import:b3', 'buy']]),
			ownerIndex: noOwners,
		});
		expect(events.map((e) => (e as { wallet: string }).wallet)).toEqual(['cex:coinbase:acct-1', 'cex:coinbase:acct-2', 'cex:coinbase:unassigned']);
	});
});

describe('onchainQuantity', () => {
	it('divides a raw on-chain value by the token decimals', () => {
		expect(onchainQuantity(orow({ id: 'x', timestamp: 't', value: '1500000000000000000', token_decimals: 18 }))).toBe(1.5);
		expect(onchainQuantity(orow({ id: 'x', timestamp: 't', value: '2500000', token_decimals: 6 }))).toBe(2.5);
	});

	it('a token with no decimals at all reads its value as whole units', () => {
		expect(onchainQuantity(orow({ id: 'x', timestamp: 't', value: '5', token_decimals: 0 }))).toBe(5);
	});

	it('a database row with an empty decimals is read as 18, as the lifecycle rebuild reads it', () => {
		expect(onchainQuantity(orow({ id: 'x', timestamp: 't', value: '1000000000000000000', token_decimals: null }))).toBe(1);
	});

	it('a row without a token_decimals field (a fixture) is already in whole units', () => {
		const row = orow({ id: 'x', timestamp: 't', value: '3.5' });
		delete (row as { token_decimals?: unknown }).token_decimals;
		expect(onchainQuantity(row)).toBe(3.5);
	});
});
