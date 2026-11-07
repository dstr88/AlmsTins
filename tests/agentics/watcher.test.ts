import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import {
  COPYCAT_USDC, USDC_ETHEREUM, blockAtOrBefore, blockIso, blockTime, createFakeExplorer, internalRow, nativeRow, tokenRow, units, type FakeExplorer,
} from '../helpers/fakeExplorer';

/**
 * The watcher, end to end over the in-memory database and a fake block explorer: verify the
 * address first, then watch what the agent's own wallet does. Since slice 8 ("every outflow") the
 * suite is about what IS kept: every direct transfer of the wallet, in both directions, each marked
 * with what the registry said about the other side when it was written, the unmatched line (an
 * outflow to an address not on the list with no check before it), the contract label, and the
 * per-wallet cursor with its one-time transition from the per-pair cursors. And still: nothing
 * before the wallet was registered, nothing twice, and no cursor moved past anything that was not
 * read. Every address, hash and amount is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

const A = 'tenant-a';
const B = 'tenant-b';
const WALLET = addr(1);
const D1 = addr(11); // trusted, the main counterparty
const D2 = addr(12); // trusted, registered later
const D3 = addr(13); // flagged
const D4 = addr(14); // pending
const D5 = addr(15); // trusted, but on Polygon
const D6 = addr(16); // trusted, then removed
const STRANGER = addr(99); // never registered
const ROUTER = addr(77); // a contract the wallet pays through

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let watcher: typeof import('../../src/lib/agentVault/watcher');
let state: typeof import('../../src/lib/agentVault/watchState');
let vault: typeof import('../../src/lib/agentVault/vault');

let explorer: FakeExplorer;
let nowMs: number;
let prices: Record<string, number | null>;
const priceCalls: string[] = [];

/** The clock at which the newest confirmed block is `block` (Ethereum reads blocks 180 seconds old and more). */
const clockAt = (block: number) => (nowMs = (blockTime(block) + 180) * 1000);
const stored = (block: number) => blockIso(block).slice(0, 19).replace('T', ' ');
const at = (block: number, plusSec = 0) => new Date((blockTime(block) + plusSec) * 1000).toISOString();

const deps = (over: Record<string, unknown> = {}) =>
  ({
    explorer,
    pricing: { unitPriceUsd: async (coin: string, day: string) => { priceCalls.push(`${coin}|${day}`); return prices[coin] ?? null; } },
    now: () => nowMs,
    ...over,
  }) as import('../../src/lib/agentVault/watcher').WatchDeps;

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  explorer = createFakeExplorer();
  prices = { ethereum: 2000 };
  priceCalls.length = 0;
  clockAt(20_000);
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  watcher = await import('../../src/lib/agentVault/watcher');
  state = await import('../../src/lib/agentVault/watchState');
  vault = await import('../../src/lib/agentVault/vault');
});

// ── The registry ─────────────────────────────────────────────────────────────

const setTrust = (id: string, status: 'trusted' | 'flagged' | 'pending') => {
  fake.rows('agent_destinations').find((r) => r.id === id)!.trust_status = status;
};

async function makeTin(tenant = A, label = 'Agent', registeredAt = 0) {
  return store.insertTin(tenant, { label, agentKeyId: null, at: stored(registeredAt) });
}
async function makeWallet(tenant: string, tinId: string, address = WALLET, registeredAt = 0, chain: 'ethereum' | 'polygon' | 'avalanche' = 'ethereum') {
  const r = await store.insertWallet(tenant, { tinId, chain, address, at: stored(registeredAt) });
  return r.wallet;
}
async function makeDestination(
  tenant: string, tinId: string, address: string, status: 'trusted' | 'flagged' | 'pending' = 'trusted', registeredAt = 1000,
  chain: 'ethereum' | 'polygon' | 'avalanche' = 'ethereum',
) {
  const r = await store.insertDestination(tenant, { tinId, chain, address, label: null, at: stored(registeredAt) });
  if (r.kind !== 'inserted') throw new Error('duplicate destination in a test');
  setTrust(r.destination.id, status);
  return r.destination;
}

/** A tin with one Ethereum wallet and destinations of every kind. */
async function world() {
  const tin = await makeTin();
  const wallet = await makeWallet(A, tin.id);
  const d1 = await makeDestination(A, tin.id, D1, 'trusted', 1000);
  const d2 = await makeDestination(A, tin.id, D2, 'trusted', 1800);
  const d3 = await makeDestination(A, tin.id, D3, 'flagged', 1000);
  const d4 = await makeDestination(A, tin.id, D4, 'pending', 1000);
  const d5 = await makeDestination(A, tin.id, D5, 'trusted', 1001, 'polygon');
  const d6 = await makeDestination(A, tin.id, D6, 'trusted', 1000);
  await store.softDeleteDestination(A, d6.id, stored(1500));
  return { tin, wallet, d1, d2, d3, d4, d5, d6 };
}

const USDC = (n: number, hash: number, block: number, from: string, to: string, amount: string, contract = USDC_ETHEREUM) =>
  tokenRow({ hash, block, from, to, value: units(amount, 6), contract, symbol: 'USDC', decimals: 6 });

/**
 * Rows on the chain for the world above. Every direct transfer with the wallet on one side is now
 * kept; the comments say what each one's other side is to the registry, and what is still dropped.
 */
function stockExplorer() {
  const x = explorer;
  x.add('ethereum', WALLET, 'txlist',
    nativeRow({ hash: 1, block: 1500, from: WALLET, to: D1, value: units('1.5') }),     // trusted, out
    nativeRow({ hash: 2, block: 1600, from: WALLET, to: STRANGER, value: units('9') }), // not on the list, out, no check: the unmatched line
    nativeRow({ hash: 3, block: 999, from: WALLET, to: D1, value: units('3') }),        // before D1 was registered; D1 is trusted when it is written
    nativeRow({ hash: 4, block: 1700, from: WALLET, to: D1, value: units('1'), failed: true }), // failed: not a movement
    nativeRow({ hash: 5, block: 1710, from: WALLET, to: D1, value: '0' }),              // zero: not a movement
    nativeRow({ hash: 6, block: 1720, from: WALLET, to: WALLET, value: units('1') }),   // to itself: not a movement
    nativeRow({ hash: 7, block: 1800, from: WALLET, to: D3, value: units('2') }),       // flagged destination
    nativeRow({ hash: 8, block: 1810, from: WALLET, to: D4, value: units('2') }),       // pending destination
    nativeRow({ hash: 9, block: 1820, from: WALLET, to: D5, value: units('2') }),       // registered on Polygon only: not on the list here
    nativeRow({ hash: 10, block: 1830, from: WALLET, to: D6, value: units('2') }),      // removed destination: not on the list
    nativeRow({ hash: 11, block: 1200, from: WALLET, to: D2, value: units('2') }),      // before D2 was registered; D2 is trusted when it is written
    nativeRow({ hash: 12, block: 19_800, from: WALLET, to: D1, value: units('0.1') }),  // recent, inside the next pass's overlap
  );
  x.add('ethereum', WALLET, 'tokentx',
    USDC(0, 20, 1900, WALLET, D1, '250'),
    USDC(0, 21, 1950, D2, WALLET, '100'),
    USDC(0, 22, 1960, WALLET, D1, '40', COPYCAT_USDC),
    USDC(0, 23, 2000, WALLET, D2, '5'),
    USDC(0, 23, 2000, WALLET, D2, '5'),
  );
  x.add('ethereum', WALLET, 'txlistinternal', internalRow({ hash: 30, block: 2100, from: D2, to: WALLET, value: units('0.2') }));
}

/** How many movements stockExplorer holds, and how many of them have an address not on the list on the other side. */
const STOCK_TRANSFERS = 15;
const STOCK_UNREGISTERED = 3; // the stranger, the Polygon-only address and the removed destination

const check = (tenant: string, tinId: string, address: string, atIso: string, answer: 'proven' | 'consistent-with-history' | 'flagged' | 'unknown', status = 'unknown', registry: 'trusted' | 'none' = 'trusted') =>
  events.insertCheckedEvent(tenant, { tinId, address, chain: 'ethereum', answer, registry, status, keyId: 'a1'.repeat(12), sourceIp: null, detail: {}, at: atIso });

const ledger = (tenant = A) =>
  fake.rows('agent_events').filter((r) => r.kind === 'transaction' && r.tenant_id === tenant)
    .sort((a, b) => a.block_number - b.block_number || String(a.detail_json).localeCompare(String(b.detail_json)));
