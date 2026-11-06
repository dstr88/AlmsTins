import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The Wallets page: each of an agent's own wallets with two windows, what it received and what it
 * sent, newest first, ten wallets to a page, and a CSV download beside each window. Checked here: the
 * read of one wallet in one direction (only this account's agent and that agent's wallet; the same
 * address on two chains is two wallets), its paging, the download (oldest first, a formula kept as
 * text, the file named without an address), the page loader, the endpoint, and the page as the server
 * renders it. The database is the in-memory fake; the session is replaced; the network is off.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const mem = vi.hoisted(() => ({ session: null as null | { tenantId: string } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

(globalThis as any).React = React;

const A = OWNER_TENANT_ID;
const B = '00000000-0000-4000-8000-000000000002';
const W = addr(1);

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let vault: typeof import('../../src/lib/agentVault/vault');
let csv: typeof import('../../src/lib/agentVault/walletCsv');
let pages: typeof import('../../src/lib/agentVault/vaultPages');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  mem.session = { tenantId: A };
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  vault = await import('../../src/lib/agentVault/vault');
  csv = await import('../../src/lib/agentVault/walletCsv');
  pages = await import('../../src/lib/agentVault/vaultPages');
});

const at = (n: number) => new Date(Date.UTC(2026, 9, 18, 6, 0, n)).toISOString();
let tinSeq = 0;
async function makeTin(tenant = A, label = 'Agent') {
  tinSeq += 1;
  return store.insertTin(tenant, { label, agentKeyId: null, at: new Date(Date.UTC(2026, 8, 1, 0, 0, tinSeq)).toISOString().slice(0, 19).replace('T', ' ') });
}
let walletSeq = 0;
/** Each wallet a second after the last, so the order they were added in is the order they are listed in. */
async function makeWallet(tenant: string, tinId: string, address = W, chain: 'ethereum' | 'polygon' | 'avalanche' = 'ethereum') {
  walletSeq += 1;
  const when = new Date(Date.UTC(2026, 9, 1, 0, 0, walletSeq)).toISOString().slice(0, 19).replace('T', ' ');
  return (await store.insertWallet(tenant, { tinId, chain, address, at: when })).wallet;
}
let seq = 0;
async function move(tenant: string, tinId: string, o: { direction: 'in' | 'out'; n: number; wallet?: string; chain?: 'ethereum' | 'polygon'; other?: string; asset?: string; usd?: number | null; registry?: 'trusted' | 'none' }) {
  seq += 1;
  return events.insertTransactionEvent(tenant, {
    tinId, address: o.other ?? addr(40), chain: o.chain ?? 'ethereum', registry: o.registry ?? 'trusted', leg: `native:${seq}`, answer: 'unknown', status: null,
    tx: { hash: `0x${seq.toString(16).padStart(64, '0')}`, direction: o.direction, wallet: o.wallet ?? W, amount: `${o.n}`, asset: o.asset ?? 'ETH', assetContract: null, usd: o.usd === undefined ? o.n * 10 : o.usd, blockNumber: seq },
    detail: { reason: 'no_preceding_check' },
    at: at(o.n),
  });
}

describe('one wallet, one direction', () => {
  it('holds only what that wallet received, or only what it sent, newest first', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    for (let i = 1; i <= 3; i += 1) await move(A, tin.id, { direction: 'in', n: i });
    for (let i = 4; i <= 5; i += 1) await move(A, tin.id, { direction: 'out', n: i });
    const got = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'in' });
    expect(got.ok && got.events.map((e) => e.tx?.amount)).toEqual(['3', '2', '1']);
    const sent = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'out' });
    expect(sent.ok && sent.events.map((e) => [e.tx?.direction, e.tx?.amount])).toEqual([['out', '5'], ['out', '4']]);
  });

  it('keeps the same address on two chains apart, and another wallet\'s transfers out', async () => {
    const tin = await makeTin();
    const eth = await makeWallet(A, tin.id, W, 'ethereum');
    const pol = await makeWallet(A, tin.id, W, 'polygon');
    await move(A, tin.id, { direction: 'in', n: 1, chain: 'ethereum' });
    await move(A, tin.id, { direction: 'in', n: 2, chain: 'polygon' });
    await move(A, tin.id, { direction: 'in', n: 3, wallet: addr(2) });
    const a = await vault.listWalletWindow(A, { tinId: tin.id, walletId: eth.id, direction: 'in' });
    const b = await vault.listWalletWindow(A, { tinId: tin.id, walletId: pol.id, direction: 'in' });
    expect(a.ok && a.events.map((e) => e.tx?.amount)).toEqual(['1']);
    expect(b.ok && b.events.map((e) => e.tx?.amount)).toEqual(['2']);
  });

  it('pages by cursor without a gap or a repeat', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    for (let i = 1; i <= 7; i += 1) await move(A, tin.id, { direction: 'in', n: i });
    const seen: string[] = [];
    let before: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const p = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'in', limit: 3, before });
      if (!p.ok) throw new Error(p.error);
      seen.push(...p.events.map((e) => e.tx!.amount));
      if (!p.next) break;
      before = p.next;
    }
    expect(seen).toEqual(['7', '6', '5', '4', '3', '2', '1']);
  });

  it('opens with 25 rows, and a limit is capped', async () => {
    expect(vault.WALLET_WINDOW_PAGE).toBe(25);
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    for (let i = 1; i <= 27; i += 1) await move(A, tin.id, { direction: 'out', n: i });
    const first = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'out' });
    expect(first.ok && first.events).toHaveLength(25);
    expect(first.ok && first.next).toBeTruthy();
  });

  it('refuses what it cannot trust, and another account\'s agent or wallet is not found', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    const other = await makeTin(A, 'Other');
    const theirs = await makeTin(B, 'Theirs');
    const theirWallet = await makeWallet(B, theirs.id);
    const ask = (o: Record<string, unknown>) => vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'in', ...o });
    expect(await ask({ tinId: '' })).toEqual({ ok: false, error: 'invalid_id' });
    expect(await ask({ walletId: null })).toEqual({ ok: false, error: 'invalid_id' });
    for (const direction of ['IN', 'both', '', null, 1]) expect(await ask({ direction }), String(direction)).toEqual({ ok: false, error: 'invalid_format' });
    expect(await ask({ before: 'not-a-cursor' })).toEqual({ ok: false, error: 'invalid_cursor' });
    expect(await ask({ tinId: theirs.id })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await ask({ walletId: theirWallet.id })).toEqual({ ok: false, error: 'wallet_not_found' });
    expect(await ask({ tinId: other.id })).toEqual({ ok: false, error: 'wallet_not_found' });
  });

  it('shows a value that came in later from the day\'s price', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    seq += 1;
    await events.insertTransactionEvent(A, {
      tinId: tin.id, address: addr(40), chain: 'ethereum', registry: 'trusted', leg: `native:${seq}`, answer: 'unknown', status: null,
      tx: { hash: `0x${seq.toString(16).padStart(64, '0')}`, direction: 'in', wallet: W, amount: '0.5', asset: 'ETH', assetContract: null, usd: null, blockNumber: seq },
      detail: { price: { basis: null, pending: true, coinId: 'ethereum', day: '2026-10-18' } },
      at: at(1),
    });
    const before = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'in' });
    expect(before.ok && before.events[0].tx?.usd).toBeNull();
    const prices = await import('../../src/lib/agentVault/dailyPrices');
    await prices.writeDailyPrice('ethereum', '2026-10-18', { status: 'priced', unitUsd: 2000 });
    const after = await vault.listWalletWindow(A, { tinId: tin.id, walletId: w.id, direction: 'in' });
    expect(after.ok && after.events[0].tx?.usd).toBe(1000);
  });
});

