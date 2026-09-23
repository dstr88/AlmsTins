/**
 * Tests for pass2 — transfer matching and loan detection.
 *
 * The tolerance and window math is the most likely place for silent breakage:
 * a 1% change in TRANSFER_AMOUNT_TOLERANCE would cause legitimate wallet-to-wallet
 * moves to be flagged as taxable events in the review queue instead of non-taxable
 * transfers.
 */

import { describe, it, expect } from 'vitest';
import { matchTransfers, detectLoans } from '../../src/lib/yearEnd/pass2';
import {
	TRANSFER_AMOUNT_TOLERANCE,
	TRANSFER_MATCH_WINDOW_MINUTES,
	TRANSFER_MATCH_WINDOW_CEX_MINUTES,
	LENDING_PROTOCOL_ADDRESSES,
} from '../../src/lib/yearEnd/constants';
import type { RawImportTx, RawOnchainTx } from '../../src/lib/yearEnd/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

const MY_WALLET   = '0xmywallet';
const OTHER_WALLET = '0xotherwallet';
const WALLETS = new Set([MY_WALLET]);

function importSend(overrides: Partial<RawImportTx> & { id: string }): RawImportTx {
	return {
		timestamp_utc: '2024-01-01T12:00:00Z',
		asset_symbol:  'ETH',
		direction:     'out',
		kind:          'send',
		amount:        1,
		to_amount:     null,
		native_usd:    3_000,
		tx_hash:       null,
		source:        'coinbase',
		notes:         null,
		category:      null,
		...overrides,
	};
}

function importReceive(overrides: Partial<RawImportTx> & { id: string }): RawImportTx {
	return {
		timestamp_utc: '2024-01-01T12:05:00Z',
		asset_symbol:  'ETH',
		direction:     'in',
		kind:          'receive',
		amount:        1,
		to_amount:     null,
		native_usd:    3_000,
		tx_hash:       null,
		source:        'exodus',
		notes:         null,
		category:      null,
		...overrides,
	};
}

function onchainTx(overrides: Partial<RawOnchainTx> & { id: string; direction: 'in' | 'out' }): RawOnchainTx {
	const { direction, ...rest } = overrides;
	return {
		timestamp:    '2024-01-01T12:00:00Z',
		token_symbol: 'ETH',
		value:        '1',
		from_address: direction === 'out' ? MY_WALLET    : OTHER_WALLET,
		to_address:   direction === 'out' ? OTHER_WALLET : MY_WALLET,
		tx_type:      'transfer',
		usd_value:    3_000,
		chain:        'ethereum',
		...rest,
	};
}

const NO_CLASSIFIED = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────
// 1. BASIC TRANSFER MATCHING
// ─────────────────────────────────────────────────────────────────────────────

