/**
 * XPR Network accounts in the tax engine. Pure: no database. Every name, id and amount is invented.
 *
 *   - Each XPR account is its own wallet: the key is xpr:{name}, from the row's wallet.
 *   - A send from one of the owner's XPR accounts to another pairs by transaction id and is a MOVE:
 *     no sale, no second lot, the original date and cost kept, and the per-wallet pools of PR #48
 *     (2025 and later) see the coins leave one and arrive in the other.
 *   - A send with nothing paired stays what a chain-synced send always was (a sale), except a
 *     transfer stored for review (staking, lock, swap, system accounts): that consumes the coins and
 *     is listed, never booked as a sale. Almstins gives such a row no treatment of its own.
 *   - A token of another contract is its own asset ('SYMBOL@contract'), never the coin or another token.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

import { pipelineToLedger } from '../../src/lib/tax/ledgerAdapters/pipeline';
import { lifecycleToLedger, type LifecycleEventRow } from '../../src/lib/tax/ledgerAdapters/lifecycle';
import { runLotLedger } from '../../src/lib/tax/lotLedger';
import { walletKeyOfRef, walletOfRow } from '../../src/lib/tax/walletOfRow';
import type { OwnerIndex } from '../../src/lib/walletIdentity';
import type { ClassificationResult, RawImportTx } from '../../src/lib/yearEnd/types';

const noOwners: OwnerIndex = { byKey: new Map(), byAddress: new Map() };
const ALICE = 'testalice1';
const BOB = 'testbob2';
const TX = 'ab'.repeat(32);
const walletMap = new Map([
	['w-alice', { address: ALICE }],
	['w-bob', { address: BOB }],
]);
const wallets = [
	{ id: 'w-alice', address: ALICE, chains: ['xpr'] },
	{ id: 'w-bob', address: BOB, chains: ['xpr'] },
];

function irow(o: Partial<RawImportTx> & { id: string; timestamp_utc: string }): RawImportTx {
	return {
		asset_symbol: 'XPR', direction: 'in', kind: 'receive', amount: 1000, to_amount: null, native_usd: 2, tx_hash: null,
		source: 'xpr', notes: null, category: null, description: 'receive', account_id: 'acct-xpr', wallet_id: 'w-alice', ...o,
	} as RawImportTx;
}
const transfers = (...ids: string[]) =>
	new Map<string, ClassificationResult>(ids.map((id) => [`import:${id}`, { sourceType: 'import', sourceId: id, category: 'transfer', confidence: 0.95 }]));

describe('each XPR account is its own wallet', () => {
	it('keys on xpr:{name}, from the row\'s wallet, even though the rows share one exchange account', () => {
		const ctx = { wallets: walletMap, owned: new Set<string>() };
		const a = walletOfRow({ origin: 'import', source: 'xpr', walletId: 'w-alice', accountId: 'acct-xpr' }, ctx);
		const b = walletOfRow({ origin: 'import', source: 'xpr', walletId: 'w-bob', accountId: 'acct-xpr' }, ctx);

		expect(a.legs).toEqual([{ side: null, wallet: `xpr:${ALICE}` }]);
		expect(b.legs).toEqual([{ side: null, wallet: `xpr:${BOB}` }]);
		expect(a.basis).toBe('wallet');
		expect(walletKeyOfRef({ kind: 'wallet', walletId: 'w-alice', chain: 'xpr' }, walletMap)).toBe(`xpr:${ALICE}`);
	});
});

describe('between the owner\'s own XPR accounts', () => {
	const rows = [
		irow({ id: 'buy', timestamp_utc: '2024-03-01T00:00:00Z', direction: 'in', kind: 'receive', amount: 1000, native_usd: 2000 }),
		irow({ id: 'out', timestamp_utc: '2025-02-01T00:00:00Z', direction: 'out', kind: 'send', amount: 400, native_usd: 800, tx_hash: TX }),
		irow({ id: 'in', timestamp_utc: '2025-02-01T00:00:00Z', direction: 'in', kind: 'receive', amount: 400, native_usd: 800, tx_hash: TX, wallet_id: 'w-bob' }),
	];

	it('the pipeline engine pairs the two legs by transaction id: a move, with no sale and no second lot', () => {
		const { events } = pipelineToLedger({
			importRows: rows, onchainRows: [], ownerIndex: noOwners, wallets: walletMap,
			classifications: new Map<string, ClassificationResult>([
				['import:buy', { sourceType: 'import', sourceId: 'buy', category: 'income', confidence: 1 }],
				...transfers('out', 'in'),
			]),
		});
		expect(events.find((e) => e.kind === 'move')).toMatchObject({ kind: 'move', link: 'hash', fromWallet: `xpr:${ALICE}`, toWallet: `xpr:${BOB}`, asset: 'XPR' });
		expect(events.filter((e) => e.kind === 'dispose')).toEqual([]);
		const r = runLotLedger(events);
		expect(r.slices.filter((s) => s.taxable)).toEqual([]);
	});

	it('the lifecycle engine does the same', () => {
		const lrow = (o: Partial<LifecycleEventRow> & { direction: 'in' | 'out'; timestamp_utc: string; source_id: string }): LifecycleEventRow => ({
			asset_symbol: 'XPR', amount: 1000, native_usd: 2000, transaction_class: 'other', group_id: 'g', tx_hash: null, source_type: 'import',
			import_source: 'xpr', import_account_id: 'acct-xpr', import_wallet_id: 'w-alice', import_description: 'send', ...o,
		});
		const { events } = lifecycleToLedger({
			wallets, ownerIndex: noOwners,
			events: [
				lrow({ direction: 'in', timestamp_utc: '2024-03-01T00:00:00Z', source_id: 'buy', transaction_class: 'owned_acquisition', import_kind: 'receive' }),
				lrow({ direction: 'out', timestamp_utc: '2025-02-01T00:00:00Z', source_id: 'out', amount: 400, native_usd: 800, tx_hash: TX, import_kind: 'send' }),
				lrow({ direction: 'in', timestamp_utc: '2025-02-01T00:00:00Z', source_id: 'in', amount: 400, native_usd: 800, tx_hash: TX, transaction_class: 'owned_acquisition', import_kind: 'receive', import_wallet_id: 'w-bob' }),
			],
		});
		expect(events.find((e) => e.kind === 'move')).toMatchObject({ link: 'hash', fromWallet: `xpr:${ALICE}`, toWallet: `xpr:${BOB}` });
		expect(events.filter((e) => e.kind === 'dispose')).toEqual([]);
	});
});

describe('a send with nothing paired', () => {
	const buy = irow({ id: 'buy', timestamp_utc: '2024-03-01T00:00:00Z', direction: 'in', kind: 'receive', amount: 1000, native_usd: 2000 });
	const classifications = (id: string) => new Map<string, ClassificationResult>([['import:buy', { sourceType: 'import', sourceId: 'buy', category: 'income', confidence: 1 }], ...transfers(id)]);

	it('an ordinary send stays what a chain-synced send always was: the engine\'s generic rule, unchanged', () => {
		const { events } = pipelineToLedger({
			importRows: [buy, irow({ id: 'pay', timestamp_utc: '2025-02-01T00:00:00Z', direction: 'out', kind: 'send', amount: 400, native_usd: 800 })],
			onchainRows: [], ownerIndex: noOwners, wallets: walletMap, classifications: classifications('pay'),
		});
		expect(events.find((e) => e.id === 'pay')).toMatchObject({ kind: 'dispose', taxable: true });
	});

	it('a transfer stored for review consumes the coins and is listed, never booked as a sale', () => {
		const { events } = pipelineToLedger({
			importRows: [buy, irow({ id: 'stake', timestamp_utc: '2025-02-01T00:00:00Z', direction: 'out', kind: 'send_review', amount: 400, native_usd: 800 })],
			onchainRows: [], ownerIndex: noOwners, wallets: walletMap, classifications: classifications('stake'),
		});
		expect(events.some((e) => e.kind === 'dispose')).toBe(false);
		const r = runLotLedger(events);
		expect(r.slices.filter((s) => s.taxable)).toEqual([]);
		expect(r.findings.map((f) => f.reason)).toContain('unmatched_transfer');
	});

	it('the lifecycle engine treats it the same way', () => {
		const lrow = (o: Partial<LifecycleEventRow> & { direction: 'in' | 'out'; timestamp_utc: string; source_id: string }): LifecycleEventRow => ({
			asset_symbol: 'XPR', amount: 1000, native_usd: 2000, transaction_class: 'other', group_id: 'g', tx_hash: null, source_type: 'import',
			import_source: 'xpr', import_account_id: 'acct-xpr', import_wallet_id: 'w-alice', import_description: 'send', ...o,
		});
		const events = (kind: string) =>
			lifecycleToLedger({
				wallets, ownerIndex: noOwners,
				events: [
					lrow({ direction: 'in', timestamp_utc: '2024-03-01T00:00:00Z', source_id: 'buy', transaction_class: 'owned_acquisition', import_kind: 'receive' }),
					lrow({ direction: 'out', timestamp_utc: '2025-02-01T00:00:00Z', source_id: 'out', amount: 400, native_usd: 800, import_kind: kind }),
				],
			}).events;
		expect(events('send').find((e) => e.id === 'out')).toMatchObject({ kind: 'dispose', taxable: true });
		expect(events('send_review').some((e) => e.kind === 'dispose')).toBe(false);
		expect(runLotLedger(events('send_review')).findings.map((f) => f.reason)).toContain('unmatched_transfer');
	});
});

describe('tokens are their own assets', () => {
	it('a token of another contract is not the coin and not another contract\'s token', () => {
		const { events } = pipelineToLedger({
			importRows: [
				irow({ id: 'coin', timestamp_utc: '2024-03-01T00:00:00Z', asset_symbol: 'XPR', amount: 5, native_usd: 10 }),
				irow({ id: 'tokA', timestamp_utc: '2024-03-02T00:00:00Z', asset_symbol: 'XUSDC@xtokens', amount: 5, native_usd: null }),
				irow({ id: 'tokB', timestamp_utc: '2024-03-03T00:00:00Z', asset_symbol: 'XUSDC@scamtoken1', amount: 5, native_usd: null }),
			],
			onchainRows: [], ownerIndex: noOwners, wallets: walletMap,
			classifications: new Map(['coin', 'tokA', 'tokB'].map((id) => [`import:${id}`, { sourceType: 'import', sourceId: id, category: 'income', confidence: 1 } as ClassificationResult])),
		});
		expect(events.map((e) => (e as { asset: string }).asset)).toEqual(['XPR', 'XUSDC@XTOKENS', 'XUSDC@SCAMTOKEN1']);
	});
});