describe('the download beside a window', () => {
  it('is every transfer in the window, oldest first, with the export\'s values', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    await move(A, tin.id, { direction: 'out', n: 1, registry: 'none' });
    await move(A, tin.id, { direction: 'out', n: 2 });
    await move(A, tin.id, { direction: 'in', n: 3 });
    const r = await csv.walletWindowCsv(A, { tinId: tin.id, walletId: w.id, direction: 'out' });
    if (!r.ok) throw new Error(r.error);
    expect(r.csv.startsWith('﻿')).toBe(true);
    const lines = r.csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(csv.WALLET_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    const cell = (line: string, col: string) => line.split(',')[csv.WALLET_CSV_COLUMNS.indexOf(col as never)];
    expect(lines.slice(1).map((l) => cell(l, 'amount'))).toEqual(['1', '2']);
    expect(lines.slice(1).map((l) => cell(l, 'direction'))).toEqual(['sent', 'sent']);
    expect(cell(lines[1], 'counterparty')).toBe('unregistered');
    expect(cell(lines[1], 'unmatched')).toBe('true');
    expect(cell(lines[2], 'counterparty')).toBe('trusted');
    expect(cell(lines[2], 'usd')).toBe('20');
    expect(cell(lines[2], 'usd_pending')).toBe('false');
    expect(r).toMatchObject({ chain: 'ethereum', direction: 'out', rows: 2 });
  });

  it('keeps a token symbol that reads like a formula as text', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    await move(A, tin.id, { direction: 'in', n: 1, asset: '=HYPERLINK("x")' });
    const r = await csv.walletWindowCsv(A, { tinId: tin.id, walletId: w.id, direction: 'in' });
    if (!r.ok) throw new Error(r.error);
    expect(r.csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('a window with nothing in it is the header alone', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id, W, 'polygon');
    const r = await csv.walletWindowCsv(A, { tinId: tin.id, walletId: w.id, direction: 'in' });
    expect(r).toMatchObject({ ok: true, chain: 'polygon', rows: 0 });
    if (r.ok) expect(r.csv).toBe(`﻿${csv.WALLET_CSV_COLUMNS.join(',')}\r\n`);
  });

  it('is named for what it is, the chain, the direction and the day, never an address', () => {
    expect(csv.walletCsvFileName('ethereum', 'in', '2026-10-18')).toBe('almstins-agent-wallet-ethereum-received-2026-10-18.csv');
    expect(csv.walletCsvFileName('polygon', 'out', '2026-10-18')).toBe('almstins-agent-wallet-polygon-sent-2026-10-18.csv');
    expect(csv.MAX_WALLET_CSV_ROWS).toBe(50_000);
  });

  it('goes through the same checks as a window', async () => {
    const theirs = await makeTin(B, 'Theirs');
    const theirWallet = await makeWallet(B, theirs.id);
    expect(await csv.walletWindowCsv(A, { tinId: theirs.id, walletId: theirWallet.id, direction: 'in' })).toEqual({ ok: false, error: 'tin_not_found' });
  });
});