describe('Transfer matching — basic pairing', () => {
	it('matches an outgoing and incoming transfer of the same asset and amount', () => {
		const rows = [
			importSend({ id: 'out1' }),
			importReceive({ id: 'in1' }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);

		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);

		const out = results.find((r) => r.sourceId === 'out1')!;
		const inc = results.find((r) => r.sourceId === 'in1')!;

		expect(out.category).toBe('transfer');
		expect(inc.category).toBe('transfer');
		expect(out.linkedTxId).toBe('in1');
		expect(inc.linkedTxId).toBe('out1');
	});

	it('adds an unmatched_transfer review item when no matching incoming exists', () => {
		const rows = [importSend({ id: 'out1' })];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);

		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('unmatched_transfer');
		expect(reviewItems[0].sourceId).toBe('out1');
	});

	it('does not match transfers of different asset symbols', () => {
		const rows = [
			importSend({ id: 'out1', asset_symbol: 'ETH' }),
			importReceive({ id: 'in1', asset_symbol: 'BTC' }), // different symbol
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);

		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1); // out1 is unmatched
	});

	it('skips rows that are already classified', () => {
		const rows = [
			importSend({ id: 'out1' }),
			importReceive({ id: 'in1' }),
		];
		const alreadyClassified = new Set(['import:out1', 'import:in1']);
		const { results } = matchTransfers(rows, [], WALLETS, alreadyClassified);

		expect(results).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AMOUNT TOLERANCE BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

describe('Transfer matching — amount tolerance', () => {
	const TOL = TRANSFER_AMOUNT_TOLERANCE; // 0.02 = 2%

	it('matches when incoming is exactly at the lower tolerance bound (1 - tol)', () => {
		// out=1.0, inc = 1 - 0.02 = 0.98 → ratio = 0.98, just at the edge
		const rows = [
			importSend({ id: 'out1', amount: 1.0 }),
			importReceive({ id: 'in1', amount: 1.0 * (1 - TOL) }),
		];
		const { results } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
	});

	it('matches the real-world gas scenario: send 1.0 ETH, receive 0.999 ETH', () => {
		// Bridge fee: sender sends 1.0, network takes gas, recipient gets 0.999
		// ratio = 0.999 / 1.0 = 0.999 — well within 2% tolerance
		const rows = [
			importSend({ id: 'out1', asset_symbol: 'ETH', amount: 1.0 }),
			importReceive({ id: 'in1', asset_symbol: 'ETH', amount: 0.999 }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);
	});

	it('does NOT match when incoming is just below the lower tolerance bound', () => {
		// out=1.0, inc=0.979 → ratio=0.979 < 0.98
		const rows = [
			importSend({ id: 'out1', amount: 1.0 }),
			importReceive({ id: 'in1', amount: 0.979 }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1);
	});

	it('matches when incoming is within the upper tolerance bound (1 + tol)', () => {
		// Unusual but valid: incoming slightly more than outgoing
		const rows = [
			importSend({ id: 'out1', amount: 1.0 }),
			importReceive({ id: 'in1', amount: 1.0 * (1 + TOL) }),
		];
		const { results } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
	});

	it('does NOT match when incoming exceeds the upper tolerance bound', () => {
		const rows = [
			importSend({ id: 'out1', amount: 1.0 }),
			importReceive({ id: 'in1', amount: 1.0 * (1 + TOL) + 0.001 }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TIME WINDOW BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

describe('Transfer matching — time window', () => {
	// Commit a343fc4 split the window by source type. A pair with at least one
	// on-chain side uses TRANSFER_MATCH_WINDOW_MINUTES (90 min). A pair where
	// BOTH sides are CSV imports uses TRANSFER_MATCH_WINDOW_CEX_MINUTES (6 h),
	// because exchange CSV timestamps can lag the real transfer by hours. So the
	// 90-minute boundary is pinned with on-chain pairs, and the CEX boundary
	// with import pairs.
	const WIN     = TRANSFER_MATCH_WINDOW_MINUTES;     // on-chain / mixed pairs
	const CEX_WIN = TRANSFER_MATCH_WINDOW_CEX_MINUTES; // import → import pairs

	function tsOffset(baseIso: string, minutes: number): string {
		return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
	}

	const BASE = '2024-01-01T12:00:00.000Z';

	it('the import → import window is wider than the on-chain window', () => {
		// The import cases below place a match at WIN + 1; that only proves the
		// wider window is in effect if WIN + 1 is still inside CEX_WIN.
		expect(CEX_WIN).toBeGreaterThan(WIN + 1);
	});

	// ── On-chain pairs: TRANSFER_MATCH_WINDOW_MINUTES ───────────────────────

	it('on-chain pair: matches when incoming is exactly at the window edge', () => {
		const onchain = [
			onchainTx({ id: 'oc-out', direction: 'out', timestamp: BASE }),
			onchainTx({ id: 'oc-in',  direction: 'in',  timestamp: tsOffset(BASE, WIN) }),
		];
		const { results, reviewItems } = matchTransfers([], onchain, WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);
		expect(results.find((r) => r.sourceId === 'oc-out')?.linkedTxId).toBe('oc-in');
	});

	it('on-chain pair: matches when incoming is 1 minute before the outgoing (negative diff OK)', () => {
		const onchain = [
			onchainTx({ id: 'oc-out', direction: 'out', timestamp: BASE }),
			onchainTx({ id: 'oc-in',  direction: 'in',  timestamp: tsOffset(BASE, -1) }),
		];
		const { results } = matchTransfers([], onchain, WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
	});

	it('on-chain pair: does NOT match when incoming is just outside the window', () => {
		const onchain = [
			onchainTx({ id: 'oc-out', direction: 'out', timestamp: BASE }),
			onchainTx({ id: 'oc-in',  direction: 'in',  timestamp: tsOffset(BASE, WIN + 1) }),
		];
		const { results, reviewItems } = matchTransfers([], onchain, WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('unmatched_transfer');
		expect(reviewItems[0].sourceType).toBe('onchain');
		expect(reviewItems[0].sourceId).toBe('oc-out');
	});

	it('mixed import → on-chain pair keeps the on-chain window (CEX window needs BOTH sides imported)', () => {
		const atEdge = matchTransfers(
			[importSend({ id: 'out1', timestamp_utc: BASE })],
			[onchainTx({ id: 'oc-in', direction: 'in', timestamp: tsOffset(BASE, WIN) })],
			WALLETS,
			NO_CLASSIFIED,
		);
		expect(atEdge.results).toHaveLength(2);
		const out = atEdge.results.find((r) => r.sourceId === 'out1')!;
		expect(out.linkedTxId).toBe('oc-in');
		expect(out.linkedSourceType).toBe('onchain');

		const pastEdge = matchTransfers(
			[importSend({ id: 'out1', timestamp_utc: BASE })],
			[onchainTx({ id: 'oc-in', direction: 'in', timestamp: tsOffset(BASE, WIN + 1) })],
			WALLETS,
			NO_CLASSIFIED,
		);
		expect(pastEdge.results).toHaveLength(0);
		expect(pastEdge.reviewItems).toHaveLength(1);
		expect(pastEdge.reviewItems[0].sourceId).toBe('out1');
	});

	// ── Import → import pairs: TRANSFER_MATCH_WINDOW_CEX_MINUTES ────────────

	it('import pair: matches just past the on-chain window (WIN + 1)', () => {
		const rows = [
			importSend({ id: 'out1', timestamp_utc: BASE }),
			importReceive({ id: 'in1', timestamp_utc: tsOffset(BASE, WIN + 1) }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);
	});

	it('import pair: matches when incoming is exactly at the CEX window edge', () => {
		const rows = [
			importSend({ id: 'out1', timestamp_utc: BASE }),
			importReceive({ id: 'in1', timestamp_utc: tsOffset(BASE, CEX_WIN) }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);
		expect(results.find((r) => r.sourceId === 'out1')?.linkedTxId).toBe('in1');
	});

	it('import pair: does NOT match when incoming is just outside the CEX window', () => {
		const rows = [
			importSend({ id: 'out1', timestamp_utc: BASE }),
			importReceive({ id: 'in1', timestamp_utc: tsOffset(BASE, CEX_WIN + 1) }),
		];
		const { results, reviewItems } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('unmatched_transfer');
		expect(reviewItems[0].sourceId).toBe('out1');
	});

	it('import pair: the CEX window applies before the outgoing too (negative diff)', () => {
		const inside = matchTransfers(
			[
				importSend({ id: 'out1', timestamp_utc: BASE }),
				importReceive({ id: 'in1', timestamp_utc: tsOffset(BASE, -CEX_WIN) }),
			],
			[],
			WALLETS,
			NO_CLASSIFIED,
		);
		expect(inside.results).toHaveLength(2);

		const outside = matchTransfers(
			[
				importSend({ id: 'out1', timestamp_utc: BASE }),
				importReceive({ id: 'in1', timestamp_utc: tsOffset(BASE, -(CEX_WIN + 1)) }),
			],
			[],
			WALLETS,
			NO_CLASSIFIED,
		);
		expect(outside.results).toHaveLength(0);
		expect(outside.reviewItems).toHaveLength(1);
	});

	it('prefers the closest-in-time match when multiple candidates exist', () => {
		const BASE2 = '2024-01-01T12:00:00.000Z';
		const rows = [
			importSend({ id: 'out1', timestamp_utc: BASE2, amount: 1 }),
			importReceive({ id: 'in-far',   timestamp_utc: tsOffset(BASE2, 60), amount: 1 }),
			importReceive({ id: 'in-close', timestamp_utc: tsOffset(BASE2, 5),  amount: 1 }),
		];
		const { results } = matchTransfers(rows, [], WALLETS, NO_CLASSIFIED);
		const out = results.find((r) => r.sourceId === 'out1');
		expect(out?.linkedTxId).toBe('in-close');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ONCHAIN TRANSFER MATCHING
// ─────────────────────────────────────────────────────────────────────────────

describe('Transfer matching — onchain rows', () => {
	it('matches an onchain send with an onchain receive', () => {
		const onchain = [
			onchainTx({ id: 'oc-out', direction: 'out', timestamp: '2024-01-01T12:00:00Z', value: '2' }),
			onchainTx({ id: 'oc-in',  direction: 'in',  timestamp: '2024-01-01T12:10:00Z', value: '2' }),
		];
		const { results, reviewItems } = matchTransfers([], onchain, WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(2);
		expect(reviewItems).toHaveLength(0);
	});

	it('determines direction from wallet address — from=myWallet means out', () => {
		const tx = onchainTx({ id: 'tx1', direction: 'out' });
		// from_address should be MY_WALLET for outgoing
		expect(tx.from_address?.toLowerCase()).toBe(MY_WALLET.toLowerCase());
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. LOAN DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Loan detection', () => {
	const [AAVE_ADDR] = [...LENDING_PROTOCOL_ADDRESSES]; // use first known address

	it('classifies incoming from a lending protocol as "loan-proceeds"', () => {
		const onchain = [
			onchainTx({
				id:           'loan1',
				direction:    'in',
				from_address: AAVE_ADDR,
				to_address:   MY_WALLET,
			}),
		];
		const { results, reviewItems } = detectLoans(onchain, WALLETS, NO_CLASSIFIED);

		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('loan-proceeds');
		expect(results[0].confidence).toBeGreaterThan(0.5);
		// Also queued for review so user can confirm
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('possible_loan');
	});

	it('classifies outgoing to a lending protocol as "collateral-deposit"', () => {
		const onchain = [
			onchainTx({
				id:           'deposit1',
				direction:    'out',
				from_address: MY_WALLET,
				to_address:   AAVE_ADDR,
			}),
		];
		const { results } = detectLoans(onchain, WALLETS, NO_CLASSIFIED);

		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('collateral-deposit');
	});

	it('ignores transactions not involving lending protocols', () => {
		const onchain = [
			onchainTx({
				id:           'normal1',
				direction:    'out',
				from_address: MY_WALLET,
				to_address:   '0xrandom_non_protocol_address',
			}),
		];
		const { results } = detectLoans(onchain, WALLETS, NO_CLASSIFIED);
		expect(results).toHaveLength(0);
	});

	it('skips already-classified rows', () => {
		const onchain = [
			onchainTx({
				id:           'loan1',
				direction:    'in',
				from_address: AAVE_ADDR,
				to_address:   MY_WALLET,
			}),
		];
		const alreadyClassified = new Set(['onchain:loan1']);
		const { results } = detectLoans(onchain, WALLETS, alreadyClassified);
		expect(results).toHaveLength(0);
	});

	it('detects all known lending protocol addresses', () => {
		for (const addr of LENDING_PROTOCOL_ADDRESSES) {
			const onchain = [
				onchainTx({
					id:           `loan-${addr.slice(-4)}`,
					direction:    'in',
					from_address: addr,
					to_address:   MY_WALLET,
				}),
			];
			const { results } = detectLoans(onchain, WALLETS, NO_CLASSIFIED);
			expect(results[0]?.category, `address ${addr}`).toBe('loan-proceeds');
		}
	});
});