const compact = (rows = ledger()) => rows.map((r) => ({
  block: r.block_number, dir: r.direction, who: r.address, amount: r.amount, asset: r.asset, usd: r.usd_value, answer: r.answer, reg: r.registry,
}));
const detailOf = (row: any) => JSON.parse(row.detail_json);
const walletCursors = () => fake.rows('agent_wallet_cursors') ?? [];
const pairCursors = () => fake.rows('agent_watch_cursors') ?? [];

// ── Verify, then watch ───────────────────────────────────────────────────────

describe('a pass records every direct transfer of the agent\'s wallet, with the other side as the registry stood', () => {
  it('records every movement that counts, with its facts and the registry\'s word on the other side', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());

    expect(compact()).toEqual([
      { block: 999, dir: 'out', who: D1, amount: '3', asset: 'ETH', usd: 6000, answer: 'unknown', reg: 'trusted' },
      { block: 1200, dir: 'out', who: D2, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'trusted' },
      { block: 1500, dir: 'out', who: D1, amount: '1.5', asset: 'ETH', usd: 3000, answer: 'unknown', reg: 'trusted' },
      { block: 1600, dir: 'out', who: STRANGER, amount: '9', asset: 'ETH', usd: 18_000, answer: 'unknown', reg: 'none' },
      { block: 1800, dir: 'out', who: D3, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'flagged' },
      { block: 1810, dir: 'out', who: D4, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'pending' },
      { block: 1820, dir: 'out', who: D5, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'none' },
      { block: 1830, dir: 'out', who: D6, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'none' },
      { block: 1900, dir: 'out', who: D1, amount: '250', asset: 'USDC', usd: 250, answer: 'unknown', reg: 'trusted' },
      { block: 1950, dir: 'in', who: D2, amount: '100', asset: 'USDC', usd: 100, answer: 'unknown', reg: 'trusted' },
      { block: 1960, dir: 'out', who: D1, amount: '40', asset: 'USDC', usd: null, answer: 'unknown', reg: 'trusted' },
      { block: 2000, dir: 'out', who: D2, amount: '5', asset: 'USDC', usd: 5, answer: 'unknown', reg: 'trusted' },
      { block: 2000, dir: 'out', who: D2, amount: '5', asset: 'USDC', usd: 5, answer: 'unknown', reg: 'trusted' },
      { block: 2100, dir: 'in', who: D2, amount: '0.2', asset: 'ETH', usd: 400, answer: 'unknown', reg: 'trusted' },
      { block: 19_800, dir: 'out', who: D1, amount: '0.1', asset: 'ETH', usd: 200, answer: 'unknown', reg: 'trusted' },
    ]);
    expect(report.recorded).toBe(STOCK_TRANSFERS);
    expect(report.wallets).toHaveLength(1);
    expect(report.wallets[0]).toMatchObject({
      chain: 'ethereum', address: WALLET, status: 'complete', reason: null, destinations: 4, transfers: STOCK_TRANSFERS, recorded: STOCK_TRANSFERS,
      alreadyRecorded: 0, pricePending: 0, unregistered: STOCK_UNREGISTERED, unmatched: STOCK_UNREGISTERED,
    });
    expect(report.registered).toEqual({ trusted: 3, pending: 1, flagged: 1 });
    expect(report).toMatchObject({ unregistered: STOCK_UNREGISTERED, unmatched: STOCK_UNREGISTERED });
  });

  it('writes each event with the other side as its address, the chain, the block\'s time, the wallet, the hash and the registry\'s word at writing', async () => {
    await (async () => { const w = await world(); stockExplorer(); await watcher.runTinPass(A, w.tin, deps()); })();
    const first = ledger().find((r) => r.block_number === 1500)!;
    expect(first).toMatchObject({
      tenant_id: A, kind: 'transaction', address: D1, chain: 'ethereum', registry: 'trusted', key_id: null, source_ip: null,
      wallet: WALLET, asset_contract: null, occurred_at: at(1500),
    });
    expect(first.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(detailOf(first)).toMatchObject({
      source: 'txlist', link: null, reason: 'no_preceding_check', price: { basis: 'daily_price', unitUsd: 2000 },
      counterparty: 'trusted', unmatched: false, contract: null,
      destinationRegisteredAt: stored(1000), destinationCheckedAt: null, walletId: expect.any(String), destinationId: expect.any(String),
    });
  });

  it('a transfer to an address not on the list is written with registry none, the mark unregistered, and no destination facts', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const stranger = ledger().find((r) => r.address === STRANGER)!;
    expect(stranger).toMatchObject({ registry: 'none', direction: 'out', answer: 'unknown', chain: 'ethereum', wallet: WALLET });
    expect(detailOf(stranger)).toMatchObject({ counterparty: 'unregistered', unmatched: true, destinationId: null, destinationRegisteredAt: null, destinationCheckedAt: null, reason: 'no_preceding_check' });
  });

  it('a flagged, a pending, a removed and an other-chain destination each get the word the registry has for them now', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const word = (address: string) => ({ registry: ledger().find((r) => r.address === address)!.registry, counterparty: detailOf(ledger().find((r) => r.address === address)!).counterparty });
    expect(word(D3)).toEqual({ registry: 'flagged', counterparty: 'flagged' });
    expect(word(D4)).toEqual({ registry: 'pending', counterparty: 'pending' });
    expect(word(D6)).toEqual({ registry: 'none', counterparty: 'unregistered' }); // removed from the list
    expect(word(D5)).toEqual({ registry: 'none', counterparty: 'unregistered' }); // registered on Polygon, paid on Ethereum
  });

  it('reads the tokens and the coin moved by contracts, not only plain payments', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    expect(new Set(ledger().map((r) => detailOf(r).source))).toEqual(new Set(['txlist', 'tokentx', 'txlistinternal']));
  });

  it('a token on a contract that is not the known one is recorded (the movement happened) but has no USD value', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const copycat = ledger().find((r) => r.block_number === 1960)!;
    expect(copycat).toMatchObject({ asset: 'USDC', asset_contract: COPYCAT_USDC, usd_value: null });
    expect(detailOf(copycat).price).toEqual({ basis: null, reason: 'unknown_token' });
  });

  it('two identical transfers in one transaction are two events', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const twins = ledger().filter((r) => r.block_number === 2000);
    expect(twins).toHaveLength(2);
    expect(twins[0].id).not.toBe(twins[1].id);
    expect(twins[0].tx_hash).toBe(twins[1].tx_hash);
  });

  it('the pass writes only the ledger and the wallet cursors; the pair cursors of before slice 8 are never written', async () => {
    const w = await world();
    stockExplorer();
    // The tables exist before the snapshot, so creating an empty one does not count as writing it.
    await state.ensureAgentWatchTables();
    await events.ensureAgentEventsTable();
    const before = new Map([...fake.tables].map(([t, rows]) => [t, JSON.stringify(rows)]));
    await watcher.runTinPass(A, w.tin, deps());
    const changed = [...fake.tables].filter(([t, rows]) => before.get(t) !== JSON.stringify(rows)).map(([t]) => t).sort();
    expect(changed).toEqual(['agent_events', 'agent_wallet_cursors']);
    expect(pairCursors()).toEqual([]);
  });

  it('the report is numbers and codes: no address of the other side, and the keys the design names', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(JSON.stringify(report)).not.toContain(STRANGER);
    expect(Object.keys(report.wallets[0]).sort()).toEqual([
      'address', 'alreadyRecorded', 'chain', 'destinations', 'pricePending', 'reason', 'recorded', 'status', 'throughAt', 'transfers', 'unmatched', 'unregistered', 'walletId',
    ]);
    expect(Object.keys(report).sort()).toEqual(['recorded', 'registered', 'startedAt', 'tinId', 'unmatched', 'unregistered', 'wallets']);
  });
});

// ── The registry verdict is the one at writing ───────────────────────────────

