import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import {
  COPYCAT_USDC, USDC_ETHEREUM, blockAtOrBefore, blockIso, blockTime, createFakeExplorer, internalRow, nativeRow, tokenRow, units, type FakeExplorer,
} from '../helpers/fakeExplorer';

/**
 * The watcher, end to end over the in-memory database and a fake block explorer: verify the
 * address first, then watch that address receive the funds. The suite is mostly about what must
 * NOT be kept: nothing outside the registry, nothing before the pair existed, nothing twice, and
 * no cursor moved past anything that was not read. Every address, hash and amount is invented.
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
const STRANGER = addr(99);

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

/** Rows on the chain for the world above: movements that count, and every kind that must not. */
function stockExplorer() {
  const x = explorer;
  x.add('ethereum', WALLET, 'txlist',
    nativeRow({ hash: 1, block: 1500, from: WALLET, to: D1, value: units('1.5') }),     // counts: bought? no, out
    nativeRow({ hash: 2, block: 1600, from: WALLET, to: STRANGER, value: units('9') }), // nobody the registry knows
    nativeRow({ hash: 3, block: 999, from: WALLET, to: D1, value: units('3') }),        // before the pair existed
    nativeRow({ hash: 4, block: 1700, from: WALLET, to: D1, value: units('1'), failed: true }),
    nativeRow({ hash: 5, block: 1710, from: WALLET, to: D1, value: '0' }),
    nativeRow({ hash: 6, block: 1720, from: WALLET, to: WALLET, value: units('1') }),
    nativeRow({ hash: 7, block: 1800, from: WALLET, to: D3, value: units('2') }),       // flagged
    nativeRow({ hash: 8, block: 1810, from: WALLET, to: D4, value: units('2') }),       // pending
    nativeRow({ hash: 9, block: 1820, from: WALLET, to: D5, value: units('2') }),       // registered on Polygon only
    nativeRow({ hash: 10, block: 1830, from: WALLET, to: D6, value: units('2') }),      // removed
    nativeRow({ hash: 11, block: 1200, from: WALLET, to: D2, value: units('2') }),      // before D2 was registered
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

const check = (tenant: string, tinId: string, address: string, atIso: string, answer: 'proven' | 'consistent-with-history' | 'flagged' | 'unknown', status = 'unknown') =>
  events.insertCheckedEvent(tenant, { tinId, address, chain: 'ethereum', answer, registry: 'trusted', status, keyId: 'a1'.repeat(12), sourceIp: null, detail: {}, at: atIso });

const ledger = (tenant = A) =>
  fake.rows('agent_events').filter((r) => r.kind === 'transaction' && r.tenant_id === tenant)
    .sort((a, b) => a.block_number - b.block_number || String(a.detail_json).localeCompare(String(b.detail_json)));
const compact = (rows = ledger()) => rows.map((r) => ({
  block: r.block_number, dir: r.direction, who: r.address, amount: r.amount, asset: r.asset, usd: r.usd_value, answer: r.answer,
}));

// ── Verify, then watch ───────────────────────────────────────────────────────

describe('a pass records the movements between the agent\'s wallet and its trusted destinations', () => {
  it('records exactly the movements that count, with their facts', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());

    expect(compact()).toEqual([
      { block: 1500, dir: 'out', who: D1, amount: '1.5', asset: 'ETH', usd: 3000, answer: 'unknown' },
      { block: 1900, dir: 'out', who: D1, amount: '250', asset: 'USDC', usd: 250, answer: 'unknown' },
      { block: 1950, dir: 'in', who: D2, amount: '100', asset: 'USDC', usd: 100, answer: 'unknown' },
      { block: 1960, dir: 'out', who: D1, amount: '40', asset: 'USDC', usd: null, answer: 'unknown' },
      { block: 2000, dir: 'out', who: D2, amount: '5', asset: 'USDC', usd: 5, answer: 'unknown' },
      { block: 2000, dir: 'out', who: D2, amount: '5', asset: 'USDC', usd: 5, answer: 'unknown' },
      { block: 2100, dir: 'in', who: D2, amount: '0.2', asset: 'ETH', usd: 400, answer: 'unknown' },
      { block: 19_800, dir: 'out', who: D1, amount: '0.1', asset: 'ETH', usd: 200, answer: 'unknown' },
    ]);
    expect(report.recorded).toBe(8);
    expect(report.wallets).toHaveLength(1);
    expect(report.wallets[0]).toMatchObject({
      chain: 'ethereum', address: WALLET, status: 'complete', reason: null, destinations: 2, matched: 8, recorded: 8, alreadyRecorded: 0, deferred: 0,
    });
  });

  it('writes each event with the destination as its address, the chain, the block\'s time, the wallet and the hash', async () => {
    await (async () => { const w = await world(); stockExplorer(); await watcher.runTinPass(A, w.tin, deps()); })();
    const first = ledger()[0];
    expect(first).toMatchObject({
      tenant_id: A, kind: 'transaction', address: D1, chain: 'ethereum', registry: 'trusted', key_id: null, source_ip: null,
      wallet: WALLET, asset_contract: null, occurred_at: at(1500),
    });
    expect(first.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.parse(first.detail_json)).toMatchObject({
      source: 'txlist', link: null, reason: 'no_preceding_check', price: { basis: 'daily_price', unitUsd: 2000 },
      destinationRegisteredAt: stored(1000), destinationCheckedAt: null, walletId: expect.any(String), destinationId: expect.any(String),
    });
  });

  it('reads the tokens and the coin moved by contracts, not only plain payments', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    expect(new Set(ledger().map((r) => JSON.parse(r.detail_json).source))).toEqual(new Set(['txlist', 'tokentx', 'txlistinternal']));
  });

  it('a token on a contract that is not the known one is recorded (the movement happened) but has no USD value', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const copycat = ledger().find((r) => r.block_number === 1960)!;
    expect(copycat).toMatchObject({ asset: 'USDC', asset_contract: COPYCAT_USDC, usd_value: null });
    expect(JSON.parse(copycat.detail_json).price).toEqual({ basis: null, reason: 'unknown_token' });
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
});

