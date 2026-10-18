import { describe, it, expect, vi } from 'vitest';

// walletIdentity.ts (its real owner index is used once below) opens the database at import; the resolver is pure.
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

import { ownersDiffer, resolveTransferLinks, type TransferLinkResult, type TransferMatchRow, type TransferRow } from '../../src/lib/tax/transferLinks';
import { buildOwnedIndex } from '../../src/lib/tax/walletOfRow';
import { buildOwnerIndex, type OwnerIndex } from '../../src/lib/walletIdentity';

/**
 * src/lib/tax/transferLinks.ts: pair each transfer-out with the transfer-in it landed as.
 *
 * Precedence: hash, then confirmed (the owner's own link or a confirmed transfer_matches row),
 * then the matcher's own suggestions, then the arrival window (6 hours, 1%). A rejected pair is
 * never linked; a row joins one link; matching is greedy in (time, id) order. Every id, address
 * and name here is invented.
 */

const CB = 'cex:coinbase:acct-1';
const KR = 'cex:kraken:k1';
const NO_OWNERS: OwnerIndex = { byKey: new Map(), byAddress: new Map() };
const HASH = '0x' + 'ab'.repeat(32);

function row(o: Partial<TransferRow> & Pick<TransferRow, 'id' | 'direction'>): TransferRow {
	return { asset: 'BTC', qty: 1, at: '2025-02-01T00:00:00Z', wallet: o.direction === 'out' ? CB : KR, source: 'import', category: 'transfer', ...o };
}
const out = (id: string, o: Partial<TransferRow> = {}) => row({ id, direction: 'out', ...o });
const inn = (id: string, o: Partial<TransferRow> = {}) => row({ id, direction: 'in', ...o });

function resolve(rows: TransferRow[], matches: TransferMatchRow[] = [], owned: ReadonlySet<string> = new Set(), owners: OwnerIndex = NO_OWNERS): TransferLinkResult {
	return resolveTransferLinks(rows, owned, matches, owners);
}
const pairs = (r: TransferLinkResult) => r.links.map((l) => [l.outId, l.inId, l.link, l.via]);
const match = (outId: string, inId: string, status: string, confidence?: number): TransferMatchRow => ({ outId, inId, status, confidence });

/** Minutes after 2025-02-01T00:00:00Z. */
const at = (minutes: number) => new Date(Date.UTC(2025, 1, 1, 0, minutes)).toISOString();

describe('what a pair is', () => {
	it('carries both legs, the normalized asset, and how it was made', () => {
		const r = resolve([out('o', { asset: 'matic', qty: 100 }), inn('i', { asset: 'POL', qty: 99.5, at: at(30), wallet: 'polygon:0xabc' })]);
		expect(r.links).toEqual([
			{ outId: 'o', inId: 'i', asset: 'POL', qtyOut: 100, qtyIn: 99.5, outAt: '2025-02-01T00:00:00Z', inAt: at(30), outWallet: CB, inWallet: 'polygon:0xabc', link: 'heuristic', via: 'arrival_window', ownersDiffer: false },
		]);
		expect(r.unlinkedOut).toEqual([]);
		expect(r.unlinkedIn).toEqual([]);
	});
});

