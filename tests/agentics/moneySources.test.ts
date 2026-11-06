import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { addDecimal, groupSources, historyYears, SOURCE_RECENT, yearRange, type IncomingTransfer } from '../../src/lib/agentVault/moneySources';

/**
 * Where money came from: every transfer that reached one of an account's agents' own wallets in a year,
 * grouped by the address that sent it. Checked here: the exact sums and the grouping (pure), the years a
 * page offers, the loader (only this account, only money in, only the year, one agent or all, removed
 * agents left out), and the list as the server renders it. The database is the in-memory fake; the
 * network is off. Every address and amount is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

(globalThis as any).React = React;

const A = OWNER_TENANT_ID;
const B = '00000000-0000-4000-8000-000000000002';

describe('adding token amounts', () => {
  it('is exact for decimals a float would round', () => {
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(addDecimal('0.000000000000000001', '0.000000000000000002')).toBe('0.000000000000000003');
    expect(addDecimal('123456789012345678901234567890.5', '0.5')).toBe('123456789012345678901234567891');
    expect(addDecimal('1', '2.50')).toBe('3.5');
    expect(addDecimal('0', '0')).toBe('0');
  });

  it('counts a value that does not read as a decimal as zero, never as NaN', () => {
    expect(addDecimal('1.5', 'not a number')).toBe('1.5');
    expect(addDecimal('-1', '2')).toBe('2');
  });
});

const T0 = Date.UTC(2026, 3, 1, 9, 0, 0);
let n = 0;
function tx(o: Partial<IncomingTransfer> & { from: string }): IncomingTransfer {
  n += 1;
  return {
    id: `e${String(n).padStart(4, '0')}`,
    at: new Date(T0 + n * 60_000).toISOString(),
    tinId: 'tin-1',
    chain: 'ethereum',
    wallet: addr(1),
    amount: '1',
    asset: 'ETH',
    assetContract: null,
    usd: 10,
    hash: `0x${n.toString(16).padStart(64, '0')}`,
    registry: 'trusted',
    detail: null,
    ...o,
  };
}
const names = (o: { labels?: Array<[string, string]>; own?: Array<[string, string]> } = {}) => ({
  labels: new Map(o.labels ?? []),
  ownWallets: new Map(o.own ?? []),
  agentNames: new Map([['tin-1', 'Payout bot'], ['tin-2', 'Invoice bot']]),
});

describe('grouping by sender', () => {
  it('makes one row per address and chain, largest USD total first, with exact token sums', () => {
    const big = addr(50);
    const small = addr(51);
    const { sources, total } = groupSources(
      [
        tx({ from: small, amount: '0.1', usd: 1 }),
        tx({ from: big, amount: '0.1', usd: 300 }),
        tx({ from: big, amount: '0.2', usd: 600 }),
        tx({ from: big, amount: '5', asset: 'USDC', assetContract: addr(90), usd: 5 }),
        tx({ from: small, chain: 'polygon', amount: '7', asset: 'POL', usd: 2 }),
      ],
      names(),
    );
    expect(sources.map((s) => s.key)).toEqual([`ethereum|${big}`, `polygon|${small}`, `ethereum|${small}`]);
    expect(sources[0].usd).toEqual({ count: 3, pricedCount: 3, unpricedCount: 0, usd: 905 });
    expect(sources[0].assets).toEqual([
      { asset: 'ETH', assetContract: null, amount: '0.3' },
      { asset: 'USDC', assetContract: addr(90), amount: '5' },
    ]);
    expect(total.senders).toBe(3);
    expect(total.usd).toEqual({ count: 5, pricedCount: 5, unpricedCount: 0, usd: 908 });
  });

  it('names a sender by the account\'s own words: its own agent wallet first, then its label', () => {
    const own = addr(60);
    const labeled = addr(61);
    const { sources } = groupSources([tx({ from: own }), tx({ from: labeled }), tx({ from: addr(62) })], names({ own: [[`ethereum|${own}`, 'Treasury bot']], labels: [[`ethereum|${labeled}`, 'Client A'], [`ethereum|${own}`, 'Float']] }));
    const by = Object.fromEntries(sources.map((s) => [s.address, s]));
    expect(by[own].ownWalletOf).toBe('Treasury bot');
    expect(by[own].label).toBe('Float');
    expect(by[labeled].label).toBe('Client A');
    expect(by[labeled].ownWalletOf).toBeNull();
    expect(by[addr(62)].label).toBeNull();
  });

  it('takes the status recorded on the latest transfer, and totals what came from addresses not on the list', () => {
    const later = addr(70);
    const never = addr(71);
    const { sources, total } = groupSources(
      [tx({ from: later, registry: 'none', usd: 4 }), tx({ from: later, registry: 'trusted', usd: 6 }), tx({ from: never, registry: 'none', usd: 2.5 }), tx({ from: never, registry: 'none', usd: null })],
      names(),
    );
    const by = Object.fromEntries(sources.map((s) => [s.address, s]));
    expect(by[later].status).toBe('trusted');
    expect(by[never].status).toBe('unregistered');
    expect(total.notOnList.senders).toBe(1);
    expect(total.notOnList.usd).toEqual({ count: 2, pricedCount: 1, unpricedCount: 1, usd: 2.5 });
  });

  it('never adds a missing USD value in as zero, and counts the ones still to come apart', () => {
    const from = addr(80);
    const pendingDetail = { price: { basis: null, pending: true, coinId: 'ethereum', day: '2026-04-01' } };
    const { sources, total } = groupSources([tx({ from, usd: null, detail: pendingDetail }), tx({ from, usd: null, detail: { price: { basis: null, reason: 'no_price' } } }), tx({ from, usd: 3 })], names());
    expect(sources[0].usd).toEqual({ count: 3, pricedCount: 1, unpricedCount: 2, usd: 3 });
    expect(sources[0].pendingCount).toBe(1);
    expect(total.pendingCount).toBe(1);
    expect(sources[0].recent.filter((t) => t.pricePending)).toHaveLength(1);
  });

  it('keeps the latest transfers, newest first, the span, the agents paid, and whether it came through a contract', () => {
    const from = addr(81);
    const list = Array.from({ length: SOURCE_RECENT + 5 }, (_, i) => tx({ from, tinId: i === 3 ? 'tin-2' : 'tin-1', detail: i === 7 ? { contract: true } : null }));
    const { sources } = groupSources([...list].reverse(), names());
    const s = sources[0];
    expect(s.recent).toHaveLength(SOURCE_RECENT);
    expect(s.recent[0].id).toBe(list[list.length - 1].id);
    expect(s.recent.map((t) => t.at)).toEqual([...s.recent.map((t) => t.at)].sort().reverse());
    expect(s.firstAt).toBe(list[0].at);
    expect(s.lastAt).toBe(list[list.length - 1].at);
    expect(s.agents.sort()).toEqual(['Invoice bot', 'Payout bot']);
    expect(s.contract).toBe(true);
    expect(s.usd.count).toBe(SOURCE_RECENT + 5);
  });
});

describe('the years a page offers', () => {
  it('runs from the first agent\'s year to this year, newest first, and keeps a year that is asked for', () => {
    expect(historyYears('2024-06-01 10:00:00', 2026, null)).toEqual({ years: [2026, 2025, 2024], year: 2026 });
    expect(historyYears('2024-06-01 10:00:00', 2026, '2025')).toEqual({ years: [2026, 2025, 2024], year: 2025 });
    // A page with other history (Memory Lane) may ask for a year before the first agent.
    expect(historyYears('2026-06-01 10:00:00', 2026, '2023').year).toBe(2023);
  });

  it('falls back to the newest for a year that is not one', () => {
    for (const bad of ['2099', '1999', 'abc', '20255', '']) expect(historyYears('2025-01-01', 2026, bad).year).toBe(2026);
    expect(historyYears(null, 2026, null)).toEqual({ years: [2026], year: 2026 });
  });

  it('bounds a year in UTC, the end left out', () => {
    expect(yearRange(2026)).toEqual({ fromIso: '2026-01-01T00:00:00.000Z', toIso: '2027-01-01T00:00:00.000Z' });
  });
});

describe('the loader', () => {
  let fake: ReceivablesDbFake;
  let store: typeof import('../../src/lib/agentVault/store');
  let events: typeof import('../../src/lib/agentVault/events');
  let pages: typeof import('../../src/lib/agentVault/vaultPages');
  let seq = 0;
  let tinSeq = 0;

  beforeEach(async () => {
    vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake = createReceivablesDbFake();
    holder.db = fake;
    store = await import('../../src/lib/agentVault/store');
    events = await import('../../src/lib/agentVault/events');
    pages = await import('../../src/lib/agentVault/vaultPages');
  });

  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  async function makeTin(tenant = A, label = 'Agent') {
    tinSeq += 1;
    return store.insertTin(tenant, { label, agentKeyId: null, at: stamp(new Date(Date.UTC(2025, 0, 1, 0, 0, tinSeq))) });
  }
  async function move(tenant: string, tinId: string, o: { direction: 'in' | 'out'; at: string; from?: string; usd?: number; registry?: 'trusted' | 'none' }) {
    seq += 1;
    return events.insertTransactionEvent(tenant, {
      tinId, address: o.from ?? addr(40), chain: 'ethereum', registry: o.registry ?? 'trusted', leg: `native:${seq}`, answer: 'unknown', status: null,
      tx: { hash: `0x${seq.toString(16).padStart(64, '0')}`, direction: o.direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd: o.usd ?? 10, blockNumber: seq },
      detail: { reason: 'no_preceding_check' },
      at: o.at,
    });
  }
  const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

  it('reads only money in, only this account, only the year asked for', async () => {
    const tin = await makeTin();
    const other = await makeTin(B);
    await move(A, tin.id, { direction: 'in', at: '2026-03-01T10:00:00.000Z', from: addr(50) });
    await move(A, tin.id, { direction: 'out', at: '2026-03-02T10:00:00.000Z', from: addr(51) });
    await move(A, tin.id, { direction: 'in', at: '2025-12-31T23:59:59.999Z', from: addr(52) });
    await move(A, tin.id, { direction: 'in', at: '2027-01-01T00:00:00.000Z', from: addr(53) });
    await move(B, other.id, { direction: 'in', at: '2026-03-01T10:00:00.000Z', from: addr(54) });
    const d = await pages.loadMoneySources(A, '2026', null, NOW);
    expect(d.year).toBe(2026);
    expect(d.years).toEqual([2026, 2025]);
    expect(d.sources.map((s) => s.address)).toEqual([addr(50)]);
    const last = await pages.loadMoneySources(A, '2025', null, NOW);
    expect(last.sources.map((s) => s.address)).toEqual([addr(52)]);
  });

  it('narrows to one agent of this account, and ignores an agent that is not one', async () => {
    const one = await makeTin(A, 'One');
    const two = await makeTin(A, 'Two');
    const theirs = await makeTin(B, 'Theirs');
    await move(A, one.id, { direction: 'in', at: '2026-03-01T10:00:00.000Z', from: addr(60) });
    await move(A, two.id, { direction: 'in', at: '2026-03-01T11:00:00.000Z', from: addr(61) });
    const only = await pages.loadMoneySources(A, '2026', two.id, NOW);
    expect(only.agentId).toBe(two.id);
    expect(only.sources.map((s) => s.address)).toEqual([addr(61)]);
    const all = await pages.loadMoneySources(A, '2026', theirs.id, NOW);
    expect(all.agentId).toBeNull();
    expect(all.sources).toHaveLength(2);
    expect(all.agents.map((a) => a.label)).toEqual(['One', 'Two']);
  });

  it('names a sender from the agents\' lists and wallets, and leaves a removed agent out', async () => {
    const tin = await makeTin(A, 'Payout bot');
    const gone = await makeTin(A, 'Old bot');
    await store.insertDestination(A, { tinId: tin.id, chain: 'ethereum', address: addr(70), label: 'Client A', at: stamp(new Date(NOW)) });
    await store.insertWallet(A, { tinId: gone.id, chain: 'ethereum', address: addr(71), at: stamp(new Date(NOW)) });
    await move(A, tin.id, { direction: 'in', at: '2026-04-01T10:00:00.000Z', from: addr(70) });
    await move(A, gone.id, { direction: 'in', at: '2026-04-01T11:00:00.000Z', from: addr(72) });
    await store.softDeleteTin(A, gone.id, stamp(new Date(NOW)));
    const d = await pages.loadMoneySources(A, '2026', null, NOW);
    expect(d.agents.map((a) => a.label)).toEqual(['Payout bot']);
    expect(d.sources.map((s) => [s.address, s.label])).toEqual([[addr(70), 'Client A']]);
  });

  it('offers just this year to an account with no agents, and lists nothing', async () => {
    const d = await pages.loadMoneySources(A, null, null, NOW);
    expect(d).toMatchObject({ year: 2026, years: [2026], agents: [], sources: [], truncated: false });
  });
});

describe('the list as the server renders it', () => {
  let MoneySources: typeof import('../../src/components/agentics/MoneySources').default;
  beforeEach(async () => {
    MoneySources = (await import('../../src/components/agentics/MoneySources')).default;
  });

  const render = (data: any, base = '/dashboard/agentics/history', yearLinks = true) => renderToStaticMarkup(React.createElement(MoneySources, { data, base, yearLinks }));
  const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
  const base = (o: Partial<IncomingTransfer>[] = []) => {
    const grouped = groupSources(o.map((x) => tx({ from: addr(90), ...x })), names({ labels: [[`ethereum|${addr(91)}`, 'Client <b>A</b>']] }));
    return { year: 2026, years: [2026, 2025], agentId: null, agents: [{ id: 'tin-1', label: 'Payout bot' }, { id: 'tin-2', label: 'Invoice bot' }], ...grouped, truncated: false };
  };

  it('shows each sender with its status, total, count and latest day, largest first', () => {
    const html = render(base([{ usd: 1250.5 }, { from: addr(91), usd: 20, registry: 'none' }]));
    const t = textOf(html);
    expect(t).toContain('Where money came from');
    expect(t).toContain('Received in 2026');
    expect(t).toContain('$1,270.50 at the time');
    expect(t).toContain('Other side: trusted');
    expect(t).toContain('Other side: not on the list');
    const list = textOf(html.slice(html.indexOf('ag-sources__list')));
    expect(list.indexOf('$1,250.50')).toBeLessThan(list.indexOf('$20.00'));
    expect(html).toContain('ag-source--unlisted');
    expect(html).toContain('ag-sources__warn');
  });

  it('renders a label as text, never as markup', () => {
    const html = render(base([{ from: addr(91) }]));
    expect(html).toContain('Client &lt;b&gt;A&lt;/b&gt;');
    expect(html).not.toContain('<b>A</b>');
  });

  it('links each year and each agent on the page it is on, and leaves the years to a page with its own', () => {
    const html = render(base([{}]));
    expect(html).toContain('href="/dashboard/agentics/history?year=2025"');
    expect(html).toContain('href="/dashboard/agentics/history?year=2026&amp;agent=tin-2"');
    const lane = render(base([{}]), '/dashboard/yearEnd/memory-lane', false);
    expect(lane).not.toContain('?year=2025"');
    expect(lane).toContain('href="/dashboard/yearEnd/memory-lane?year=2026&amp;agent=tin-1"');
  });

  it('never shows $0.00 for values that are missing, and says how many are still to come', () => {
    const t = textOf(render(base([{ usd: null, detail: { price: { basis: null, pending: true, coinId: 'ethereum', day: '2026-04-01' } } }])));
    expect(t).not.toContain('$0.00');
    expect(t).toContain('No USD value on record');
    expect(t).toContain("1 with a USD value still to come: the day's rate is taken at 12:00 UTC.");
  });

  it('says plainly when there are no agents, or nothing came in that year', () => {
    expect(textOf(render({ ...base([]), agents: [] }))).toContain('No agents yet.');
    expect(textOf(render(base([])))).toContain("Nothing reached your agents' wallets in 2026.");
  });
});