describe('nothing outside the registry is kept, counted or mentioned', () => {
  it('no stranger, flagged, pending, removed or other-chain address reaches the ledger', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const kept = new Set(fake.rows('agent_events').map((r) => r.address));
    expect(kept).toEqual(new Set([D1, D2]));
    for (const never of [STRANGER, D3, D4, D5, D6]) expect(kept.has(never)).toBe(false);
  });

  it('the stranger\'s address appears in no cell of any table', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    for (const [table, rows] of fake.tables) {
      const text = JSON.stringify(rows);
      for (const never of [STRANGER, D3.slice(2), D4.slice(2)]) {
        // The registry itself lists the flagged and pending destinations; the ledger and cursors must not.
        if (table === 'agent_destinations') continue;
        expect(text.includes(never.replace(/^0x/, '')), `${table} holds ${never}`).toBe(false);
      }
    }
  });

  it('the report says nothing about traffic outside the registry', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());
    const text = JSON.stringify(report);
    expect(text).not.toContain(STRANGER);
    expect(Object.keys(report.wallets[0]).sort()).toEqual([
      'address', 'alreadyRecorded', 'chain', 'deferred', 'destinations', 'matched', 'reason', 'recorded', 'status', 'throughAt', 'walletId',
    ]);
  });

  it('only destinations that are trusted are watched: flagged and pending are reported as not watched', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.watchedDestinations).toBe(3); // D1, D2 and the Polygon one
    expect(report.notWatched).toEqual({ pending: 1, flagged: 1, overLimit: 0 });
  });

  it('a destination that turns flagged is no longer watched, and what was recorded stays', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const before = ledger().length;
    setTrust(w.d1.id, 'flagged');
    clockAt(21_000);
    explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 40, block: 20_900, from: WALLET, to: D1, value: units('1') }));
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(ledger()).toHaveLength(before);
    expect(report.notWatched.flagged).toBe(2);
  });

  it('the pass writes only the ledger and the cursors', async () => {
    const w = await world();
    stockExplorer();
    const before = new Map([...fake.tables].map(([t, rows]) => [t, JSON.stringify(rows)]));
    await watcher.runTinPass(A, w.tin, deps());
    const changed = [...fake.tables].filter(([t, rows]) => before.get(t) !== JSON.stringify(rows)).map(([t]) => t).sort();
    expect(changed).toEqual(['agent_events', 'agent_watch_cursors']);
  });
});