describe('precedence', () => {
	it('a shared hash beats the window and the matcher: the hash partner wins even a day away and a different quantity', () => {
		const r = resolve(
			[out('o', { hash: HASH }), inn('far', { hash: HASH, at: at(24 * 60), qty: 0.7 }), inn('near', { at: at(5) })],
			[match('o', 'near', 'auto', 0.99)],
		);
		expect(pairs(r)).toEqual([['o', 'far', 'hash', 'hash']]);
		expect(r.unlinkedIn).toEqual(['near']);
	});

	it('a hash compares without case or 0x, and across the two spellings the sources use', () => {
		const r = resolve([out('o', { hash: HASH.toUpperCase().replace('0X', '0x') }), inn('i', { hash: HASH.slice(2), at: at(1) })]);
		expect(pairs(r)).toEqual([['o', 'i', 'hash', 'hash']]);
	});

	it('hashes that are not hex (an exchange id, a Solana signature) compare exactly, case included', () => {
		expect(pairs(resolve([out('o', { hash: 'AbC123xyz' }), inn('i', { hash: 'abc123xyz', at: at(60 * 24) })]))).toEqual([]);
		expect(pairs(resolve([out('o', { hash: 'AbC123xyz' }), inn('i', { hash: 'AbC123xyz', at: at(60 * 24) })]))).toEqual([['o', 'i', 'hash', 'hash']]);
	});

	it('a hash pair may share a wallet; a hash link takes the in whose quantity is closest', () => {
		const r = resolve([
			out('o', { hash: HASH, wallet: CB, qty: 1 }),
			inn('a', { hash: HASH, wallet: CB, qty: 0.4, at: at(1) }),
			inn('b', { hash: HASH, wallet: CB, qty: 0.99, at: at(2) }),
		]);
		expect(pairs(r)).toEqual([['o', 'b', 'hash', 'hash']]);
	});

	it('a hash link needs the same asset', () => {
		expect(resolve([out('o', { hash: HASH, asset: 'ETH' }), inn('i', { hash: HASH, asset: 'BTC', at: at(1) })]).links).toEqual([]);
	});

	it('a confirmed match beats a closer suggestion and the window', () => {
		const r = resolve([out('o'), inn('close', { at: at(1) }), inn('chosen', { at: at(120) })], [match('o', 'close', 'auto', 0.99), match('o', 'chosen', 'confirmed')]);
		expect(pairs(r)).toEqual([['o', 'chosen', 'confirmed', 'confirmed_match']]);
	});

	it("an owner's own link (linkedTxId) counts as confirmed and beats a confirmed match, from either end", () => {
		const fromOut = resolve([out('o', { linkedTxId: 'b' }), inn('a', { at: at(1) }), inn('b', { at: at(300) })], [match('o', 'a', 'confirmed')]);
		expect(pairs(fromOut)).toEqual([['o', 'b', 'confirmed', 'manual']]);
		const fromIn = resolve([out('o'), inn('a', { at: at(1) }), inn('b', { at: at(300), linkedTxId: 'o' })], [match('o', 'a', 'confirmed')]);
		expect(pairs(fromIn)).toEqual([['o', 'b', 'confirmed', 'manual']]);
	});

	it('a link by hand makes a row a candidate even when its source labels it nothing, and needs no quantity match', () => {
		const r = resolve([
			out('o', { category: 'sell', qty: 1, linkedTxId: 'i' }),
			inn('i', { category: null, qty: 0.2, at: at(60 * 48) }),
		]);
		expect(pairs(r)).toEqual([['o', 'i', 'confirmed', 'manual']]);
	});

	it('a link by hand to a row that does not exist, or the wrong way round, is ignored', () => {
		expect(resolve([out('o', { linkedTxId: 'ghost' })]).links).toEqual([]);
		expect(resolve([out('o', { linkedTxId: 'o2' }), out('o2')]).links).toEqual([]);
	});

	it('automatic matches beat suggested ones; among equals the more confident wins', () => {
		const rows = [out('o'), inn('a', { at: at(1) }), inn('b', { at: at(2) }), inn('c', { at: at(3) })];
		expect(pairs(resolve(rows, [match('o', 'a', 'suggested', 0.99), match('o', 'b', 'auto', 0.5)]))).toEqual([['o', 'b', 'heuristic', 'auto_match']]);
		expect(pairs(resolve(rows, [match('o', 'a', 'suggested', 0.5), match('o', 'c', 'suggested', 0.8)]))).toEqual([['o', 'c', 'heuristic', 'suggested_match']]);
	});

	it('a matcher suggestion beats the window, and is a guess either way', () => {
		const r = resolve([out('o'), inn('window', { at: at(1) }), inn('suggested', { at: at(200) })], [match('o', 'suggested', 'suggested', 0.6)]);
		expect(pairs(r)).toEqual([['o', 'suggested', 'heuristic', 'suggested_match']]);
	});

	it('a stronger rule takes its rows before a weaker one sees them, even when the weaker rule\'s row is earlier', () => {
		// 'early' would take 'i' by the window, but 'late' shares a hash with it.
		const r = resolve([out('early', { at: at(0) }), out('late', { at: at(10), hash: HASH }), inn('i', { at: at(20), hash: HASH })]);
		expect(pairs(r)).toEqual([['late', 'i', 'hash', 'hash']]);
		expect(r.unlinkedOut).toEqual(['early']);
	});
});