describe('the page', () => {
  it('puts ten wallets on a page, in the order the agents and their wallets were added', async () => {
    const one = await makeTin(A, 'One');
    const two = await makeTin(A, 'Two');
    for (let i = 0; i < 5; i += 1) await makeWallet(A, one.id, addr(100 + i));
    for (let i = 0; i < 7; i += 1) await makeWallet(A, two.id, addr(200 + i));
    const p1 = await pages.loadWalletsPage(A, null);
    expect(p1).toMatchObject({ page: 1, pages: 2, total: 12, first: 1 });
    expect(p1.wallets.map((b) => b.agent.label)).toEqual([...Array(5).fill('One'), ...Array(5).fill('Two')]);
    const p2 = await pages.loadWalletsPage(A, '2');
    expect(p2).toMatchObject({ page: 2, first: 11 });
    expect(p2.wallets.map((b) => b.wallet.address)).toEqual([addr(205), addr(206)]);
    expect(p2.wallets[0].received).toEqual({ rows: [], next: null });
  });

  it('reads a page number it can trust, and a page past the last is the last', () => {
    expect(pages.pageOf('3', 5)).toBe(3);
    for (const odd of [null, '', '0', '-1', '2.5', 'x', '1e3', ' 2']) expect(pages.pageOf(odd, 5), String(odd)).toBe(1);
    expect(pages.pageOf('99', 5)).toBe(5);
    expect(pages.pageOf('4', 0)).toBe(1);
  });

  it('names the other side of a row by the agent\'s label for that address, on that chain', async () => {
    const tin = await makeTin();
    await makeWallet(A, tin.id);
    const d = await store.insertDestination(A, { tinId: tin.id, chain: 'ethereum', address: addr(40), label: 'Supplier', at: '2026-10-01 00:00:00' });
    expect(d.kind).toBe('inserted');
    const page = await pages.loadWalletsPage(A, null);
    expect(page.wallets[0].labels).toEqual({ [`ethereum|${addr(40)}`]: 'Supplier' });
  });

  it('never shows another account\'s wallets', async () => {
    const theirs = await makeTin(B, 'Theirs');
    await makeWallet(B, theirs.id);
    expect(await pages.loadWalletsPage(A, null)).toMatchObject({ total: 0, first: 0, wallets: [] });
  });
});