describe('the registry\'s word on a row is the one at writing, never revised', () => {
  it('a destination that turns flagged: the rows already written keep trusted, a new transfer is written flagged', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const before = ledger().filter((r) => r.address === D1).map((r) => r.registry);
    expect(new Set(before)).toEqual(new Set(['trusted']));
    setTrust(w.d1.id, 'flagged');
    clockAt(21_000);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 40, block: 20_900, from: WALLET, to: D1, value: units('1') }));
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.registered).toEqual({ trusted: 2, pending: 1, flagged: 2 });
    expect(ledger().filter((r) => r.address === D1 && r.block_number < 20_900).map((r) => r.registry)).toEqual(before);
    expect(ledger().find((r) => r.block_number === 20_900)).toMatchObject({ registry: 'flagged' });
    expect(detailOf(ledger().find((r) => r.block_number === 20_900)!)).toMatchObject({ counterparty: 'flagged', unmatched: false });
  });

  it('an address registered after its transfers were recorded: the old rows keep "none", a new transfer is written trusted, and the wallet is not read again from the start', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().find((r) => r.address === STRANGER)).toMatchObject({ registry: 'none' });
    await makeDestination(A, w.tin.id, STRANGER, 'trusted', 19_000);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 61, block: 20_900, from: WALLET, to: STRANGER, value: units('1') }));
    clockAt(21_000);
    explorer.calls.length = 0;
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().filter((r) => r.address === STRANGER).map((r) => [r.block_number, r.registry])).toEqual([[1600, 'none'], [20_900, 'trusted']]);
    // The read started at the wallet's cursor, not at the new destination's registration and not at the beginning.
    expect(explorer.pages()[0].startBlock).toBe(blockAtOrBefore(blockTime(20_000) - 3600));
  });

  it('a transfer before the destination was registered is recorded, with the word the registry has when it is written', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    // D2 was registered at block 1800; its movement at block 1200 is recorded, trusted, with the registration time beside it.
    const early = ledger().find((r) => r.address === D2 && r.block_number === 1200)!;
    expect(early).toMatchObject({ registry: 'trusted' });
    expect(detailOf(early)).toMatchObject({ destinationRegisteredAt: stored(1800) });
  });
});

// ── The unmatched line ───────────────────────────────────────────────────────

describe('the unmatched line: an outflow to an address not on the list with no check before it', () => {
  it('is marked, and counted, on the stock world', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());
    const unmatched = ledger().filter((r) => detailOf(r).unmatched === true).map((r) => r.address).sort();
    expect(unmatched).toEqual([STRANGER, D5, D6].sort());
    expect(report.unmatched).toBe(3);
  });

  it('an outflow to an unregistered address the agent asked about first is not unmatched: the check stands behind it, even answered unknown', async () => {
    const w = await world();
    stockExplorer();
    const asked = await check(A, w.tin.id, STRANGER, at(1600, -20), 'unknown', 'unknown', 'none');
    const report = await watcher.runTinPass(A, w.tin, deps());
    const row = ledger().find((r) => r.address === STRANGER)!;
    expect(row).toMatchObject({ registry: 'none', answer: 'unknown' });
    expect(detailOf(row)).toMatchObject({ counterparty: 'unregistered', unmatched: false, link: { eventId: asked.id } });
    expect(report.unmatched).toBe(2);
    expect(report.unregistered).toBe(3);
  });

  it('a transfer IN from an address not on the list is not unmatched, and an outflow to a registered address never is', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D3, 'flagged', 1000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 2000, from: STRANGER, to: WALLET, value: units('1') }),
      nativeRow({ hash: 2, block: 2001, from: WALLET, to: D3, value: units('1') }));
    const report = await watcher.runTinPass(A, tin, deps());
    expect(ledger().map((r) => [r.direction, r.registry, detailOf(r).unmatched])).toEqual([['in', 'none', false], ['out', 'flagged', false]]);
    expect(report).toMatchObject({ unregistered: 1, unmatched: 0 });
  });

  it('a check about the address answered after the funds moved does not take the mark away', async () => {
    const w = await world();
    stockExplorer();
    await check(A, w.tin.id, STRANGER, at(1600, 30), 'unknown', 'unknown', 'none');
    await watcher.runTinPass(A, w.tin, deps());
    expect(detailOf(ledger().find((r) => r.address === STRANGER)!)).toMatchObject({ unmatched: true, reason: 'no_preceding_check' });
  });
});

// ── Contracts ────────────────────────────────────────────────────────────────

describe('a payment routed through a contract is a transfer to the contract, labeled as such', () => {
  it('a txlist row with call data, and every internal row, say the other side is a contract; a plain transfer says it is not; a token row cannot say', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist',
      { ...nativeRow({ hash: 1, block: 2000, from: WALLET, to: ROUTER, value: units('1') }), input: '0x38ed173900000000000000000000000000000000000000000000000000000000' },
      { ...nativeRow({ hash: 2, block: 2001, from: WALLET, to: D1, value: units('1') }), input: '0x' });
    explorer.add('ethereum', WALLET, 'txlistinternal', internalRow({ hash: 3, block: 2002, from: ROUTER, to: WALLET, value: units('0.5') }));
    explorer.add('ethereum', WALLET, 'tokentx', USDC(0, 4, 2003, WALLET, ROUTER, '10'));
    await watcher.runTinPass(A, tin, deps());
    const by = (block: number) => ledger().find((r) => r.block_number === block)!;
    expect(by(2000)).toMatchObject({ address: ROUTER, registry: 'none', direction: 'out' });
    expect(detailOf(by(2000))).toMatchObject({ contract: true, counterparty: 'unregistered', unmatched: true });
    expect(detailOf(by(2001))).toMatchObject({ contract: false, counterparty: 'trusted' });
    expect(detailOf(by(2002))).toMatchObject({ contract: true, counterparty: 'unregistered', unmatched: false }); // coin came in from the contract
    expect(detailOf(by(2003))).toMatchObject({ contract: null, counterparty: 'unregistered', unmatched: true });
  });

  it('a registered contract address is a registered destination like any other', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, ROUTER, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist', { ...nativeRow({ hash: 1, block: 2000, from: WALLET, to: ROUTER, value: units('1') }), input: '0xabcdef' });
    await watcher.runTinPass(A, tin, deps());
    expect(ledger()[0]).toMatchObject({ address: ROUTER, registry: 'trusted' });
    expect(detailOf(ledger()[0])).toMatchObject({ contract: true, counterparty: 'trusted', unmatched: false });
  });
});

// ── The wallet's history begins at its registration ──────────────────────────

describe('a wallet\'s history begins when it was registered', () => {
  it('a movement before the wallet was registered is not recorded', async () => {
    const tin = await makeTin();
    const wallet = await makeWallet(A, tin.id, WALLET, 3000); // registered after the destination
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 2000, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 2, block: 2500, from: WALLET, to: STRANGER, value: units('1') }),
      nativeRow({ hash: 3, block: 3500, from: WALLET, to: D1, value: units('2') }));
    await watcher.runTinPass(A, tin, deps());
    expect(compact()).toEqual([{ block: 3500, dir: 'out', who: D1, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown', reg: 'trusted' }]);
    expect(wallet.createdAt).toBe(stored(3000));
  });

  it('a wallet removed and added again does not pick up what happened in between', async () => {
    const tin = await makeTin();
    const first = await makeWallet(A, tin.id, WALLET, 0);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    await store.softDeleteWallet(A, first.id, stored(4000));
    await makeWallet(A, tin.id, WALLET, 5000); // a new row
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 4500, from: WALLET, to: D1, value: units('1') }),  // while it was not registered
      nativeRow({ hash: 2, block: 5500, from: WALLET, to: D1, value: units('2') })); // after it was added again
    await watcher.runTinPass(A, tin, deps());
    expect(compact().map((e) => e.block)).toEqual([5500]);
  });

  it('a destination removed and added again: both transfers are recorded (the wallet made them), with the word the registry has at writing', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    const first = await makeDestination(A, tin.id, D1, 'trusted', 1000);
    await store.softDeleteDestination(A, first.id, stored(4000));
    await makeDestination(A, tin.id, D1, 'trusted', 5000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 4500, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 2, block: 5500, from: WALLET, to: D1, value: units('2') }));
    await watcher.runTinPass(A, tin, deps());
    expect(compact().map((e) => [e.block, e.reg])).toEqual([[4500, 'trusted'], [5500, 'trusted']]);
  });

  it('the registry is read per chain: a wallet on Polygon matches Polygon destinations only, and pays Polygon\'s coin', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id, WALLET, 0, 'polygon');
    await makeDestination(A, tin.id, D1, 'trusted', 1000, 'ethereum');
    await makeDestination(A, tin.id, D2, 'trusted', 1000, 'polygon');
    explorer.add('polygon', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 2000, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 2, block: 2001, from: WALLET, to: D2, value: units('1') }));
    prices = { 'polygon-ecosystem-token': 0.5 };
    clockAt(20_000);
    nowMs += 420 * 1000; // Polygon waits ten minutes
    const report = await watcher.runTinPass(A, tin, deps());
    expect(compact().map((e) => [e.who, e.asset, e.usd, e.reg])).toEqual([[D1, 'POL', 0.5, 'none'], [D2, 'POL', 0.5, 'trusted']]);
    expect(report.wallets[0].destinations).toBe(1);
    expect(report.wallets[0].unmatched).toBe(1);
  });

  it('a wallet with a registration time that cannot be read is not read: no history can be claimed', async () => {
    const w = await world();
    stockExplorer();
    fake.rows('agent_wallets').find((r) => r.id === w.wallet.id)!.created_at = 'unknown';
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'idle', reason: 'no_registration_time', recorded: 0 });
    expect(explorer.calls).toEqual([]);
    expect(ledger()).toEqual([]);
  });
});