describe('the arrival window: 6 hours after the send, within 1%', () => {
	const one = (inRow: Partial<TransferRow>, outRow: Partial<TransferRow> = {}) => resolve([out('o', outRow), inn('i', inRow)]).links.length === 1;

	it('links an arrival up to 6 hours after, and not past it', () => {
		expect(one({ at: at(0) })).toBe(true);
		expect(one({ at: at(6 * 60) })).toBe(true);
		expect(one({ at: at(6 * 60 + 1) })).toBe(false);
	});

	it('never links an arrival before its own send', () => {
		expect(one({ at: at(-1) })).toBe(false);
	});

	it('the fee band: the arrival may differ from the send by up to 1% of the send', () => {
		expect(one({ qty: 0.995 })).toBe(true);
		expect(one({ qty: 0.99 })).toBe(true); // exactly 1%
		expect(one({ qty: 1.005 })).toBe(true);
		expect(one({ qty: 0.989 })).toBe(false);
		expect(one({ qty: 1.02 })).toBe(false);
		expect(one({ qty: 0.5 })).toBe(false);
	});

	it('the band is 1% at any size: a send under one unit does not take an arrival ten times its size', () => {
		const small = (send: number, arrive: number) => one({ qty: arrive }, { qty: send });
		// The lifecycle rebuild's floor of 0.01 units would link every one of these.
		expect(small(0.001, 0.0109)).toBe(false);
		expect(small(0.1, 0.105)).toBe(false);
		expect(small(0.01, 0.019)).toBe(false);
		expect(small(0.5, 0.51)).toBe(false);
		expect(small(0.5, 0.4975)).toBe(true);
		expect(small(0.001, 0.000995)).toBe(true);
		expect(small(0.001, 0.001005)).toBe(true);
		expect(small(100, 99.2)).toBe(true);
		expect(small(100, 98.5)).toBe(false);
		expect(small(5e-11, 5e-11)).toBe(false); // dust is not a transfer
	});

	it('takes the closest arrival in time, then in quantity', () => {
		const r = resolve([out('o'), inn('far', { at: at(300) }), inn('near', { at: at(20) }), inn('nearer-qty', { at: at(20), qty: 0.999 })]);
		expect(pairs(r)).toEqual([['o', 'near', 'heuristic', 'arrival_window']]);
	});

	it('reads a time stored without a zone as UTC, whatever the machine\'s zone', () => {
		const r = resolve([out('o', { at: '2025-02-01 00:00:00' }), inn('i', { at: '2025-02-01 05:59:00' }), inn('late', { at: '2025-02-01 06:01:00' })]);
		expect(pairs(r)).toEqual([['o', 'i', 'heuristic', 'arrival_window']]);
	});
});

describe('which pairs are allowed', () => {
	it('same normalized asset only: MATIC is POL, BTC is not WBTC', () => {
		expect(resolve([out('o', { asset: 'matic' }), inn('i', { asset: 'POL', at: at(1) })]).links).toHaveLength(1);
		expect(resolve([out('o', { asset: 'BTC' }), inn('i', { asset: 'WBTC', at: at(1) })]).links).toEqual([]);
		expect(resolve([out('o', { asset: 'eth' }), inn('i', { asset: 'ETH', at: at(1) })]).links).toHaveLength(1);
	});

	it('an out pairs with an in, never with another out', () => {
		expect(resolve([out('a'), out('b', { at: at(1), wallet: KR })]).links).toEqual([]);
		expect(resolve([inn('a', { wallet: CB }), inn('b', { at: at(1) })]).links).toEqual([]);
	});

	it('different wallet keys, except by hash and the Crypto.com internal kinds', () => {
		const same = { wallet: CB };
		expect(resolve([out('o', same), inn('i', { ...same, at: at(1) })]).links).toEqual([]);
		expect(resolve([out('o', same), inn('i', { ...same, at: at(1) })], [match('o', 'i', 'confirmed')]).links).toEqual([]);
		expect(pairs(resolve([out('o', { ...same, hash: HASH }), inn('i', { ...same, at: at(1), hash: HASH })]))).toEqual([['o', 'i', 'hash', 'hash']]);
		const internal = resolve([out('o', { ...same, kind: 'crypto_to_exchange_transfer', category: null }), inn('i', { ...same, at: at(1), kind: 'exchange_to_crypto_transfer', category: null })]);
		expect(pairs(internal)).toEqual([['o', 'i', 'heuristic', 'arrival_window']]);
		// One internal kind is not enough.
		expect(resolve([out('o', { ...same, kind: 'crypto_to_exchange_transfer' }), inn('i', { ...same, at: at(1) })]).links).toEqual([]);
	});

	it('a rejected pair is never linked, by any rule', () => {
		const rejected = [match('o', 'i', 'rejected')];
		expect(resolve([out('o'), inn('i', { at: at(1) })], rejected).links).toEqual([]);
		expect(resolve([out('o', { hash: HASH }), inn('i', { at: at(1), hash: HASH })], rejected).links).toEqual([]);
		expect(resolve([out('o', { linkedTxId: 'i' }), inn('i', { at: at(1) })], rejected).links).toEqual([]);
		expect(resolve([out('o'), inn('i', { at: at(1) })], [match('o', 'i', 'confirmed'), ...rejected]).links).toEqual([]);
		// The other way round is the same pair.
		expect(resolve([out('o'), inn('i', { at: at(1) })], [match('i', 'o', 'rejected')]).links).toEqual([]);
	});

	it('rejecting one pair leaves the rows free for others', () => {
		const r = resolve([out('o'), inn('i1', { at: at(1) }), inn('i2', { at: at(2) })], [match('o', 'i1', 'rejected')]);
		expect(pairs(r)).toEqual([['o', 'i2', 'heuristic', 'arrival_window']]);
		expect(r.unlinkedIn).toEqual(['i1']);
	});

	it('a match naming a row that is not here is ignored', () => {
		expect(resolve([out('o'), inn('i', { at: at(600) })], [match('o', 'ghost', 'confirmed'), match('ghost', 'i', 'auto')]).links).toEqual([]);
	});
});