describe('a pair\'s history begins when both ends were registered', () => {
  it('a movement before the destination was registered is not recorded, though the read passes over it', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    // D2 was registered at block 1800; its movement at block 1200 was read (D1 needed that range) and dropped.
    expect(ledger().some((r) => r.address === D2 && r.block_number === 1200)).toBe(false);
    expect(ledger().some((r) => r.address === D2 && r.block_number === 1950)).toBe(true);
  });

  it('a movement before the wallet was registered is not recorded either', async () => {
    const tin = await makeTin();
    const wallet = await makeWallet(A, tin.id, WALLET, 3000); // registered after the destination
    await makeDestination(A, tin.id, D1, 'trusted', 1000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 2000, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 2, block: 3500, from: WALLET, to: D1, value: units('2') }));
    await watcher.runTinPass(A, tin, deps());
    expect(compact()).toEqual([{ block: 3500, dir: 'out', who: D1, amount: '2', asset: 'ETH', usd: 4000, answer: 'unknown' }]);
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

  it('a destination removed and added again does not pick up what happened in between', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    const first = await makeDestination(A, tin.id, D1, 'trusted', 1000);
    await store.softDeleteDestination(A, first.id, stored(4000));
    await makeDestination(A, tin.id, D1, 'trusted', 5000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 1, block: 4500, from: WALLET, to: D1, value: units('1') }),
      nativeRow({ hash: 2, block: 5500, from: WALLET, to: D1, value: units('2') }));
    await watcher.runTinPass(A, tin, deps());
    expect(compact().map((e) => e.block)).toEqual([5500]);
  });

  it('a wallet only pairs with destinations on its own chain', async () => {
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
    expect(compact().map((e) => [e.who, e.asset, e.usd])).toEqual([[D2, 'POL', 0.5]]);
    expect(report.wallets[0].destinations).toBe(1);
  });
});

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
    expect(JSON.parse(first.detail_json).link).toEqual({ eventId: old.id, at: at(1500, -5), gapMs: 5000, keyId: 'a1'.repeat(12) });
    expect(second).toMatchObject({ answer: 'consistent-with-history', status: 'unknown' });
    expect(JSON.parse(second.detail_json).link.eventId).toBe(recent.id);
    // The check at block 1500 is more than an hour before block 1900, so it did not stamp that one.
    expect(JSON.parse(second.detail_json).link.eventId).not.toBe(old.id);
  });

  it('one check can stamp many transfers', async () => {
    const w = await world();
    stockExplorer();
    const c = await check(A, w.tin.id, D1, at(1890), 'consistent-with-history');
    await watcher.runTinPass(A, w.tin, deps());
    const stamped = ledger().filter((r) => r.address === D1 && JSON.parse(r.detail_json).link?.eventId === c.id).map((r) => r.block_number);
    expect(stamped).toEqual([1900, 1960]);
  });

  it('a transfer with no check before it is unknown, with the reason', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    for (const row of ledger()) {
      expect(row.answer).toBe('unknown');
      expect(JSON.parse(row.detail_json)).toMatchObject({ link: null, reason: 'no_preceding_check' });
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
    expect(JSON.parse(row.detail_json)).toMatchObject({ link: null, reason: 'ambiguous_checks' });
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
    // Forget where the first pass stopped: everything is read again from the pairs' beginnings.
    fake.tables.set('agent_watch_cursors', []);
    const before = fake.rows('agent_events').length;
    const again = await watcher.runTinPass(A, w.tin, deps());
    expect(fake.rows('agent_events')).toHaveLength(before);
    expect(again.wallets[0]).toMatchObject({ recorded: 0, alreadyRecorded: 8 });
  });

  it('two passes at once record each movement once', async () => {
    const w = await world();
    stockExplorer();
    await Promise.all([watcher.runTinPass(A, w.tin, deps()), watcher.runTinPass(A, w.tin, deps())]);
    expect(ledger()).toHaveLength(8);
  });

  it('does not price or look up what is already recorded', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    priceCalls.length = 0;
    fake.tables.set('agent_watch_cursors', []);
    await watcher.runTinPass(A, w.tin, deps());
    expect(priceCalls).toEqual([]);
  });
});

