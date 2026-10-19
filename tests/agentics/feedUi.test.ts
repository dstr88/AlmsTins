import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { addr } from '../helpers/agentVault';
import { brightLineViolations } from '../helpers/brightLineWording';
import { copy } from '../../src/components/agentics/copy';
import { FEED_PATH, HOME_PATH } from '../../src/components/agentics/paths';
import { toFeedRow, type FeedRow } from '../../src/components/agentics/feedRows';
import type { FeedPageData } from '../../src/lib/agentVault/vaultPages';

/**
 * The live feed page, rendered the way the server renders it: the rows it opens with, the controls, the words.
 * What the timers and the polling do is covered where it can be, in the tests of the pure logic they run
 * (feedPlayer, feedPoller and feedReader); the built server is exercised in a browser by hand. What matters
 * here: everything that came from the ledger, the chain or the owner is escaped text (hostile text is rendered
 * to prove it); every control has a label; every class and link is real; the honest sentences about timing and
 * about what is read are on the page; and a card for each kind of row says what it should.
 */
let FeedPage: typeof import('../../src/components/agentics/FeedPage').default;
let StageCard: typeof import('../../src/components/agentics/FeedPage').StageCard;
let LedgerItem: typeof import('../../src/components/agentics/LedgerPanel').LedgerItem;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  const mod = await import('../../src/components/agentics/FeedPage');
  FeedPage = mod.default;
  StageCard = mod.StageCard;
  LedgerItem = (await import('../../src/components/agentics/LedgerPanel')).LedgerItem;
});

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const classes = (html: string) => [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean));
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const HOSTILE = '"><script>alert(1)</script><img src=x onerror=alert(2)> & \'quoted\'';

// Events as the feed's answer carries them (plain data); the page checks what it reads, so the type is left open here.
const ev = (over: Record<string, unknown> = {}): any => ({
  id: '00000000-0000-4000-8000-000000000001', tinId: 'tin-1', kind: 'checked', at: '2026-10-19T11:00:00.000Z', address: addr(1), chain: null, answer: 'unknown',
  registry: 'none', status: 'unknown', keyId: null, keyStatus: null, tx: null, detail: { basis: 'not_in_registry' }, writtenAt: '2026-10-19 11:00:01',
  agent: 'Treasury agent', label: null, ...over,
});
const tx = (over: Record<string, unknown> = {}) => ({ hash: `0x${'ab'.repeat(32)}`, direction: 'out', wallet: addr(9), amount: '1.5', asset: 'ETH', assetContract: null, usd: 4200, blockNumber: 7, ...over });
const FREE = { plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 4 } } as never;
const data = (over: Partial<FeedPageData> = {}): FeedPageData => ({
  plan: FREE,
  agents: [{ id: 'tin-1', label: 'Treasury agent' }, { id: 'tin-2', label: 'Payroll agent' }],
  initial: { events: [], since: '1970-01-01 00:00:00' },
  ...over,
});
const row = (over: Record<string, unknown> = {}) => toFeedRow(ev(over)) as FeedRow;
const page = (d: FeedPageData = data()) => render(React.createElement(FeedPage, { data: d }));