describe('one link per row, taken in (time, id) order', () => {
	it('two sends and one arrival: the earlier send gets it', () => {
		const r = resolve([out('b', { at: at(10) }), out('a', { at: at(0) }), inn('i', { at: at(20) })]);
		expect(pairs(r)).toEqual([['a', 'i', 'heuristic', 'arrival_window']]);
		expect(r.unlinkedOut).toEqual(['b']);
	});

	it('equal times go by id', () => {
		const r = resolve([out('b'), out('a'), inn('i', { at: at(5) })]);
		expect(pairs(r)).toEqual([['a', 'i', 'heuristic', 'arrival_window']]);
	});

	it('one send and two arrivals: the closest, and the other is left unlinked', () => {
		const r = resolve([out('o'), inn('i1', { at: at(40) }), inn('i2', { at: at(10) })]);
		expect(pairs(r)).toEqual([['o', 'i2', 'heuristic', 'arrival_window']]);
		expect(r.unlinkedIn).toEqual(['i1']);
	});

	it('several sends and arrivals pair off one to one', () => {
		const r = resolve([out('o1'), out('o2', { at: at(30), qty: 2 }), inn('i1', { at: at(10) }), inn('i2', { at: at(40), qty: 2 })]);
		expect(pairs(r)).toEqual([['o1', 'i1', 'heuristic', 'arrival_window'], ['o2', 'i2', 'heuristic', 'arrival_window']]);
	});

	it('a repeated row id keeps its first row', () => {
		const r = resolve([out('o'), inn('i', { at: at(5) }), inn('i', { at: at(1) })]);
		expect(r.links).toHaveLength(1);
		expect(r.unlinkedIn).toEqual([]);
	});

	it('links come out by the time of the send, then id', () => {
		const r = resolve([out('late', { at: at(60) }), out('early', { at: at(0), asset: 'ETH' }), inn('i1', { at: at(65) }), inn('i2', { at: at(5), asset: 'ETH' })]);
		expect(r.links.map((l) => l.outId)).toEqual(['early', 'late']);
	});
});