// ── The link ─────────────────────────────────────────────────────────────────

describe('the verify-status each transaction inherits (the link)', () => {
  it('takes the answer of the latest check before it, within the hour', async () => {
    const w = await world();
    stockExplorer();
    const old = await check(A, w.tin.id, D1, at(1500, -5), 'proven', 'proven');
    const recent = await check(A, w.tin.id, D1, at(1900, -30), 'consistent-with-history');
    await watcher.runTinPass(A, w.tin, deps());
    const rows = ledger();
    const first = rows.find((r) => r.block_number === 1500)!;
    const second = rows.find((r) => r.block_number === 1900)!;
    expect(first).toMatchObject({ answer: 'proven', status: 'proven' });
    expect(detailOf(first).link).toEqual({ eventId: old.id, at: at(1500, -5), gapMs: 5000, keyId: 'a1'.repeat(12) });
    expect(second).toMatchObject({ answer: 'consistent-with-history', status: 'unknown' });
    expect(detailOf(second).link.eventId).toBe(recent.id);
    // The check at block 1500 is more than an hour before block 1900, so it did not stamp that one.
    expect(detailOf(second).link.eventId).not.toBe(old.id);
  });

  it('one check can stamp many transfers', async () => {
    const w = await world();
    stockExplorer();
    const c = await check(A, w.tin.id, D1, at(1890), 'consistent-with-history');
    await watcher.runTinPass(A, w.tin, deps());
    const stamped = ledger().filter((r) => r.address === D1 && detailOf(r).link?.eventId === c.id).map((r) => r.block_number);
    expect(stamped).toEqual([1900, 1960]);
  });

  it('a transfer with no check before it is unknown, with the reason', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger()).toHaveLength(STOCK_TRANSFERS);
    for (const row of ledger()) {
      expect(row.answer).toBe('unknown');
      expect(detailOf(row)).toMatchObject({ link: null, reason: 'no_preceding_check' });
    }
  });

  it('a check made after the funds moved does not vouch for them', async () => {
    const w = await world();
    stockExplorer();
    await check(A, w.tin.id, D2, at(1950, 20), 'proven', 'proven');
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().find((r) => r.block_number === 1950)).toMatchObject({ answer: 'unknown' });
  });

  it('checks that disagree in the same millisecond stamp nothing', async () => {
    const w = await world();
    stockExplorer();
    await check(A, w.tin.id, D2, at(2100, -10), 'proven', 'proven');
    await check(A, w.tin.id, D2, at(2100, -10), 'flagged', 'mismatch');
    await watcher.runTinPass(A, w.tin, deps());
    const row = ledger().find((r) => r.block_number === 2100)!;
    expect(row.answer).toBe('unknown');
    expect(detailOf(row)).toMatchObject({ link: null, reason: 'ambiguous_checks' });
  });

  it('only this tin\'s checks count: another tin\'s, another account\'s and another address\'s do not', async () => {
    const w = await world();
    stockExplorer();
    const other = await makeTin(A, 'Other agent');
    await check(A, other.id, D1, at(1500, -5), 'proven', 'proven');
    await check(B, w.tin.id, D1, at(1500, -5), 'proven', 'proven');
    await check(A, w.tin.id, D2, at(1500, -5), 'proven', 'proven');
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().find((r) => r.block_number === 1500)).toMatchObject({ answer: 'unknown' });
  });
});

// ── Twice ────────────────────────────────────────────────────────────────────

describe('reading the same history twice', () => {
  it('writes nothing the second time and says the movements were already there', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const first = JSON.stringify(fake.rows('agent_events'));
    const again = await watcher.runTinPass(A, w.tin, deps());
    expect(JSON.stringify(fake.rows('agent_events'))).toBe(first);
    expect(again.recorded).toBe(0);
    expect(again.wallets[0]).toMatchObject({ recorded: 0, alreadyRecorded: 1 }); // the one movement inside the overlap
  });

  it('a second pass at the same moment re-reads everything and still writes nothing', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    // Forget where the first pass stopped: everything is read again from the wallet's registration.
    fake.tables.set('agent_wallet_cursors', []);
    const before = fake.rows('agent_events').length;
    const again = await watcher.runTinPass(A, w.tin, deps());
    expect(fake.rows('agent_events')).toHaveLength(before);
    expect(again.wallets[0]).toMatchObject({ recorded: 0, alreadyRecorded: STOCK_TRANSFERS, unregistered: STOCK_UNREGISTERED });
  });

  it('two passes at once record each movement once', async () => {
    const w = await world();
    stockExplorer();
    await Promise.all([watcher.runTinPass(A, w.tin, deps()), watcher.runTinPass(A, w.tin, deps())]);
    expect(ledger()).toHaveLength(STOCK_TRANSFERS);
  });

  it('does not price or look up what is already recorded', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    priceCalls.length = 0;
    fake.tables.set('agent_wallet_cursors', []);
    await watcher.runTinPass(A, w.tin, deps());
    expect(priceCalls).toEqual([]);
  });
});

// ── Cursors ──────────────────────────────────────────────────────────────────

describe('where the read left off: one cursor per wallet', () => {
  it('a completed pass moves the wallet\'s cursor to the newest confirmed block, less an hour of overlap', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const cursors = walletCursors();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({ tenant_id: A, tin_id: w.tin.id, wallet_id: w.wallet.id });
    expect(cursors[0].through_at).toBe(new Date((blockTime(20_000) - 3600) * 1000).toISOString());
    expect(Object.keys(cursors[0]).sort()).toEqual(['tenant_id', 'through_at', 'tin_id', 'updated_at', 'wallet_id']);
  });

  it('the next pass starts from the cursor, not from the registration', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    explorer.calls.length = 0;
    clockAt(21_000);
    await watcher.runTinPass(A, w.tin, deps());
    const first = explorer.pages()[0];
    expect(first.startBlock).toBe(blockAtOrBefore(blockTime(20_000) - 3600));
    expect(first.startBlock).toBeGreaterThan(1000);
  });

  it('picks up a movement that was indexed late, if it is inside the overlap', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    clockAt(21_000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 50, block: 19_900, from: WALLET, to: D1, value: units('1') }),  // late, inside the last hour read
      nativeRow({ hash: 51, block: 20_900, from: WALLET, to: STRANGER, value: units('1') }), // new
      nativeRow({ hash: 52, block: 19_000, from: WALLET, to: D1, value: units('1') })); // later than an hour: out of reach, by design
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ recorded: 2, unregistered: 1, unmatched: 1 });
    expect(ledger().map((r) => r.block_number).slice(-3)).toEqual([19_800, 19_900, 20_900]);
    expect(ledger().some((r) => r.block_number === 19_000)).toBe(false);
  });

  it('a wallet registered moments ago has nothing to read yet', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id, WALLET, 20_001); // registered after the newest block that is read
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    const report = await watcher.runTinPass(A, tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'idle', reason: 'too_new', recorded: 0 });
    expect(explorer.pages()).toEqual([]);
    expect(walletCursors()).toEqual([]);
  });

  it('a wallet with no destination at all is read like any other', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 2000, from: WALLET, to: STRANGER, value: units('1') }));
    const report = await watcher.runTinPass(A, tin, deps());
    expect(report).toMatchObject({ recorded: 1, unregistered: 1, unmatched: 1, registered: { trusted: 0, pending: 0, flagged: 0 } });
    expect(report.wallets[0]).toMatchObject({ status: 'complete', destinations: 0 });
    expect(walletCursors()).toHaveLength(1);
  });

  it('never reads the newest few minutes: a block that is replaced later is not written down', async () => {
    const w = await world();
    stockExplorer();
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 70, block: 20_000, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 71, block: 20_001, from: WALLET, to: D1, value: units('1') }));
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().some((r) => r.block_number === 20_001)).toBe(false);
    expect(Math.max(...explorer.pages().map((p) => p.endBlock))).toBe(20_000);
  });

  it('each chain waits as long as it needs: Ethereum three minutes, Polygon ten, Avalanche one', async () => {
    expect(watcher.CONFIRMATION_LAG_S).toEqual({ ethereum: 180, polygon: 600, avalanche: 60 });
  });
});