describe('the endpoint', () => {
  const get = async (query: string) => {
    const route = await import('../../src/pages/api/agentics/wallet-transfers');
    const url = new URL(`https://almstins.test/api/agentics/wallet-transfers?${query}`);
    return (route.GET as any)({ request: new Request(url), url });
  };

  it('answers anyone but the owner with a plain 404 and reads nothing', async () => {
    mem.session = null;
    const r = await get('tinId=x&walletId=y&direction=in');
    expect(r.status).toBe(404);
    mem.session = { tenantId: B };
    expect((await get('tinId=x&walletId=y&direction=in')).status).toBe(404);
  });

  it('gives a page as JSON, and the whole window as a CSV attachment named without an address', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    await move(A, tin.id, { direction: 'in', n: 1 });
    const page = await get(`tinId=${tin.id}&walletId=${w.id}&direction=in`);
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body).toMatchObject({ ok: true, next: null });
    expect(body.events).toHaveLength(1);
    const file = await get(`tinId=${tin.id}&walletId=${w.id}&direction=in&format=csv`);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(file.headers.get('Cache-Control')).toBe('private, no-store');
    expect(file.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-agent-wallet-ethereum-received-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(file.headers.get('Content-Disposition')).not.toContain(W);
  });

  it('refuses with codes: a bad direction or format, an unknown wallet', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    expect((await (await get(`tinId=${tin.id}&walletId=${w.id}&direction=sideways`)).json()).error).toBe('invalid_format');
    expect((await get(`tinId=${tin.id}&walletId=${w.id}&direction=in&format=xlsx`)).status).toBe(400);
    const missing = await get(`tinId=${tin.id}&walletId=nope&direction=in`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('wallet_not_found');
  });

  it('a download has a budget: the seventh in a minute is told to wait', async () => {
    const tin = await makeTin();
    const w = await makeWallet(A, tin.id);
    const q = `tinId=${tin.id}&walletId=${w.id}&direction=in&format=csv`;
    for (let i = 0; i < 6; i += 1) expect((await get(q)).status).toBe(200);
    const seventh = await get(q);
    expect(seventh.status).toBe(429);
    expect(seventh.headers.get('Retry-After')).toBe('60');
  });
});