describe('which rows are candidates at all', () => {
	it('an import row is a leg only if pass 1 called it a transfer', () => {
		const r = resolve([out('o', { category: 'sell' }), inn('i', { category: 'buy', at: at(1) }), out('t'), inn('u', { at: at(1) })]);
		expect(pairs(r)).toEqual([['t', 'u', 'heuristic', 'arrival_window']]);
		expect(r.unlinkedOut).toEqual([]);
		expect(r.unlinkedIn).toEqual([]);
	});

	it('a chain-synced send or receive is always a leg', () => {
		const r = resolve([out('o', { source: 'chain_sync', category: null, wallet: 'bitcoin:bc1a' }), inn('i', { source: 'chain_sync', category: null, wallet: 'bitcoin:bc1b', at: at(5) })]);
		expect(pairs(r)).toEqual([['o', 'i', 'heuristic', 'arrival_window']]);
	});

	it('an on-chain row is a leg only if it touches a tracked address', () => {
		const A = '0x' + 'a1'.repeat(20);
		const B = '0x' + 'b2'.repeat(20);
		const C = '0x' + 'c3'.repeat(20);
		const owned = buildOwnedIndex([A, B]);
		const onchain = (id: string, direction: 'in' | 'out', from: string, to: string, minutes: number) =>
			row({ id, direction, source: 'onchain', category: null, wallet: `ethereum:${direction === 'out' ? from : to}`, fromAddress: from, toAddress: to, at: at(minutes) });
		// A sends to B (both tracked): linked. A swap router's rows touch none: not candidates.
		const r = resolve([onchain('o', 'out', A, B, 0), onchain('i', 'in', A, B.toUpperCase().replace('0X', '0x'), 5), onchain('x', 'out', C, C, 1), onchain('y', 'in', C, C, 2)], [], owned);
		expect(pairs(r)).toEqual([['o', 'i', 'heuristic', 'arrival_window']]);
		expect([...r.unlinkedOut, ...r.unlinkedIn]).toEqual([]);
		// With no address index, no on-chain row is a candidate.
		expect(resolve([onchain('o', 'out', A, B, 0), onchain('i', 'in', A, B, 5)]).links).toEqual([]);
	});

	it('a self-send\'s two legs share a hash, so they link even in one wallet', () => {
		const A = '0x' + 'a1'.repeat(20);
		const owned = buildOwnedIndex([A]);
		const legs = [
			row({ id: 'tx:out', direction: 'out', source: 'onchain', category: null, wallet: `ethereum:${A}`, hash: HASH, fromAddress: A, toAddress: A }),
			row({ id: 'tx:in', direction: 'in', source: 'onchain', category: null, wallet: `ethereum:${A}`, hash: HASH, fromAddress: A, toAddress: A }),
		];
		expect(pairs(resolve(legs, [], owned))).toEqual([['tx:out', 'tx:in', 'hash', 'hash']]);
	});

	it('the unlinked lists hold candidates only, in time order', () => {
		const r = resolve([out('b', { at: at(60) }), out('a', { at: at(0), asset: 'ETH' }), inn('z', { at: at(600) }), out('skip', { category: 'sell' })]);
		expect(r.links).toEqual([]);
		expect(r.unlinkedOut).toEqual(['a', 'b']);
		expect(r.unlinkedIn).toEqual(['z']);
	});

	it('a row the resolver cannot read is listed, and never paired', () => {
		const r = resolve([
			out('bad-date', { at: 'sometime' }),
			out('zero', { qty: 0 }),
			out('no-asset', { asset: ' ' }),
			out('good'),
			inn('i', { at: at(1) }),
			inn('nan', { qty: Number.NaN, at: at(2) }),
		]);
		expect(pairs(r)).toEqual([['good', 'i', 'heuristic', 'arrival_window']]);
		expect(r.unlinkedOut).toEqual(['no-asset', 'zero', 'bad-date']);
		expect(r.unlinkedIn).toEqual(['nan']);
	});
});