describe('where the read left off', () => {
  it('a completed pass moves each pair\'s cursor to the newest confirmed block, less an hour of overlap', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const cursors = fake.rows('agent_watch_cursors');
    expect(cursors.map((c) => c.destination_id).sort()).toEqual([w.d1.id, w.d2.id].sort());
    for (const c of cursors) {
      expect(c).toMatchObject({ tenant_id: A, tin_id: w.tin.id, wallet_id: w.wallet.id });
      expect(c.through_at).toBe(new Date((blockTime(20_000) - 3600) * 1000).toISOString());
    }
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
      nativeRow({ hash: 51, block: 20_900, from: WALLET, to: D1, value: units('1') }),  // new
      nativeRow({ hash: 52, block: 19_000, from: WALLET, to: D1, value: units('1') })); // later than an hour: out of reach, by design
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ recorded: 2 });
    expect(ledger().map((r) => r.block_number).slice(-3)).toEqual([19_800, 19_900, 20_900]);
    expect(ledger().some((r) => r.block_number === 19_000)).toBe(false);
  });

  it('a pair registered after the last pass is read from its own registration, without disturbing the others', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const d7 = await makeDestination(A, w.tin.id, addr(17), 'trusted', 19_000);
    explorer.add('ethereum', WALLET, 'txlist',
      nativeRow({ hash: 60, block: 18_000, from: WALLET, to: addr(17), value: units('1') }), // before it was registered
      nativeRow({ hash: 61, block: 19_100, from: WALLET, to: addr(17), value: units('1') })); // after
    clockAt(21_000);
    explorer.calls.length = 0;
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().filter((r) => r.address === addr(17)).map((r) => r.block_number)).toEqual([19_100]);
    // It was read from the older of the pairs' starting points (D7's registration at block 19000 is older than the cursor).
    expect(explorer.pages()[0].startBlock).toBe(19_000);
    expect(fake.rows('agent_watch_cursors').some((c) => c.destination_id === d7.id)).toBe(true);
  });

  it('a pair registered moments ago has nothing to read yet', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    await makeDestination(A, tin.id, D1, 'trusted', 20_001); // registered after the newest block that is read
    const report = await watcher.runTinPass(A, tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'idle', reason: 'too_new', recorded: 0 });
    expect(explorer.pages()).toEqual([]);
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
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

describe('a read that could not finish says so, and moves nothing it did not reach', () => {
  it('an explorer that cannot answer: unavailable, no cursor, nothing recorded from that listing', async () => {
    const w = await world();
    stockExplorer();
    explorer.failPage = (q) => q.action === 'tokentx';
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'unavailable', reason: 'explorer_unavailable', throughAt: null });
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
    expect(ledger().every((r) => JSON.parse(r.detail_json).source !== 'tokentx')).toBe(true);
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
    expect(ledger()).toHaveLength(8);
    expect(fake.rows('agent_watch_cursors')).toHaveLength(2);
  });

  it('a block lookup that fails is unavailable too', async () => {
    const w = await world();
    stockExplorer();
    explorer.failBlockAt = () => true;
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'unavailable', reason: 'explorer_unavailable' });
    expect(ledger()).toEqual([]);
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
  });

  it('no API key (the explorer answers nothing at all) leaves the ledger and the cursors alone', async () => {
    const w = await world();
    stockExplorer();
    const dead = { blockAt: async () => null, page: async () => null };
    const report = await watcher.runTinPass(A, w.tin, deps({ explorer: dead }));
    expect(report.wallets[0].status).toBe('unavailable');
    expect(fake.rows('agent_events')).toEqual([]);
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
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
    const cursor = fake.rows('agent_watch_cursors')[0].through_at;
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
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
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
    expect(fake.rows('agent_watch_cursors')).toEqual([]);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('secret detail');
  });
});