describe('the page as the server renders it', () => {
  const render = async (data: import('../../src/lib/agentVault/vaultPages').WalletsPageData) => {
    const mod = await import('../../src/components/agentics/WalletWindows');
    return renderToStaticMarkup(React.createElement(mod.default, { data }));
  };

  it('gives each wallet a Received and a Sent window, each with its own download and expand control, named for the wallet', async () => {
    const tin = await makeTin(A, '<b>Agent</b>');
    await makeWallet(A, tin.id);
    await move(A, tin.id, { direction: 'in', n: 1, other: addr(41), asset: '<img src=x>' });
    await move(A, tin.id, { direction: 'out', n: 2, other: addr(42), usd: 0.0003, registry: 'none' });
    const html = await render(await pages.loadWalletsPage(A, null));
    const short = (await import('../../src/lib/addressDisplay')).shortenAddress(W);
    expect(html).toContain('>Received</h3>');
    expect(html).toContain('>Sent</h3>');
    expect(html).toContain(`aria-label="Download what ${short} received, as a CSV"`);
    expect(html).toContain(`aria-label="Download what ${short} sent, as a CSV"`);
    expect((html.match(/aria-expanded="false"/g) ?? []).length).toBe(2);
    expect(html).toContain(`aria-label="What ${short} received"`);
    expect(html).toContain('Under one US cent at the time');
    expect(html).toContain('Unmatched');
    // Text from the registry and the chain comes out escaped.
    expect(html).not.toContain('<b>Agent</b>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    // Every class is Agentics', and each row opens with a native disclosure.
    for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/).filter(Boolean)) expect(c, c).toMatch(/^ag-/);
    expect((html.match(/<details>/g) ?? []).length).toBe(2);
  });

  it('says so when there is no wallet, and pages with plain links', async () => {
    expect(await render(await pages.loadWalletsPage(A, null))).toContain('No wallets yet.');
    const one = await makeTin(A, 'One');
    for (let i = 0; i < 11; i += 1) await makeWallet(A, one.id, addr(300 + i));
    const html = await render(await pages.loadWalletsPage(A, null));
    expect(html).toContain('Wallets 1 to 10 of 11');
    expect(html).toContain('href="/dashboard/agentics/wallets?page=2"');
    expect(html).not.toContain('Previous page');
    const second = await render(await pages.loadWalletsPage(A, '2'));
    expect(second).toContain('href="/dashboard/agentics/wallets"');
    expect(second).toContain('Wallets 11 to 11 of 11');
  });
});

describe('the links and the download in the browser', () => {
  it('builds each address from encoded parts, and the first page has no query', async () => {
    const paths = await import('../../src/components/agentics/paths');
    expect(paths.walletsHref(1)).toBe('/dashboard/agentics/wallets');
    expect(paths.walletsHref(3)).toBe('/dashboard/agentics/wallets?page=3');
    expect(paths.walletWindowUrl({ tinId: 'a&b', walletId: 'c/d', direction: 'in' })).toBe('/api/agentics/wallet-transfers?tinId=a%26b&walletId=c%2Fd&direction=in');
    expect(paths.walletWindowUrl({ tinId: 't', walletId: 'w', direction: 'out', before: 'x|y' })).toBe('/api/agentics/wallet-transfers?tinId=t&walletId=w&direction=out&before=x%7Cy');
    expect(paths.walletWindowUrl({ tinId: 't', walletId: 'w', direction: 'out', before: 'x', csv: true })).toBe('/api/agentics/wallet-transfers?tinId=t&walletId=w&direction=out&format=csv');
  });

  it('a refused or dropped download ends in the page\'s own words, never a thrown error', async () => {
    const dl = await import('../../src/components/agentics/exportDownload');
    const { copy } = await import('../../src/components/agentics/copy');
    const refused = (status: number, error: string) => (async () => new Response(JSON.stringify({ ok: false, error }), { status })) as unknown as typeof fetch;
    expect(await dl.requestWalletCsv('/x', 'f.csv', refused(413, 'export_too_large'))).toEqual({ ok: false, message: copy.walletsPage.errors.export_too_large });
    expect(await dl.requestWalletCsv('/x', 'f.csv', refused(429, 'rate_limited'))).toEqual({ ok: false, message: copy.errors.rate_limited });
    expect(await dl.requestWalletCsv('/x', 'f.csv', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual({ ok: false, message: copy.errors.network });
    const file = (async () => new Response('a,b\r\n', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="almstins-agent-wallet-ethereum-sent-2026-10-18.csv"' } })) as unknown as typeof fetch;
    expect(await dl.requestWalletCsv('/x', 'f.csv', file)).toMatchObject({ ok: true, filename: 'almstins-agent-wallet-ethereum-sent-2026-10-18.csv' });
    const odd = (async () => new Response('a', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="../../x.csv"' } })) as unknown as typeof fetch;
    expect(await dl.requestWalletCsv('/x', 'f.csv', odd)).toMatchObject({ ok: true, filename: 'f.csv' });
  });
});