describe('the transition from the per-pair cursors of before slice 8', () => {
  /** Rows the old watcher left: one cursor per wallet and destination pair, read through `block`. */
  async function oldPairCursor(tenant: string, tinId: string, walletId: string, destinationId: string, block: number) {
    await state.ensureAgentWatchTables();
    await fake.execute({
      sql: `INSERT INTO agent_watch_cursors (tenant_id, tin_id, wallet_id, destination_id, through_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [tenant, tinId, walletId, destinationId, blockIso(block), stored(block)],
    });
  }

  it('a wallet with pair cursors and no cursor of its own starts from the OLDEST pair cursor, not from the registration', async () => {
    const w = await world();
    stockExplorer();
    await oldPairCursor(A, w.tin.id, w.wallet.id, w.d1.id, 1700);
    await oldPairCursor(A, w.tin.id, w.wallet.id, w.d2.id, 1900);
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(explorer.pages()[0].startBlock).toBe(1700);
    // Everything from block 1700 on, whatever its other side; nothing before it (block 1600's stranger was dropped by the old rule and is not back-filled).
    expect(ledger().map((r) => r.block_number)[0]).toBe(1800);
    expect(ledger().some((r) => r.address === STRANGER)).toBe(false);
    expect(report.wallets[0].status).toBe('complete');
    // The pair rows are left as they were; the wallet now has a cursor of its own.
    expect(pairCursors().map((c) => c.through_at).sort()).toEqual([blockIso(1700), blockIso(1900)].sort());
    expect(walletCursors()).toHaveLength(1);
  });

  it('the pass after the transition uses the wallet cursor and ignores the pair rows', async () => {
    const w = await world();
    stockExplorer();
    await oldPairCursor(A, w.tin.id, w.wallet.id, w.d1.id, 1700);
    await watcher.runTinPass(A, w.tin, deps());
    // Rewind the pair row: if it were still read, the next pass would start there.
    pairCursors()[0].through_at = blockIso(100);
    clockAt(21_000);
    explorer.calls.length = 0;
    await watcher.runTinPass(A, w.tin, deps());
    expect(explorer.pages()[0].startBlock).toBe(blockAtOrBefore(blockTime(20_000) - 3600));
  });

  it('a transfer the old watcher already recorded is not written twice: the id is the same, so the row is already there', async () => {
    const w = await world();
    stockExplorer();
    // What the old watcher wrote for the pair (D1, trusted) at block 1900, under the old rule, with the same deterministic id.
    const leg = `token:${USDC_ETHEREUM}:${WALLET}:${D1}:${units('250', 6)}:0`;
    const written = await events.insertTransactionEvent(A, {
      tinId: w.tin.id, address: D1, chain: 'ethereum', registry: 'trusted', leg, answer: 'unknown', status: null,
      tx: { hash: `0x${(20).toString(16).padStart(64, '0')}`, direction: 'out', wallet: WALLET, amount: '250', asset: 'USDC', assetContract: USDC_ETHEREUM, usd: 250, blockNumber: 1900 },
      detail: { source: 'tokentx', walletId: w.wallet.id, destinationId: w.d1.id, reason: 'no_preceding_check' }, at: at(1900),
    });
    expect(written.inserted).toBe(true);
    await oldPairCursor(A, w.tin.id, w.wallet.id, w.d1.id, 1850);
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().filter((r) => r.block_number === 1900)).toHaveLength(1);
    expect(detailOf(ledger().find((r) => r.block_number === 1900)!)).not.toHaveProperty('counterparty'); // the old row is kept as it was
    expect(report.wallets[0].alreadyRecorded).toBe(1);
    expect(new Set(ledger().map((r) => r.id)).size).toBe(ledger().length);
  });

  it('a wallet with no pair cursor starts from its registration', async () => {
    const w = await world();
    stockExplorer();
    const other = await makeTin(A, 'Other');
    const otherWallet = await makeWallet(A, other.id, addr(2));
    await oldPairCursor(A, other.id, otherWallet.id, 'some-destination', 5000); // another wallet's pair: not this wallet's
    await watcher.runTinPass(A, w.tin, deps());
    expect(explorer.pages()[0].startBlock).toBe(0);
    expect(ledger()).toHaveLength(STOCK_TRANSFERS);
  });

  it('the oldest pair cursor is never before the wallet\'s registration', async () => {
    const tin = await makeTin();
    const wallet = await makeWallet(A, tin.id, WALLET, 3000);
    const d = await makeDestination(A, tin.id, D1, 'trusted', 1000);
    await oldPairCursor(A, tin.id, wallet.id, d.id, 2000); // a pair cursor from before the wallet row (a wallet removed and re-added)
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 2500, from: WALLET, to: STRANGER, value: units('1') }), nativeRow({ hash: 2, block: 3500, from: WALLET, to: D1, value: units('1') }));
    await watcher.runTinPass(A, tin, deps());
    expect(ledger().map((r) => r.block_number)).toEqual([3500]);
  });

  it('walletStartMs and oldestPairCursor, as functions', () => {
    const wallet = { id: 'w1', createdAt: stored(3000) } as any;
    const pairs = new Map([[state.pairKey('w1', 'd1'), blockTime(5000) * 1000], [state.pairKey('w1', 'd2'), blockTime(4000) * 1000], [state.pairKey('w2', 'd1'), blockTime(100) * 1000]]);
    expect(state.oldestPairCursor(pairs, 'w1')).toBe(blockTime(4000) * 1000);
    expect(state.oldestPairCursor(pairs, 'w3')).toBeNull();
    expect(watcher.walletStartMs(wallet, new Map(), pairs)).toBe(blockTime(4000) * 1000);
    expect(watcher.walletStartMs(wallet, new Map([['w1', blockTime(6000) * 1000]]), pairs)).toBe(blockTime(6000) * 1000);
    expect(watcher.walletStartMs(wallet, new Map(), new Map())).toBe(blockTime(3000) * 1000);
    expect(watcher.walletStartMs(wallet, new Map(), new Map([[state.pairKey('w1', 'd1'), blockTime(100) * 1000]]))).toBe(blockTime(3000) * 1000);
    expect(Number.isNaN(watcher.walletStartMs({ id: 'w1', createdAt: 'unknown' } as any, new Map(), pairs))).toBe(true);
  });
});

// ── Reads that could not finish ──────────────────────────────────────────────

describe('a read that could not finish says so, and moves nothing it did not reach', () => {
  it('an explorer that cannot answer: unavailable, no cursor, nothing recorded from that listing', async () => {
    const w = await world();
    stockExplorer();
    explorer.failPage = (q) => q.action === 'tokentx';
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'unavailable', reason: 'explorer_unavailable', throughAt: null });
    expect(walletCursors()).toEqual([]);
    expect(ledger().every((r) => detailOf(r).source !== 'tokentx')).toBe(true);
    expect(ledger().length).toBeGreaterThan(0); // the listings that were read are kept
  });

  it('and the next pass, with the explorer back, completes the job without doubling anything', async () => {
    const w = await world();
    stockExplorer();
    explorer.failPage = (q) => q.action === 'tokentx';
    await watcher.runTinPass(A, w.tin, deps());
    explorer.failPage = null;
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0].status).toBe('complete');
    expect(ledger()).toHaveLength(STOCK_TRANSFERS);
    expect(walletCursors()).toHaveLength(1);
  });

  it('a block lookup that fails is unavailable too', async () => {
    const w = await world();
    stockExplorer();
    explorer.failBlockAt = () => true;
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'unavailable', reason: 'explorer_unavailable' });
    expect(ledger()).toEqual([]);
    expect(walletCursors()).toEqual([]);
  });

  it('no API key (the explorer answers nothing at all) leaves the ledger and the cursors alone', async () => {
    const w = await world();
    stockExplorer();
    const dead = { blockAt: async () => null, page: async () => null };
    const report = await watcher.runTinPass(A, w.tin, deps({ explorer: dead }));
    expect(report.wallets[0].status).toBe('unavailable');
    expect(fake.rows('agent_events')).toEqual([]);
    expect(walletCursors()).toEqual([]);
  });

  it('a page limit keeps the blocks it read whole, drops the last block, and resumes there next time', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    const rows = Array.from({ length: 10 }, (_, i) => nativeRow({ hash: 100 + i, block: 2000 + i * 10, from: WALLET, to: D1, value: units('1') }));
    explorer.add('ethereum', WALLET, 'txlist', ...rows);
    const small = deps({ limits: { pageSize: 3, maxPages: 2 } }); // six rows a read

    const first = await watcher.runTinPass(A, tin, small);
    expect(first.wallets[0]).toMatchObject({ status: 'partial', reason: 'page_limit', recorded: 5 });
    expect(ledger().map((r) => r.block_number)).toEqual([2000, 2010, 2020, 2030, 2040]); // block 2050 may have been cut: not kept
    const cursor = walletCursors()[0].through_at;
    expect(cursor).toBe(new Date((blockTime(2050) - 1) * 1000).toISOString());

    let last = first;
    for (let i = 0; i < 5 && last.wallets[0].status !== 'complete'; i++) last = await watcher.runTinPass(A, tin, small);
    expect(last.wallets[0].status).toBe('complete');
    expect(ledger().map((r) => r.block_number)).toEqual(rows.map((r) => Number(r.blockNumber)));
    expect(new Set(ledger().map((r) => r.id)).size).toBe(10);
  });

  it('a block with more rows than a read can hold makes no progress, and says so', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist', ...Array.from({ length: 6 }, (_, i) => nativeRow({ hash: 200 + i, block: 2000, from: WALLET, to: D1, value: units('1') })));
    const report = await watcher.runTinPass(A, tin, deps({ limits: { pageSize: 2, maxPages: 2 } }));
    expect(report.wallets[0]).toMatchObject({ status: 'unavailable', reason: 'dense_block', recorded: 0 });
    expect(walletCursors()).toEqual([]);
  });

  it('the deadline stops new reads; what was read stays and the cursor says where to resume', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    const rows = Array.from({ length: 5 }, (_, i) => nativeRow({ hash: 300 + i, block: 2000 + i * 10, from: WALLET, to: D1, value: units('1') }));
    explorer.add('ethereum', WALLET, 'txlist', ...rows);
    // The clock runs out right after the first page is read.
    const slowClock = deps({
      limits: { pageSize: 2, maxPages: 5 },
      explorer: { blockAt: (c: any, s: number) => explorer.blockAt(c, s), page: async (q: any) => { const got = await explorer.page(q); nowMs += 100_000; return got; } },
    });
    const report = await watcher.runTinPass(A, tin, slowClock, { deadlineAt: nowMs + 50_000 });
    expect(report.wallets[0]).toMatchObject({ status: 'partial', reason: 'deadline' });
    // What was read whole stays: the first page held blocks 2000 and 2010, and block 2010 may have been cut.
    expect(ledger().map((r) => r.block_number)).toEqual([2000]);
    clockAt(20_000);
    await watcher.runTinPass(A, tin, deps({ limits: { pageSize: 2, maxPages: 5 } }));
    expect(ledger().map((r) => r.block_number)).toEqual(rows.map((r) => Number(r.blockNumber)));
  });

  it('a deadline that has already passed reads nothing', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps(), { deadlineAt: nowMs - 1 });
    expect(report.wallets[0]).toMatchObject({ status: 'partial', reason: 'deadline', recorded: 0 });
    expect(explorer.calls).toEqual([]);
  });

  it('a write that fails is reported as failed with a code, and the cursor stays', async () => {
    const w = await world();
    stockExplorer();
    const real = holder.db.execute.bind(holder.db);
    holder.db = { ...holder.db, execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      if (/^\s*INSERT INTO agent_events/i.test(sql)) throw Object.assign(new Error('secret detail'), { name: 'DatabaseError', code: '57P01' });
      return real(s);
    } };
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'failed', reason: 'write_failed' });
    expect(JSON.stringify(report)).not.toContain('secret detail');
    expect(walletCursors()).toEqual([]);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('secret detail');
  });
});

describe('a price that has not come in yet', () => {
  it('records the transfer at once, with its token and exact amount, marks its value pending, and moves the cursor past it', async () => {
    const w = await world();
    stockExplorer();
    prices = {}; // ETH has no price yet
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'complete', reason: null, recorded: STOCK_TRANSFERS });
    expect(report.wallets[0].pricePending).toBeGreaterThan(0);
    expect(ledger()).toHaveLength(STOCK_TRANSFERS);
    const eth = ledger().find((r) => r.block_number === 1500)!;
    expect(eth).toMatchObject({ amount: '1.5', asset: 'ETH', usd_value: null });
    expect(detailOf(eth).price).toEqual({ basis: null, pending: true, coinId: 'ethereum', day: blockIso(1500).slice(0, 10) });
    // Stablecoins need no price, so they are never pending.
    expect(detailOf(ledger().find((r) => r.block_number === 1900)!).price).toMatchObject({ basis: 'stablecoin_peg' });
    expect(walletCursors()[0].through_at).not.toBe(new Date((blockTime(999) - 1) * 1000).toISOString());
  });

  it('fills the value from the day\'s price on a later pass, and every read shows it; the ledger row itself is never changed', async () => {
    const w = await world();
    stockExplorer();
    prices = {};
    await watcher.runTinPass(A, w.tin, deps());
    const before = await events.listEvents(A, w.tin.id, { limit: 100 });
    expect(before.events.find((e) => e.tx?.blockNumber === 1500)?.tx?.usd).toBeNull();

    prices = { ethereum: 2000 };
    await watcher.runTinPass(A, w.tin, deps());
    const days = new Set(ledger().filter((r) => detailOf(r).price?.pending).map((r) => detailOf(r).price.day));
    expect(fake.rows('agent_daily_prices')).toHaveLength(days.size); // one row per coin and day, not per transfer
    expect(fake.rows('agent_daily_prices')).toContainEqual(expect.objectContaining({ coin_id: 'ethereum', day: blockIso(1500).slice(0, 10), status: 'priced', unit_usd: 2000 }));
    expect(ledger().find((r) => r.block_number === 1500)).toMatchObject({ usd_value: null });
    const after = await events.listEvents(A, w.tin.id, { limit: 100 });
    const e = after.events.find((x) => x.tx?.blockNumber === 1500)!;
    expect(e.tx?.usd).toBe(3000);
    expect(e.detail?.price).toMatchObject({ basis: 'daily_price', unitUsd: 2000, filledLater: true });
  });

  it('asks for one coin\'s price for one day once, however many transfers share it', async () => {
    const w = await world();
    stockExplorer();
    prices = {};
    await watcher.runTinPass(A, w.tin, deps());
    priceCalls.length = 0;
    prices = { ethereum: 2000 };
    await watcher.runTinPass(A, w.tin, deps());
    await watcher.runTinPass(A, w.tin, deps());
    const pending = new Set(ledger().filter((r) => r.usd_value === null && detailOf(r).price?.pending).map((r) => detailOf(r).price.day));
    expect(priceCalls).toHaveLength(pending.size);
  });

  it('is accepted as missing for good once the transfer is more than a week old', async () => {
    const w = await world();
    stockExplorer();
    prices = {};
    clockAt(20_000 + (8 * 24 * 3600) / 12); // eight days later
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0].status).toBe('complete');
    expect(ledger().find((r) => r.block_number === 1500)).toMatchObject({ usd_value: null });
    expect(detailOf(ledger().find((r) => r.block_number === 1500)!).price).toEqual({ basis: null, reason: 'no_price' });
  });

  it('asks for a day\'s price once per pass', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const unique = new Set(priceCalls);
    expect(priceCalls.length).toBe(unique.size);
  });
});

// ── Many destinations, and other accounts ────────────────────────────────────

describe('the registry is the agent\'s own list, however long', () => {
  it('every registered destination of the tin labels its transfers, and another tin\'s list does not count', async () => {
    const one = await makeTin(A, 'One');
    const two = await makeTin(A, 'Two');
    await makeWallet(A, one.id);
    await makeWallet(A, two.id, addr(2));
    const mine: string[] = [];
    const theirs: string[] = [];
    for (let i = 0; i < 9; i++) { const a = addr(100 + i); mine.push(a); await makeDestination(A, one.id, a, 'trusted', 1000 + i); }
    for (let i = 0; i < 8; i++) { const a = addr(200 + i); theirs.push(a); await makeDestination(A, two.id, a, 'trusted', 1100 + i); }
    [...mine, ...theirs].forEach((a, i) => {
      explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1000 + i, block: 5000, from: WALLET, to: a, value: units('1') }));
    });
    const report = await watcher.runTinPass(A, one, deps());
    expect(report.registered.trusted).toBe(9);
    expect(report).toMatchObject({ recorded: 17, unregistered: 8, unmatched: 8 });
    const byAddress = new Map(ledger().map((r) => [r.address, r.registry]));
    for (const a of mine) expect(byAddress.get(a), a).toBe('trusted');
    for (const a of theirs) expect(byAddress.get(a), a).toBe('none');
  });
});

describe('accounts never see each other', () => {
  it('the same wallet on two accounts is read separately, and each keeps its own ledger, registry and cursors', async () => {
    const mine = await world();
    stockExplorer();
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id);
    await makeDestination(B, tinB.id, D1, 'trusted', 1000);
    await check(B, tinB.id, D1, at(1500, -5), 'proven', 'proven');
    await watcher.runTinPass(A, mine.tin, deps());
    await watcher.runTinPass(B, tinB, deps());

    expect(ledger(A).length).toBe(STOCK_TRANSFERS);
    expect(ledger(B).length).toBe(STOCK_TRANSFERS);
    // B's registry has D1 only: everything else is "none" for B, while A's registry labels D2, D3 and D4.
    expect(ledger(B).find((r) => r.address === D2)).toMatchObject({ registry: 'none' });
    expect(ledger(A).find((r) => r.address === D2)).toMatchObject({ registry: 'trusted' });
    expect(ledger(B).find((r) => r.block_number === 1500)).toMatchObject({ answer: 'proven' });
    expect(ledger(A).find((r) => r.block_number === 1500)).toMatchObject({ answer: 'unknown' }); // B's check did not stamp A's transfer
    expect(new Set(fake.rows('agent_events').map((r) => r.id)).size).toBe(fake.rows('agent_events').length);
    expect(walletCursors().filter((c) => c.tenant_id === B).every((c) => c.tin_id === tinB.id)).toBe(true);
    expect(walletCursors()).toHaveLength(2);
  });

  it('a pass never reads another account\'s wallets', async () => {
    const mine = await world();
    stockExplorer();
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id, addr(77));
    await makeDestination(B, tinB.id, addr(78), 'trusted', 1000);
    explorer.add('ethereum', addr(77), 'txlist', nativeRow({ hash: 900, block: 2500, from: addr(77), to: addr(78), value: units('1') }));
    await watcher.runTinPass(A, mine.tin, deps());
    expect(explorer.pages().every((p) => p.address === WALLET)).toBe(true);
    expect(ledger(B)).toEqual([]);
  });

  it('given another account\'s tin id, a pass finds no wallets and records nothing', async () => {
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id);
    await makeDestination(B, tinB.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 2000, from: WALLET, to: D1, value: units('1') }));
    const report = await watcher.runTinPass(A, tinB, deps());
    expect(report.wallets).toEqual([]);
    expect(fake.rows('agent_events')).toEqual([]);
  });
});

// ── The daily job and the button ─────────────────────────────────────────────

// The daily job (the day's pass, in as many calls as it takes) is in tests/agentics/syncPass.test.ts.

describe('the owner asks for a read now', () => {
  it('runs the pass for the tin and answers what it did', async () => {
    const w = await world();
    stockExplorer();
    const r = await vault.refreshTin(A, w.tin.id, deps());
    expect(r).toMatchObject({ ok: true, pass: { tinId: w.tin.id, recorded: STOCK_TRANSFERS, unregistered: STOCK_UNREGISTERED, unmatched: STOCK_UNREGISTERED } });
  });

  it('says plainly when the tin is not there, belongs to someone else, or the id is nonsense', async () => {
    const tinB = await makeTin(B, 'Agent');
    expect(await vault.refreshTin(A, 'no-such-tin', deps())).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.refreshTin(A, tinB.id, deps())).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.refreshTin(A, '', deps())).toEqual({ ok: false, error: 'invalid_id' });
    expect(await vault.refreshTin(A, undefined, deps())).toEqual({ ok: false, error: 'invalid_id' });
    expect(explorer.calls).toEqual([]);
  });

  it('refuses a second read of the same tin while one is running, and allows it again afterwards', async () => {
    const w = await world();
    stockExplorer();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = deps({ explorer: { blockAt: async (c: any, s: number) => { await gate; return explorer.blockAt(c, s); }, page: (q: any) => explorer.page(q) } });
    const running = vault.refreshTin(A, w.tin.id, slow);
    await new Promise((r) => setTimeout(r, 5));
    expect(await vault.refreshTin(A, w.tin.id, deps())).toEqual({ ok: false, error: 'refresh_in_progress' });
    release();
    expect(await running).toMatchObject({ ok: true });
    expect(await vault.refreshTin(A, w.tin.id, deps())).toMatchObject({ ok: true });
  });

  it('gives a failed read back its slot too', async () => {
    const w = await world();
    stockExplorer();
    const boom = deps({ explorer: { blockAt: async () => { throw new Error('boom'); }, page: async () => null } });
    const r = await vault.refreshTin(A, w.tin.id, boom);
    expect(r).toMatchObject({ ok: true, pass: { wallets: [{ status: 'failed' }] } });
    expect(await vault.refreshTin(A, w.tin.id, deps())).toMatchObject({ ok: true });
  });

  it('stops starting calls after about twenty seconds', async () => {
    expect(vault.REFRESH_DEADLINE_MS).toBe(20_000);
    const w = await world();
    stockExplorer();
    const r = await vault.refreshTin(A, w.tin.id, deps());
    expect(r.ok).toBe(true);
  });

  it('the totals add up what the pass recorded, with any address on the other side', async () => {
    const w = await world();
    stockExplorer();
    await vault.refreshTin(A, w.tin.id, deps());
    const r = await vault.getTinTotals(A, w.tin.id);
    expect(r).toEqual({
      ok: true,
      tinId: w.tin.id,
      totals: {
        transactions: STOCK_TRANSFERS,
        // in: 100 USDC from D2 + 0.2 ETH ($400) from D2
        bought: { count: 2, pricedCount: 2, unpricedCount: 0, usd: 500 },
        // out: 3 ETH ($6000) + 2 ETH ($4000) + 1.5 ETH ($3000) + 9 ETH ($18000) + 2 ETH x 4 ($16000) + 250 USDC + 40 copycat (no value) + 2 x 5 USDC + 0.1 ETH ($200)
        sold: { count: 13, pricedCount: 12, unpricedCount: 1, usd: 47_460 },
      },
    });
    expect(await vault.getTinTotals(A, 'ghost')).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.getTinTotals(B, w.tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.getTinTotals(A, '')).toEqual({ ok: false, error: 'invalid_id' });
  });
});

// ── Bookkeeping ──────────────────────────────────────────────────────────────

describe('cursor bookkeeping', () => {
  it('only moves forward', async () => {
    const w = await world();
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Date.UTC(2026, 9, 18, 12), new Map());
    const later = await state.readWalletCursors(A, w.tin.id);
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Date.UTC(2026, 9, 18, 6), later);
    expect(await state.readWalletCursors(A, w.tin.id)).toEqual(later);
    expect([...later.values()]).toEqual([Date.UTC(2026, 9, 18, 12)]);
  });

  it('a late write from an older pass cannot move a cursor back, even if it did not know the newer one', async () => {
    const w = await world();
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Date.UTC(2026, 9, 18, 12), new Map());
    // The older pass passes what it read; the statement itself replaces, so the caller's map is the guard. This documents the contract.
    const stale = new Map([[w.wallet.id, Date.UTC(2026, 9, 18, 12)]]);
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Date.UTC(2026, 9, 18, 3), stale);
    expect([...(await state.readWalletCursors(A, w.tin.id)).values()]).toEqual([Date.UTC(2026, 9, 18, 12)]);
  });

  it('is scoped to the account and the tin', async () => {
    const w = await world();
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Date.UTC(2026, 9, 18, 12), new Map());
    expect((await state.readWalletCursors(B, w.tin.id)).size).toBe(0);
    expect((await state.readWalletCursors(A, 'other-tin')).size).toBe(0);
    expect((await state.readWalletCursors(A, w.tin.id)).size).toBe(1);
    expect((await state.readPairCursors(A, w.tin.id)).size).toBe(0);
  });

  it('does nothing for a time that is not a time', async () => {
    const w = await world();
    await state.advanceWalletCursor(A, w.tin.id, w.wallet.id, Number.NaN, new Map());
    expect(walletCursors()).toEqual([]);
  });

  it('readPairCursors reads the old rows by pair, and only this tin\'s', async () => {
    const w = await world();
    await state.ensureAgentWatchTables();
    await fake.execute({ sql: `INSERT INTO agent_watch_cursors (tenant_id, tin_id, wallet_id, destination_id, through_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [A, w.tin.id, w.wallet.id, w.d1.id, blockIso(500), stored(500)] });
    await fake.execute({ sql: `INSERT INTO agent_watch_cursors (tenant_id, tin_id, wallet_id, destination_id, through_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [A, 'other-tin', 'w9', 'd9', blockIso(600), stored(600)] });
    const pairs = await state.readPairCursors(A, w.tin.id);
    expect([...pairs]).toEqual([[state.pairKey(w.wallet.id, w.d1.id), blockTime(500) * 1000]]);
  });
});

describe('helpers', () => {
  it('storedMs reads the registry\'s time format and ISO, and nothing else', () => {
    expect(watcher.storedMs('2026-10-01 00:00:00')).toBe(Date.UTC(2026, 9, 1));
    expect(watcher.storedMs('2026-10-01T00:00:00.000Z')).toBe(Date.UTC(2026, 9, 1));
    expect(watcher.storedMs('2026-10-01T00:00:00+00:00')).toBe(Date.UTC(2026, 9, 1));
    expect(Number.isNaN(watcher.storedMs('yesterday'))).toBe(true);
    expect(Number.isNaN(watcher.storedMs(''))).toBe(true);
  });

  it('registryIndex keys the live destinations by chain and address', async () => {
    const w = await world();
    const live = await store.listDestinations(A, w.tin.id);
    const index = watcher.registryIndex(live);
    expect(index.get(`ethereum|${D1}`)?.id).toBe(w.d1.id);
    expect(index.get(`polygon|${D5}`)?.id).toBe(w.d5.id);
    expect(index.get(`ethereum|${D5}`)).toBeUndefined();
    expect(index.get(`ethereum|${D6}`)).toBeUndefined(); // removed
    expect(index.size).toBe(5);
  });
});

describe('what the daily job reads: the wallets of live agents', () => {
  it('lists every tin that has a live wallet, once, and never one whose agent has been removed', async () => {
    const gone = await makeTin(A, 'Gone');
    const stray = await makeWallet(A, gone.id, addr(900));
    expect(await store.softDeleteTin(A, gone.id, stored(500))).toBe(true);
    fake.rows('agent_wallets').find((r) => r.id === stray.id)!.deleted_at = null; // what a race could have left
    const keep = await makeTin(A, 'Keep');
    await makeWallet(A, keep.id, addr(901));
    await makeWallet(A, keep.id, addr(902));
    const none = await makeTin(A, 'No wallet');
    await makeDestination(A, none.id, addr(903), 'trusted', 1000);
    const targets = await store.listWatchTargets(100);
    expect(targets).toEqual([{ tenantId: A, tinId: keep.id }]);
  });

  it('a removed wallet does not keep its tin on the list', async () => {
    const tin = await makeTin(A, 'Mine');
    const w = await makeWallet(A, tin.id, addr(903));
    expect(await store.listWatchTargets(100)).toEqual([{ tenantId: A, tinId: tin.id }]);
    await store.softDeleteWallet(A, w.id, stored(2000));
    expect(await store.listWatchTargets(100)).toEqual([]);
  });

  it('spans accounts, in a fixed order', async () => {
    const mine = await makeTin(A, 'Mine');
    const theirs = await makeTin(B, 'Theirs');
    await makeWallet(B, theirs.id, addr(904));
    await makeWallet(A, mine.id, addr(903));
    expect(await store.listWatchTargets(100)).toEqual([{ tenantId: A, tinId: mine.id }, { tenantId: B, tinId: theirs.id }]);
  });
});

// ── The unmatched-payment email ──────────────────────────────────────────────

describe('an unmatched payment found by a read is emailed once, if it is new', () => {
  /** What the pass asked the alert to send: the alert itself (rate limit, mail) is ./alerts.test.ts. */
  const sent: Array<{ tenantId: string; tinId: string; address: string; kind: string }> = [];
  const alerting = () => deps({ alert: async (info: any) => { sent.push(info); } });
  beforeEach(() => { sent.length = 0; });

  /** Blocks are 12 seconds, and the clock sits 180 seconds past block 20,000: this many blocks is 36 hours, less that lag. */
  const MAX_AGE_BLOCKS = (36 * 60 * 60 - 180) / 12;

  it('asks for one email per new unmatched payment, naming the account, the agent and the address, and none for a matched one or one received', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 19_900, from: WALLET, to: STRANGER, value: units('1') }), // unmatched, minutes old
      nativeRow({ hash: 2, block: 19_910, from: WALLET, to: D1, value: units('1') }),       // to a trusted address
      nativeRow({ hash: 3, block: 19_920, from: STRANGER, to: WALLET, value: units('1') })); // received
    await watcher.runTinPass(A, tin, alerting());
    await Promise.resolve();
    expect(sent).toEqual([{ tenantId: A, tinId: tin.id, address: STRANGER, kind: 'unmatched' }]);
  });

  it('sends nothing for an unmatched payment more than 36 hours old when it is found: a read catching up records it and marks it', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 20_000 - MAX_AGE_BLOCKS - 1, from: WALLET, to: addr(91), value: units('1') }), // just past 36 hours
      nativeRow({ hash: 2, block: 20_000 - MAX_AGE_BLOCKS, from: WALLET, to: addr(92), value: units('1') }));    // exactly 36 hours
    await watcher.runTinPass(A, tin, alerting());
    await Promise.resolve();
    expect(ledger().map((r) => [r.address, detailOf(r).unmatched])).toEqual([[addr(91), true], [addr(92), true]]);
    expect(sent.map((s) => s.address)).toEqual([addr(92)]);
  });

  it('the first read of a wallet with a long history sends nothing for the old payments', async () => {
    const w = await world();
    stockExplorer(); // three unmatched payments, all about 60 hours old at this clock
    const report = await watcher.runTinPass(A, w.tin, alerting());
    expect(report.unmatched).toBe(3);
    expect(sent).toEqual([]);
  });

  it('a payment read again in the next pass\'s overlap is not emailed again', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 19_990, from: WALLET, to: STRANGER, value: units('1') }));
    await watcher.runTinPass(A, tin, alerting());
    clockAt(20_010);
    await watcher.runTinPass(A, tin, alerting());
    await Promise.resolve();
    expect(sent).toHaveLength(1);
  });

  it('an alert that fails never stops the read or changes what it wrote', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 19_990, from: WALLET, to: STRANGER, value: units('1') }));
    const report = await watcher.runTinPass(A, tin, deps({ alert: async () => { throw new Error('mail down'); } }));
    await Promise.resolve();
    expect(report).toMatchObject({ recorded: 1, unmatched: 1 });
    expect(detailOf(ledger()[0])).toMatchObject({ unmatched: true });
  });

  it('without an alert to call (a test, or a caller that wants none), nothing is sent and nothing changes', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1, block: 19_990, from: WALLET, to: STRANGER, value: units('1') }));
    expect(await watcher.runTinPass(A, tin, deps())).toMatchObject({ recorded: 1, unmatched: 1 });
  });

  it('the daily job and every read run with the real alert', async () => {
    expect(typeof watcher.defaultWatchDeps.alert).toBe('function');
  });
});

describe('a read that finds several unmatched payments asks for one email per address, after the whole pass is written', () => {
  it('three payments to one address and one to another: two emails, and the first says three', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 19_900, from: WALLET, to: STRANGER, value: units('1') }),
      nativeRow({ hash: 2, block: 19_910, from: WALLET, to: STRANGER, value: units('1') }),
      nativeRow({ hash: 3, block: 19_920, from: WALLET, to: STRANGER, value: units('1') }),
      nativeRow({ hash: 4, block: 19_930, from: WALLET, to: addr(93), value: units('1') }));
    const alerts = await import('../../src/lib/agentVault/alerts');
    const mail: Array<{ subject: string; text: string }> = [];
    const pending: Promise<unknown>[] = [];
    const alertDeps = {
      now: () => new Date(nowMs),
      recipient: async () => 'operator@example.test',
      send: async (m: { to: string; subject: string; text: string }) => { mail.push(m); },
      appBase: 'https://almstins.test',
    };
    const asked: string[] = [];
    await watcher.runTinPass(A, tin, deps({ alert: (info: any) => { asked.push(info.address); const p = alerts.alertCheck(info, alertDeps); pending.push(p); return p; } }));
    await Promise.all(pending);
    expect(asked.sort()).toEqual([STRANGER, addr(93)].sort());
    const texts = mail.map((m) => m.text).sort();
    expect(texts.some((t) => t.includes('Your agent made 3 payments to this address without a check first.'))).toBe(true);
    expect(texts.some((t) => t.includes('Your agent made 1 payment to this address without a check first.'))).toBe(true);
  });
});