describe('the page as the server renders it', () => {
  it('opens with its title, what it shows, its state, an empty stage and a list', () => {
    const html = page(data({ initial: { events: [ev({ label: 'Exchange deposit' }), ev({ id: '00000000-0000-4000-8000-000000000002', address: addr(2), writtenAt: '2026-10-19 11:00:02' })], since: '2026-10-19 11:00:02' } }));
    const t = textOf(html);
    expect(html).toMatch(/<h1 class="ag-title">Live<\/h1>/);
    expect(t).toContain(copy.feed.lede);
    expect(t).toContain('Live');
    expect(t).toContain(copy.feed.idle);
    expect(t).toContain('Treasury agent');
    expect(t).toContain('Your label: Exchange deposit');
    expect(t).toContain(addr(1));
    expect(t).toContain(addr(2));
    // The newest row is first.
    expect(html.indexOf(addr(2))).toBeLessThan(html.indexOf(addr(1)));
  });

  it('says the two honest things: when a transfer shows, and what is read and when', () => {
    const t = textOf(page());
    expect(t).toContain('about 1 minute on Avalanche, 3 on Ethereum and 10 on Polygon');
    expect(t).toContain(copy.feed.readHint);
    expect(t).toContain('Only the wallets you added are read');
    expect(t).toContain('Nothing is read when this page is closed or in the background');
  });

  it('has the controls: the agent filter, pause, and the switch for reading wallets, on by default', () => {
    const html = page();
    expect(html).toMatch(/<label class="ag-field">Agent<select class="ag-select"[^>]*><option value="" selected="">All agents<\/option><option value="tin-1">Treasury agent<\/option><option value="tin-2">Payroll agent<\/option><\/select><\/label>/);
    // The label says what pressing it does, and it is not also a pressed/unpressed toggle.
    expect(html).toMatch(/<button class="ag-btn" type="button">Pause the cards<\/button>/);
    expect(html).not.toContain('aria-pressed');
    expect(html).toMatch(/<label class="ag-check"><input type="checkbox" checked=""\/><span>Read my agents&#x27; wallets while this page is open<\/span><\/label>/);
    // "Read the chain now" needs an agent chosen, and none is.
    expect(textOf(html)).not.toContain(copy.ledger.readButton);
  });

  it('keeps the stage out of the screen reader\'s way and announces the state and the wallet reads politely', () => {
    const html = page(data({ initial: { events: [ev()], since: '2026-10-19 11:00:01' } }));
    expect(html).toContain('<div class="ag-feed__stage" aria-live="off">');
    // The state is announced; the time of the last update, which changes every few seconds, is not (it is outside the live region).
    expect(html).toMatch(/<p class="ag-feed__state"><span class="ag-feed__dot ag-feed__dot--live" aria-hidden="true"><\/span><span role="status">Live<\/span><\/p>/);
    // A wallet read about once a minute is plain text; only a failure is a live region.
    expect(html).toContain(`<p class="ag-hint">${copy.feed.reader.waiting}</p>`);
    const src = read('src/components/agentics/FeedPage.tsx');
    expect(src).toContain("role={readState === 'failing' || readState === 'closed' ? 'status' : undefined}");
    expect(src).toMatch(/<span role="status">\{copy\.feed\.state\[conn\]\}<\/span>\s*\{lastGood \? <span>/);
    expect(html).toMatch(/<ol class="ag-events" aria-label="Latest rows from your agents, most recently recorded first">/);
  });

  it('says so when nothing has been recorded', () => {
    expect(textOf(page())).toContain(copy.feed.empty);
    expect(page()).not.toContain('ag-events');
  });

  it('with no agent at all, says to add one, and links to the agents page', () => {
    const html = page(data({ agents: [] }));
    expect(textOf(html)).toContain(copy.feed.noAgents);
    expect(hrefs(html)).toEqual([HOME_PATH]);
    expect(html).not.toContain('ag-feed__stage');
    expect(html).not.toContain('<select');
  });

  it('shows every row as text, escaped: an agent\'s name, a label and an asset\'s symbol can say anything', () => {
    const html = page(data({ initial: { events: [
      ev({ agent: HOSTILE, label: HOSTILE }),
      ev({ id: '00000000-0000-4000-8000-000000000002', kind: 'transaction', chain: 'ethereum', tx: tx({ asset: HOSTILE }), writtenAt: '2026-10-19 11:00:02', agent: HOSTILE }),
    ], since: '2026-10-19 11:00:02' } }));
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img\b/);
    // No tag carries an event handler. (The hostile text says "onerror=" too, but as escaped text, outside any tag.)
    for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) expect(tag[0], tag[0]).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(textOf(html)).toContain(HOSTILE);
  });

  it('gives every control a label, every class to Agentics\' stylesheet, and every link a real destination', () => {
    const css = read('src/components/agentics/agentics.css');
    const defined = new Set([...css.matchAll(/\.(ag-[\w-]+)/g)].map((m) => m[1]));
    const html = page(data({ initial: { events: [ev({ kind: 'transaction', chain: 'ethereum', tx: tx(), label: 'Exchange' })], since: '2026-10-19 11:00:01' } }));
    for (const c of classes(html)) expect(defined.has(c), `${c} is not in agentics.css`).toBe(true);
    for (const h of hrefs(html)) expect(h, h).toMatch(/^https:\/\/etherscan\.io\/tx\/0x[0-9a-f]{64}$/);
    // Every field and button has a name: inside a label, or its own text.
    const bare = html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g, '');
    expect([...bare.matchAll(/<(input|select|textarea)\b/g)]).toEqual([]);
    for (const b of html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)) expect(b[1].trim().length).toBeGreaterThan(0);
  });
});