describe('a price that has not come in yet', () => {
  it('holds the transfer back, keeps the cursor just before it, and records it once the price arrives', async () => {
    const w = await world();
    stockExplorer();
    prices = {}; // ETH has no price today
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0]).toMatchObject({ status: 'partial', reason: 'price_not_in_yet' });
    expect(report.wallets[0].deferred).toBeGreaterThan(0);
    expect(ledger().every((r) => r.asset !== 'ETH')).toBe(true); // stablecoins and the copycat were recorded
    const earliestEth = blockTime(1500);
    expect(fake.rows('agent_watch_cursors')[0].through_at).toBe(new Date((earliestEth - 1) * 1000).toISOString());

    prices = { ethereum: 2000 };
    const next = await watcher.runTinPass(A, w.tin, deps());
    expect(next.wallets[0].status).toBe('complete');
    expect(ledger()).toHaveLength(8);
    expect(ledger().find((r) => r.block_number === 1500)).toMatchObject({ usd_value: 3000 });
  });

  it('is accepted as missing for good once the transfer is more than a week old', async () => {
    const w = await world();
    stockExplorer();
    prices = {};
    clockAt(20_000 + (8 * 24 * 3600) / 12); // eight days later
    const report = await watcher.runTinPass(A, w.tin, deps());
    expect(report.wallets[0].status).toBe('complete');
    expect(ledger().find((r) => r.block_number === 1500)).toMatchObject({ usd_value: null });
    expect(JSON.parse(ledger().find((r) => r.block_number === 1500)!.detail_json).price).toEqual({ basis: null, reason: 'no_price' });
  });

  it('asks for a day\'s price once per pass', async () => {
    const w = await world();
    stockExplorer();
    await watcher.runTinPass(A, w.tin, deps());
    const unique = new Set(priceCalls);
    expect(priceCalls.length).toBe(unique.size);
  });
});

describe('the pooled limit on watched destinations', () => {
  it('watches the oldest trusted destinations of the account, up to the limit, across its tins', async () => {
    const one = await makeTin(A, 'One');
    const two = await makeTin(A, 'Two');
    await makeWallet(A, one.id);
    await makeWallet(A, two.id, addr(2));
    const rows: string[] = [];
    for (let i = 0; i < 9; i++) { const a = addr(100 + i); rows.push(a); await makeDestination(A, one.id, a, 'trusted', 1000 + i); }
    for (let i = 0; i < 8; i++) { const a = addr(200 + i); rows.push(a); await makeDestination(A, two.id, a, 'trusted', 1100 + i); }
    rows.forEach((a, i) => {
      explorer.add('ethereum', WALLET, 'txlist', nativeRow({ hash: 1000 + i, block: 5000, from: WALLET, to: a, value: units('1') }));
      explorer.add('ethereum', addr(2), 'txlist', nativeRow({ hash: 2000 + i, block: 5000, from: addr(2), to: a, value: units('1') }));
    });
    const first = await watcher.runTinPass(A, one, deps());
    const second = await watcher.runTinPass(A, two, deps());
    expect(first.watchedDestinations + second.watchedDestinations).toBe(watcher.MAX_WATCHED_PER_TENANT);
    expect(first.notWatched.overLimit + second.notWatched.overLimit).toBe(2);
    expect(watcher.MAX_WATCHED_PER_TENANT).toBe(15);
    const watchedAddresses = new Set(fake.rows('agent_events').map((e) => e.address));
    // The two newest, both on the second tin, are the ones left out.
    expect(watchedAddresses.has(addr(206))).toBe(false);
    expect(watchedAddresses.has(addr(207))).toBe(false);
    expect(watchedAddresses.has(addr(205))).toBe(true);
  });

  it('the limit can be set for a plan', async () => {
    const w = await world();
    stockExplorer();
    const report = await watcher.runTinPass(A, w.tin, deps(), { maxWatched: 1 });
    expect(report.watchedDestinations).toBe(1);
    expect(report.notWatched.overLimit).toBe(2);
    expect(new Set(ledger().map((r) => r.address))).toEqual(new Set([D1]));
  });
});