describe('owners', () => {
	const owners = (entries: [string, string][], byAddress: [string, string][] = []): OwnerIndex => ({ byKey: new Map(entries), byAddress: new Map(byAddress) });
	const link = (index: OwnerIndex, outWallet = CB, inWallet = KR) => resolve([out('o', { wallet: outWallet }), inn('i', { wallet: inWallet, at: at(1) })], [], new Set(), index).links[0];

	it('is true only when both wallets have an owner label and the labels differ', () => {
		expect(link(owners([[CB, 'Me'], [KR, 'Spouse']])).ownersDiffer).toBe(true);
		expect(link(owners([[CB, 'Me'], [KR, 'Me']])).ownersDiffer).toBe(false);
		expect(link(owners([[CB, 'Me']])).ownersDiffer).toBe(false);
		expect(link(owners([[KR, 'Spouse']])).ownersDiffer).toBe(false);
		expect(link(owners([])).ownersDiffer).toBe(false);
	});

	it('compares after NFC normalization and case-folding', () => {
		expect(link(owners([[CB, 'José'], [KR, 'José']])).ownersDiffer).toBe(false);
		expect(link(owners([[CB, 'Ana'], [KR, 'ANA']])).ownersDiffer).toBe(false);
		expect(link(owners([[CB, ' Ana '], [KR, 'ana']])).ownersDiffer).toBe(false);
		expect(link(owners([[CB, 'Stra\u00dfe'], [KR, 'STRASSE']])).ownersDiffer).toBe(false);
		expect(link(owners([[CB, 'Ana'], [KR, 'Anna']])).ownersDiffer).toBe(true);
	});

	it('an on-chain wallet takes the owner saved on any key of its address', () => {
		const EVM = '0x' + 'a1'.repeat(20);
		const index = owners([[CB, 'Me']], [[EVM, 'Spouse']]);
		expect(link(index, CB, `polygon:${EVM.toUpperCase().replace('0X', '0x')}`).ownersDiffer).toBe(true);
		expect(ownersDiffer(index, CB, `ethereum:${EVM}`)).toBe(true);
		expect(ownersDiffer(index, `ethereum:${EVM}`, `avalanche:${EVM}`)).toBe(false);
		expect(ownersDiffer(index, CB, 'cex:kraken:unlabelled')).toBe(false);
	});

	it('works on the owner index the app builds from wallet_identity', () => {
		const EVM = '0x' + 'a1'.repeat(20);
		const index = buildOwnerIndex([
			{ walletKey: CB, ownerLabel: 'Me' },
			{ walletKey: `ethereum:${EVM}`, ownerLabel: 'Spouse' },
			{ walletKey: KR, ownerLabel: null },
		]);
		expect(ownersDiffer(index, CB, `polygon:${EVM}`)).toBe(true);
		expect(ownersDiffer(index, CB, KR)).toBe(false);
	});

	it('is carried on every kind of link', () => {
		const index = owners([[CB, 'Me'], [KR, 'Spouse']]);
		expect(resolve([out('o', { hash: HASH }), inn('i', { hash: HASH, at: at(1) })], [], new Set(), index).links[0]).toMatchObject({ link: 'hash', ownersDiffer: true });
		expect(resolve([out('o'), inn('i', { at: at(1) })], [match('o', 'i', 'confirmed')], new Set(), index).links[0]).toMatchObject({ link: 'confirmed', ownersDiffer: true });
	});
});

describe('determinism', () => {
	function rng(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	const shuffle = <T>(xs: readonly T[], seed: number): T[] => {
		const rand = rng(seed);
		const a = [...xs];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	// A busy day: ties on time, rows competing for the same arrival, each rule in play.
	const rows: TransferRow[] = [
		out('o1', { at: at(0) }),
		out('o2', { at: at(0) }),
		out('o3', { at: at(0), qty: 2 }),
		out('o4', { at: at(15), hash: HASH, wallet: 'bitcoin:bc1a' }),
		out('o5', { at: at(20), asset: 'ETH', qty: 3 }),
		out('o6', { at: at(25), linkedTxId: 'i6' }),
		inn('i1', { at: at(10) }),
		inn('i2', { at: at(10) }),
		inn('i3', { at: at(10), qty: 2 }),
		inn('i4', { at: at(30), hash: HASH, wallet: 'bitcoin:bc1b' }),
		inn('i5', { at: at(40), asset: 'ETH', qty: 2.99 }),
		inn('i6', { at: at(500) }),
		inn('i7', { at: at(12) }),
	];
	const matches = [match('o1', 'i7', 'suggested', 0.7), match('o2', 'i2', 'auto', 0.9), match('o3', 'i3', 'rejected'), match('o5', 'i5', 'confirmed')];

	it('the same rows in any order give the same links, in the same order', () => {
		const expected = JSON.stringify(resolve(rows, matches));
		for (let seed = 1; seed <= 40; seed++) {
			expect(JSON.stringify(resolve(shuffle(rows, seed), shuffle(matches, seed + 100))), `seed ${seed}`).toBe(expected);
		}
	});

	it('the busy day resolves as the rules say', () => {
		const r = resolve(rows, matches);
		expect(pairs(r)).toEqual([
			// A suggestion from the matcher takes i7 before the window could offer o1 the closer i1.
			['o1', 'i7', 'heuristic', 'suggested_match'],
			['o2', 'i2', 'heuristic', 'auto_match'],
			['o4', 'i4', 'hash', 'hash'],
			['o5', 'i5', 'confirmed', 'confirmed_match'],
			['o6', 'i6', 'confirmed', 'manual'],
		]);
		// o3's only same-size arrival was rejected, so it takes nothing.
		expect(r.unlinkedOut).toEqual(['o3']);
		expect(r.unlinkedIn).toEqual(['i1', 'i3']);
	});
});