describe('the list under the stage', () => {
  const events = [
    ev({ id: '00000000-0000-4000-8000-000000000001', writtenAt: '2026-10-19 11:00:01' }),
    ev({ id: '00000000-0000-4000-8000-000000000002', kind: 'transaction', chain: 'ethereum', tx: tx(), at: '2026-10-19T08:15:30.000Z', writtenAt: '2026-10-19 11:00:41' }),
  ];

  it('says when each row was recorded, and lists them most recently recorded first, whatever time the event itself carries', () => {
    const html = page(data({ initial: { events, since: '2026-10-19 11:00:41' } }));
    const t = textOf(html);
    expect(t).toContain('Recorded 11:00:01 UTC');
    expect(t).toContain('Recorded 11:00:41 UTC');
    expect(t.indexOf('Recorded 11:00:41 UTC')).toBeLessThan(t.indexOf('Recorded 11:00:01 UTC'));
    expect(html).toContain('most recently recorded first');
  });

  it('is the only place that line is: the ledger page\'s own rows carry no "Recorded" line', () => {
    const r = row({ writtenAt: '2026-10-19 11:00:01' });
    expect(textOf(render(React.createElement(LedgerItem, { row: r })))).not.toContain('Recorded');
    expect(textOf(render(React.createElement(LedgerItem, { row: r, recorded: r.writtenAt })))).toContain('Recorded 11:00:01 UTC');
  });
});

describe('a card on the stage', () => {
  const card = (r: FeedRow) => render(React.createElement(StageCard, { card: { kind: 'row', row: r } }));

  it('for a transfer: the time it was recorded at the top, and the time of its block on a line of its own; a check has no such line', () => {
    const t = textOf(card(row({ kind: 'transaction', chain: 'ethereum', tx: tx(), at: '2026-10-19T08:15:30.000Z', writtenAt: '2026-10-19 11:00:41' })));
    expect(t).toContain('11:00:41 UTC');
    expect(t).toContain('On the chain at 08:15:30 UTC');
    expect(textOf(card(row()))).not.toContain('On the chain');
  });

  it('for a check: the agent, what it asked about (the owner\'s label, else a short address), the answer and why', () => {
    const html = card(row({ label: 'Exchange deposit', answer: 'proven', registry: 'trusted', detail: { basis: 'domain_proof' } }));
    const t = textOf(html);
    expect(t).toContain('Checked');
    expect(t).toContain('Answer: Proven');
    // The time on a card is when the Vault RECORDED the row (11:00:01), not when it happened (11:00:00).
    expect(t).toContain('11:00:01 UTC');
    expect(t).not.toContain('11:00:00 UTC');
    expect(t).toContain('Treasury agent');
    expect(html).toMatch(/<p class="ag-feed__big">Exchange deposit<\/p>/);
    expect(t).toContain('0xc0ffee');
    expect(t).not.toContain(addr(1)); // a card holds the short form; the list holds the whole address
    expect(html).toContain('class="ag-pill ag-pill--gain"');
    expect(html).not.toContain('ag-feed__card--flag');
  });

  it('for a check about an address with no label: the short address, once', () => {
    const t = textOf(card(row()));
    expect(t).toContain('Answer: Unknown');
    expect((t.match(/0xc0ffee/g) ?? []).length).toBe(1);
  });

  it('for funds that left the agent\'s wallet: sold, the exact amount and asset, the dollars at the time, and where', () => {
    const t = textOf(card(row({ kind: 'transaction', chain: 'ethereum', tx: tx(), label: 'Exchange deposit' })));
    expect(t).toContain('Sold (out)');
    expect(t).toContain('1.5 ETH');
    expect(t).toContain('$4,200.00 at the time');
    expect(t).toContain('Exchange deposit · ');
  });

  it('for funds that reached it: bought; and with no price it says there is none, never $0', () => {
    const t = textOf(card(row({ kind: 'transaction', chain: 'polygon', tx: tx({ direction: 'in', usd: null, asset: 'POL' }) })));
    expect(t).toContain('Bought (in)');
    expect(t).toContain('1.5 POL');
    expect(t).toContain('No USD value on record');
    expect(t).not.toContain('$0');
  });

  it('marks a flagged check in red, with the word as well as the color', () => {
    const html = card(row({ answer: 'flagged', registry: 'flagged', detail: { basis: 'registry_flagged' } }));
    expect(html).toContain('ag-feed__card ag-feed__card--flag');
    expect(textOf(html)).toContain('Answer: Flagged');
    expect(html).toContain('ag-pill ag-pill--bad');
  });

  it('a card that folds a burst says how many checks, and where the rest are', () => {
    const t = textOf(render(React.createElement(StageCard, { card: { kind: 'folded', count: 12 } })));
    expect(t).toBe(' 12 more checks, in the list below ');
    expect(textOf(render(React.createElement(StageCard, { card: { kind: 'folded', count: 1 } })))).toContain('1 more check, in the list below');
  });

  it('shows a row without an answer as such, not as a pass', () => {
    const t = textOf(card(row({ answer: null })));
    expect(t).toContain('No answer recorded');
  });
});