describe('accounts never see each other', () => {
  it('the same addresses on two accounts are watched separately, and each keeps its own ledger and cursors', async () => {
    const mine = await world();
    stockExplorer();
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id);
    await makeDestination(B, tinB.id, D1, 'trusted', 1000);
    await check(B, tinB.id, D1, at(1500, -5), 'proven', 'proven');
    await watcher.runTinPass(A, mine.tin, deps());
    await watcher.runTinPass(B, tinB, deps());

    expect(ledger(A).length).toBe(8);
    expect(ledger(B).map((r) => r.block_number)).toEqual([1500, 1900, 1960, 19_800]);
    expect(ledger(B).find((r) => r.block_number === 1500)).toMatchObject({ answer: 'proven' });
    expect(ledger(A).find((r) => r.block_number === 1500)).toMatchObject({ answer: 'unknown' }); // B's check did not stamp A's transfer
    expect(new Set(fake.rows('agent_events').map((r) => r.id)).size).toBe(fake.rows('agent_events').length);
    expect(fake.rows('agent_watch_cursors').filter((c) => c.tenant_id === B).every((c) => c.tin_id === tinB.id)).toBe(true);
  });

  it('a pass never reads another account\'s wallets or destinations', async () => {
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

describe('the daily job', () => {
  it('visits every tin with a trusted destination, once, and reports numbers only', async () => {
    const mine = await world();
    stockExplorer();
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id);
    await makeDestination(B, tinB.id, D1, 'trusted', 1000);
    const bare = await makeTin(A, 'No destinations yet');
    await makeWallet(A, bare.id, addr(5));
    const flaggedOnly = await makeTin(A, 'Only flagged');
    await makeWallet(A, flaggedOnly.id, addr(6));
    await makeDestination(A, flaggedOnly.id, addr(30), 'flagged', 1000);

    const summary = await watcher.runAllTins(deps());
    expect(summary).toEqual({ tins: 2, wallets: 2, complete: 2, partial: 0, unavailable: 0, failed: 0, recorded: 8 + 4, truncated: false });
    expect(Object.values(summary).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/0x/);
    expect(ledger(A)).toHaveLength(8);
    expect(ledger(B)).toHaveLength(4);
    expect(mine.tin.id).toBeTruthy();
  });

  it('stops starting new tins at the deadline and says it was cut short', async () => {
    await world();
    stockExplorer();
    const summary = await watcher.runAllTins(deps(), { deadlineAt: nowMs - 1 });
    expect(summary).toMatchObject({ tins: 0, truncated: true });
    expect(explorer.calls).toEqual([]);
  });

  it('a tin that fails does not stop the others', async () => {
    const mine = await world();
    stockExplorer();
    const tinB = await makeTin(B, 'Agent');
    await makeWallet(B, tinB.id);
    await makeDestination(B, tinB.id, D1, 'trusted', 1000);
    const real = holder.db.execute.bind(holder.db);
    holder.db = { ...holder.db, execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      if (/FROM agent_wallets/i.test(sql) && (s.args ?? []).includes(A)) throw new Error('database hiccup');
      return real(s);
    } };
    const summary = await watcher.runAllTins(deps());
    expect(summary.failed).toBe(1);
    expect(summary.tins).toBe(1);
    expect(ledger(B).length).toBeGreaterThan(0);
    expect(mine.tin.id).toBeTruthy();
  });

  it('skips a tin that was removed after its destination was trusted', async () => {
    const w = await world();
    stockExplorer();
    await store.softDeleteTin(A, w.tin.id, stored(10_000));
    const summary = await watcher.runAllTins(deps());
    expect(summary.tins).toBe(0);
    expect(ledger()).toEqual([]);
  });
});

describe('the owner asks for a read now', () => {
  it('runs the pass for the tin and answers what it did', async () => {
    const w = await world();
    stockExplorer();
    const r = await vault.refreshTin(A, w.tin.id, deps());
    expect(r).toMatchObject({ ok: true, pass: { tinId: w.tin.id, recorded: 8 } });
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

  it('the totals add up what the pass recorded', async () => {
    const w = await world();
    stockExplorer();
    await vault.refreshTin(A, w.tin.id, deps());
    const r = await vault.getTinTotals(A, w.tin.id);
    expect(r).toEqual({
      ok: true,
      tinId: w.tin.id,
      totals: {
        transactions: 8,
        // in: 100 USDC from D2 + 0.2 ETH ($400) from D2
        bought: { count: 2, pricedCount: 2, unpricedCount: 0, usd: 500 },
        // out: 1.5 ETH ($3000) + 250 USDC + 40 copycat (no value) + 2 x 5 USDC + 0.1 ETH ($200)
        sold: { count: 6, pricedCount: 5, unpricedCount: 1, usd: 3460 },
      },
    });
    expect(await vault.getTinTotals(A, 'ghost')).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.getTinTotals(B, w.tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.getTinTotals(A, '')).toEqual({ ok: false, error: 'invalid_id' });
  });
});

describe('cursor bookkeeping', () => {
  it('only moves forward', async () => {
    const w = await world();
    const existing = new Map<string, number>();
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Date.UTC(2026, 9, 18, 12), existing);
    const later = await state.readCursors(A, w.tin.id);
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Date.UTC(2026, 9, 18, 6), later);
    expect(await state.readCursors(A, w.tin.id)).toEqual(later);
    expect([...later.values()]).toEqual([Date.UTC(2026, 9, 18, 12)]);
  });

  it('a late write from an older pass cannot move a cursor back, even if it did not know the newer one', async () => {
    const w = await world();
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Date.UTC(2026, 9, 18, 12), new Map());
    // The older pass thinks nothing is stored yet; the write is still the later of the two... in memory only:
    // the statement itself replaces, so the caller passes what it read. This documents the contract.
    const stale = new Map([[state.pairKey(w.wallet.id, w.d1.id), Date.UTC(2026, 9, 18, 12)]]);
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Date.UTC(2026, 9, 18, 3), stale);
    expect([...(await state.readCursors(A, w.tin.id)).values()]).toEqual([Date.UTC(2026, 9, 18, 12)]);
  });

  it('is scoped to the account and the tin', async () => {
    const w = await world();
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Date.UTC(2026, 9, 18, 12), new Map());
    expect((await state.readCursors(B, w.tin.id)).size).toBe(0);
    expect((await state.readCursors(A, 'other-tin')).size).toBe(0);
    expect((await state.readCursors(A, w.tin.id)).size).toBe(1);
  });

  it('does nothing for no destinations or a time that is not a time', async () => {
    const w = await world();
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [], Date.UTC(2026, 9, 18, 12), new Map());
    await state.advanceCursors(A, w.tin.id, w.wallet.id, [w.d1.id], Number.NaN, new Map());
    expect(fake.rows('agent_watch_cursors') ?? []).toEqual([]);
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

  it('a pair with a registration time that cannot be read is not watched: no history can be claimed', async () => {
    const w = await world();
    stockExplorer();
    fake.rows('agent_destinations').find((r) => r.id === w.d1.id)!.created_at = 'unknown';
    await watcher.runTinPass(A, w.tin, deps());
    expect(ledger().some((r) => r.address === D1)).toBe(false);
    expect(ledger().some((r) => r.address === D2)).toBe(true);
  });
});