describe('the words', () => {
  const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : typeof v === 'function' ? [] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  const fns = copy.feed;
  const all = [
    ...strings(copy.feed),
    fns.lastUpdate('11:00:00'), fns.waitingMore(3), fns.folded(1), fns.folded(7), fns.skipped(1), fns.skipped(4), fns.reader.readOf('Treasury agent', '11:00:00'),
  ];

  it('keep to the product\'s verbs: nothing that stops a payment, no British spellings, no profit or loss, nothing called safe', () => {
    expect(all.length).toBeGreaterThan(30);
    for (const s of all) {
      expect(brightLineViolations(s), s).toEqual([]);
      expect(s, s).not.toMatch(/\b(blocked|stopped|halted|rejected|refused)\b/i);
      expect(s, s).not.toMatch(/cost[ -]basis|capital gain|realized|\bP\/L\b|\bprofit|\bloss\b|\bnet\b/i);
      if (/\bsafe\b/i.test(s)) expect(s, s).toMatch(/\b(never|not|no)\b/i);
    }
  });

  it('never say the Vault watches or monitors anything but the owner\'s own wallets, and never a receiving address', () => {
    for (const s of all) {
      expect(s, s).not.toMatch(/\b(watch(es|ing)?|monitor(s|ing)?|track(s|ing)?)\b/i);
      expect(s, s).not.toMatch(/\b(receiving|destination) (wallet|address)/i);
    }
    expect(copy.feed.readHint).toContain('wallets you added');
  });

  it('say the waits the watcher keeps before it records a transfer: the numbers are read from the code, so the two cannot drift', () => {
    const lag = /CONFIRMATION_LAG_S: Readonly<Record<VaultChain, number>> = \{ ethereum: (\d+), polygon: (\d+), avalanche: (\d+) \}/.exec(read('src/lib/agentVault/watcher.ts'));
    expect(lag, 'the watcher no longer has CONFIRMATION_LAG_S in this form').not.toBeNull();
    const minutes = (seconds: string) => Math.round(Number(seconds) / 60);
    const [, ethereum, polygon, avalanche] = lag!;
    expect(copy.feed.timing).toContain(`about ${minutes(avalanche)} minute on Avalanche, ${minutes(ethereum)} on Ethereum and ${minutes(polygon)} on Polygon`);
    // And "about once a minute" is what the numbers add up to: a pause after a read, plus a read that takes at most twenty seconds.
    const pause = Number(/LIVE_READ_PAUSE_MS = ([\d_]+)/.exec(read('src/lib/agentVault/liveRead.ts'))![1].replace(/_/g, ''));
    const deadline = Number(/REFRESH_DEADLINE_MS = ([\d_]+)/.exec(read('src/lib/agentVault/vault.ts'))![1].replace(/_/g, ''));
    expect(pause + deadline).toBeLessThanOrEqual(60_000);
    expect(copy.feed.readHint).toContain('About once a minute');
  });

  it('promise nothing about speed that the Vault does not keep: no "instant", "real time" or "live" for a transfer', () => {
    for (const s of all) expect(s, s).not.toMatch(/\b(instant(ly)?|real[- ]time|immediately)\b/i);
  });
});

describe('where it lives', () => {
  it('has a page at the address the bar links to, owner-only, with the fixed title', () => {
    expect(FEED_PATH).toBe('/dashboard/agentics/feed');
    expect(existsSync(path.join(ROOT, 'src/pages/dashboard/agentics/feed.astro'))).toBe(true);
    const page = read('src/pages/dashboard/agentics/feed.astro');
    expect(page).toMatch(/<AgenticsShell title="Live" active="feed" plan=\{feed\.plan\}>/);
    expect(page).toMatch(/<FeedPage client:load data=\{feed\} \/>/);
  });

  it('is in the bar between the agents and the reports, and marks itself as the current page', () => {
    const shell = read('src/components/agentics/AgenticsShell.astro');
    expect(shell).toMatch(/\{vault && <a href=\{FEED_PATH\} aria-current=\{active === 'feed' \? 'page' : undefined\}>\{copy\.nav\.live\}<\/a>\}/);
    expect(shell.indexOf('copy.nav.agents')).toBeLessThan(shell.indexOf('copy.nav.live'));
    expect(shell.indexOf('copy.nav.live')).toBeLessThan(shell.indexOf('copy.nav.reports'));
    expect(copy.nav.live).toBe('Live');
  });

  it('builds no HTML from data and holds no timer or request outside effects', () => {
    const src = read('src/components/agentics/FeedPage.tsx');
    expect(src).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|\beval\(/);
    // Every request of the page goes through the shared wrapper, which turns a failure into a status, never a throw.
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
