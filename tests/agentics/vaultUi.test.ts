import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addr } from '../helpers/agentVault';
import { brightLineViolations } from '../helpers/brightLineWording';
import type { TrustReadout } from '../../src/lib/agentVault/trustPolicy';
import type { Destination, AgentWallet } from '../../src/lib/agentVault/store';
import type { LedgerRow } from '../../src/lib/agentVault/ledgerView';
import type { AgentPageData, HomePageData, AgentCard } from '../../src/lib/agentVault/vaultPages';
import type { PlanSummary } from '../../src/lib/agentVault/entitlements';
import { copy } from '../../src/components/agentics/copy';
import { explorerTxHref } from '../../src/components/agentics/paths';
import { pillOf } from '../../src/components/agentics/ui';

/**
 * The Agent Vault's screens, rendered the way the server renders them. What matters here: every
 * string from the registry, the ledger or the chain comes out as escaped text (hostile text is
 * rendered to prove it); a status is always a word; a flagged address offers no way to trust it
 * anyway; the limits are said before they are reached and calmly when they are; the two honest
 * sentences are on the page; every link goes somewhere real; every class is Agentics'; every
 * control has a label. Interactions are covered where they can be, in the tests of the pure logic
 * they run (paste.test.ts, refresh.test.ts, clientApi.test.ts); the built server is exercised by
 * hand in a browser.
 *
 * The unit config compiles JSX with the classic runtime (React.createElement), so React is provided
 * as a global before the components are imported.
 */
let AgentsHome: typeof import('../../src/components/agentics/AgentsHome').default;
let AgentPage: typeof import('../../src/components/agentics/AgentPage').default;
let RegistryPanel: typeof import('../../src/components/agentics/RegistryPanel').default;
let WalletsPanel: typeof import('../../src/components/agentics/WalletsPanel').default;
let LedgerPanel: typeof import('../../src/components/agentics/LedgerPanel').default;
let LedgerItem: typeof import('../../src/components/agentics/LedgerPanel').LedgerItem;
let AgentKeyCard: typeof import('../../src/components/agentics/AgentKeyCard').default;
let RemoveAgent: typeof import('../../src/components/agentics/RemoveAgent').default;
let PlanMeter: typeof import('../../src/components/agentics/PlanMeter').default;
let ui: typeof import('../../src/components/agentics/ui');
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  AgentsHome = (await import('../../src/components/agentics/AgentsHome')).default;
  AgentPage = (await import('../../src/components/agentics/AgentPage')).default;
  RegistryPanel = (await import('../../src/components/agentics/RegistryPanel')).default;
  WalletsPanel = (await import('../../src/components/agentics/WalletsPanel')).default;
  const ledger = await import('../../src/components/agentics/LedgerPanel');
  LedgerPanel = ledger.default;
  LedgerItem = ledger.LedgerItem;
  AgentKeyCard = (await import('../../src/components/agentics/AgentKeyCard')).default;
  RemoveAgent = (await import('../../src/components/agentics/RemoveAgent')).default;
  PlanMeter = (await import('../../src/components/agentics/PlanMeter')).default;
  ui = await import('../../src/components/agentics/ui');
});

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const classes = (html: string) => [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean));
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
/** Every attribute name on every tag, read the way a browser reads them (a quoted value is one token). */
const attributeNames = (html: string): string[] => {
  const names: string[] = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g)) {
    for (const a of tag[2].matchAll(/\s+([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g)) names.push(a[1].toLowerCase());
  }
  return names;
};
const HOSTILE = '"><script>alert(1)</script><img src=x onerror=alert(2)> & \'quoted\'';

const FREE: PlanSummary = { plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 9 } };
const UNLIMITED: PlanSummary = { plan: 'unlimited', label: 'Unlimited', limits: { bots: null, addresses: null, walletsPerBot: null }, use: { bots: 4, addresses: 17 } };
const readout = (over: Partial<TrustReadout> = {}): TrustReadout => ({
  v: 1, checkedAt: '2026-10-17T09:30:00.000Z', result: 'pass', hits: [], limits: [], sanctions: 'clear', screening: 'clear', verify: 'unknown', provenBy: null, communityReports: null, ...over,
});
const dest = (n: number, over: Partial<Destination> = {}): Destination => ({
  id: `d${n}`, tinId: 'tin-1', chain: 'ethereum', address: addr(n), label: `Label ${n}`, trustStatus: 'trusted', trustCheckedAt: '2026-10-17 09:30:00', trust: readout(), createdAt: '2026-10-01 00:00:00', ...over,
});
const wallet = (n: number, over: Partial<AgentWallet> = {}): AgentWallet => ({ id: `w${n}`, tinId: 'tin-1', chain: 'ethereum', address: addr(900 + n), createdAt: '2026-10-01 00:00:00', ...over });
const HASH = `0x${'ab'.repeat(32)}`;
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 'e1', at: '2026-10-17T09:30:00.123Z', kind: 'checked', address: addr(1), chain: 'ethereum', answer: 'flagged', registry: 'flagged', basis: 'registry_flagged', linkReason: null, keyState: 'active', tx: null, ...over,
});
const transfer = (over: Partial<LedgerRow> = {}): LedgerRow =>
  row({ id: 'e2', kind: 'transaction', answer: 'unknown', registry: 'trusted', basis: null, keyState: null, linkReason: 'no_preceding_check', tx: { hash: HASH, direction: 'in', amount: '1.5', asset: 'ETH', usd: 4500.5 }, ...over });
const totals = (over: Record<string, unknown> = {}) => ({
  transactions: 2,
  bought: { count: 1, pricedCount: 1, unpricedCount: 0, usd: 4500.5 },
  sold: { count: 1, pricedCount: 0, unpricedCount: 1, usd: 0 },
  ...over,
});
const agentData = (over: Partial<AgentPageData> = {}): AgentPageData => ({
  plan: FREE,
  tin: { id: 'tin-1', label: 'Treasury agent', createdAt: '2026-10-01 00:00:00' },
  since: '2026-10-01',
  today: '2026-10-18',
  key: { id: 'k1', domain: 'ops.example.test', status: 'active' },
  availableKeys: [{ id: 'k2', domain: 'pay.example.test', status: 'active' }],
  wallets: [wallet(1)],
  destinations: [dest(1), dest(2, { trustStatus: 'flagged', trust: readout({ result: 'fail', hits: ['sanctioned'], sanctions: 'hit' }) }), dest(3, { trustStatus: 'pending', trust: null, trustCheckedAt: null })],
  ledger: { rows: [row(), transfer()], next: null },
  totals: totals() as never,
  signing: { available: true },
  ...over,
});
const card = (n: number, over: Partial<AgentCard> = {}): AgentCard => ({
  id: `tin-${n}`, label: `Agent ${n}`, key: { id: 'k1', domain: 'ops.example.test', status: 'active' }, wallets: 2,
  destinations: { trusted: 3, flagged: 1, pending: 0 }, lastCheckAt: '2026-10-17T09:30:00.123Z', lastTransferAt: '2026-10-16T22:05:00.000Z', ...over,
});
const home = (over: Partial<HomePageData> = {}): HomePageData => ({ plan: FREE, agents: [card(1), card(2, { key: null, destinations: { trusted: 0, flagged: 0, pending: 0 }, lastCheckAt: null, lastTransferAt: null, wallets: 0 })], availableKeys: [{ id: 'k2', domain: 'pay.example.test', status: 'active' }], ...over });

describe('the home page', () => {
  it('shows a card for each agent with its key, its counts in words, its wallets and its last check and transfer, linking to its page', () => {
    const html = render(React.createElement(AgentsHome, { data: home() }));
    const t = textOf(html);
    expect(t).toContain('Agents');
    expect(t).toContain('Agent 1');
    expect(t).toContain('Key linked: ops.example.test');
    expect(t).toContain('3 trusted');
    expect(t).toContain('1 flagged');
    expect(t).toContain('0 pending');
    expect(t).toContain('2 wallets');
    expect(t).toContain('Last check 2026-10-17 09:30:00 UTC');
    expect(t).toContain('Last transfer 2026-10-16 22:05:00 UTC');
    expect(html).toContain('href="/dashboard/agentics/tins/tin-1"');
    expect(html).toContain('href="/dashboard/agentics/tins/tin-2"');
    // The second agent has nothing yet, and says so rather than showing zeros as if they were news.
    expect(t).toContain('No key linked yet');
    expect(t).toContain('No registered addresses yet');
    expect(t).toContain('No checks yet');
    expect(t).toContain('No transfers yet');
    expect(t).toContain('0 wallets');
  });

  it('says what a revoked or inactive key means for an agent', () => {
    const revoked = render(React.createElement(AgentsHome, { data: home({ agents: [card(1, { key: { id: 'k', domain: 'old.example.test', status: 'revoked' } })] }) }));
    expect(textOf(revoked)).toContain('Key revoked: old.example.test. Link another key to record new checks.');
    const pending = render(React.createElement(AgentsHome, { data: home({ agents: [card(1, { key: { id: 'k', domain: 'new.example.test', status: 'pending' } })] }) }));
    expect(textOf(pending)).toContain('Key not active: new.example.test');
  });

  it('walks a new account through the first five steps when it has no agent, and shows no list', () => {
    const html = render(React.createElement(AgentsHome, { data: home({ agents: [] }) }));
    const t = textOf(html);
    expect(t).toContain('Start with your first agent');
    for (const step of copy.home.steps) expect(t).toContain(step);
    expect(copy.home.steps).toHaveLength(5);
    expect(html).toContain('<ol class="ag-steps">');
    expect(html).not.toContain('class="ag-agents"');
    expect(html).toContain('href="/agentics/docs"');
  });

  it('says what the Vault records and what it cannot see, up top', () => {
    const t = textOf(render(React.createElement(AgentsHome, { data: home() })));
    expect(t).toContain('A transfer to an address that was never registered is invisible here.');
  });

  it('has a form to add an agent: a name (required, 80 characters), an optional key from the keys it could take, and a way to mint one', () => {
    const html = render(React.createElement(AgentsHome, { data: home() }));
    expect(html).toMatch(/<input[^>]*type="text"[^>]*maxLength="80"[^>]*required=""|<input[^>]*maxLength="80"[^>]*required=""[^>]*type="text"/);
    expect(textOf(html)).toContain('Agent key (optional)');
    expect(html).toMatch(/<option value=""( selected="")?>No key yet<\/option>/);
    expect(html).toContain('<option value="k2">pay.example.test</option>');
    expect((html.match(/<option /g) ?? []).length).toBe(2);
    expect(html).toContain('href="/verify/agent-keys"');
    expect(textOf(html)).toContain('Create agent');
  });

  it('with no key to offer, the select offers only "No key yet"', () => {
    const html = render(React.createElement(AgentsHome, { data: home({ availableKeys: [] }) }));
    expect((html.match(/<option /g) ?? []).length).toBe(1);
  });

  it('at the agent limit the form is off and says why, calmly; an account with no limit is never held back', () => {
    const full = render(React.createElement(AgentsHome, { data: home({ plan: { ...FREE, use: { bots: 3, addresses: 9 } } }) }));
    expect(textOf(full)).toContain('You are at the most agents the free plan covers. Remove one to add another.');
    expect(full).toMatch(/<input[^>]*disabled=""/);
    expect(full).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
    const roomy = render(React.createElement(AgentsHome, { data: home({ plan: { ...FREE, use: { bots: 2, addresses: 9 } } }) }));
    expect(textOf(roomy)).not.toContain('You are at the most agents');
    const unlimited = render(React.createElement(AgentsHome, { data: home({ plan: UNLIMITED }) }));
    expect(textOf(unlimited)).not.toContain('You are at the most agents');
    expect(unlimited).not.toMatch(/<input[^>]*disabled=""/);
  });

  it('shows an agent\'s name and a key\'s domain as text, whatever they hold', () => {
    const html = render(React.createElement(AgentsHome, { data: home({ agents: [card(1, { label: HOSTILE, key: { id: 'k', domain: HOSTILE, status: 'active' } })], availableKeys: [{ id: 'k2', domain: HOSTILE, status: 'active' }] }) }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(textOf(html)).toContain(HOSTILE);
  });

  it('every class is Agentics\', every link goes to a page that exists, and every control has a label', () => {
    for (const data of [home(), home({ agents: [] })]) {
      const html = render(React.createElement(AgentsHome, { data }));
      for (const c of classes(html)) expect(c, c).toMatch(/^ag-/);
      for (const h of hrefs(html)) expect(h, h).toMatch(/^(\/dashboard\/agentics\/tins\/[\w-]+|\/verify\/agent-keys|\/agentics\/docs)$/);
      expect(unlabelled(html)).toEqual([]);
    }
  });
});

/** The form controls in some markup that no label names: not inside a label, no aria-label, no <label for>. */
function unlabelled(html: string): string[] {
  const out: string[] = [];
  const stripped = html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/g, '');
  const forIds = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  for (const m of stripped.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="hidden"/.test(attrs)) continue;
    const id = /\sid="([^"]+)"/.exec(` ${attrs}`)?.[1];
    if (/aria-label=/.test(attrs) || (id && forIds.has(id))) continue;
    out.push(m[0]);
  }
  return out;
}

describe('one agent', () => {
  let html = '';
  let t = '';
  beforeAll(() => {
    html = render(React.createElement(AgentPage, { data: agentData() }));
    t = textOf(html);
  });

  it('puts the two honest sentences near the top, in the words the brief fixed', () => {
    expect(t).toContain('Records the checks this agent asks and the funds that reach your registered addresses. A transfer to an address that was never registered is invisible here.');
    expect(t).toContain('Pass means the checks we ran came back without a flag. It is not a statement that an address is safe or legitimate.');
    expect(html.indexOf('invisible here')).toBeLessThan(html.indexOf('Registered addresses'));
  });

  it('shows its name, when it was created, a way back, and the sections in order: key, registry, wallets, ledger, export, remove', () => {
    expect(t).toContain('Treasury agent');
    expect(t).toContain('Created 2026-10-01 (UTC)');
    expect(html).toContain('href="/dashboard/agentics"');
    const order = ['Agent key', 'Registered addresses', 'Own wallets', 'Ledger', 'Export', 'Remove this agent'].map((h) => html.indexOf(`>${h}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('says the limits of what it sees where the ledger is read, and the plan\'s places in the registry', () => {
    expect(t).toContain('9 of 15 addresses used on this account');
    expect(t).toContain('1 of 5 wallets');
  });

  it('gives every control a label, every class to Agentics, and every link a real destination', () => {
    expect(unlabelled(html)).toEqual([]);
    for (const c of classes(html)) expect(c, c).toMatch(/^ag-/);
    for (const h of hrefs(html)) {
      expect(h, h).toMatch(/^(\/dashboard\/agentics|\/verify\/agent-keys|\/verify-record|https:\/\/(etherscan\.io|polygonscan\.com|snowtrace\.io)\/tx\/0x[0-9a-f]{64})$/);
    }
  });

  it('puts every announcement for a screen reader in a live region: errors assertive, progress and success polite', () => {
    expect(html).toContain('role="alert" aria-live="assertive"');
    expect(html).toContain('role="status" aria-live="polite"');
  });
});

describe('the registry', () => {
  const panel = (destinations: Destination[], plan: PlanSummary = FREE) => render(React.createElement(RegistryPanel, { tinId: 'tin-1', destinations, plan }));

  it('shows Pass, Fail, Limited or Not checked as a word on every address, and a mark that is not a color', () => {
    const html = panel([
      dest(1),
      dest(2, { trustStatus: 'flagged', trust: readout({ result: 'fail', hits: ['phishing'] }) }),
      dest(3, { trustStatus: 'pending', trust: readout({ result: 'limited', sanctions: 'unavailable', limits: ['sanctions'] }) }),
      dest(4, { trustStatus: 'pending', trust: null, trustCheckedAt: null }),
    ]);
    const pills = [...html.matchAll(/<span class="ag-pill[^"]*">(?:<span aria-hidden="true">([^<]*)<\/span>)?([^<]*)<\/span>/g)].map((m) => [m[1]?.trim(), m[2]]);
    expect(pills).toEqual([['✓', 'Pass'], ['✕', 'Fail'], ['◐', 'Limited'], ['–', 'Not checked']]);
    expect(html).toContain('ag-pill ag-pill--gain');
    expect(html).toContain('ag-pill ag-pill--bad');
    expect(html).toContain('ag-pill ag-pill--warn');
  });

  it('decides the pill from where the address stands: flagged is Fail, trusted is Pass, pending is Limited once a check could not run and Not checked before any ran', () => {
    expect(pillOf(dest(1))).toBe('pass');
    expect(pillOf(dest(1, { trustStatus: 'flagged' }))).toBe('fail');
    expect(pillOf(dest(1, { trustStatus: 'flagged', trust: null }))).toBe('fail');
    expect(pillOf(dest(1, { trustStatus: 'pending', trust: readout({ result: 'limited' }) }))).toBe('limited');
    expect(pillOf(dest(1, { trustStatus: 'pending', trust: null }))).toBe('unchecked');
    // Whatever the readout says, a status that is not trusted is never a Pass.
    expect(pillOf(dest(1, { trustStatus: 'pending', trust: readout({ result: 'pass' }) }))).toBe('limited');
  });

  it('offers Trust on a pending address, Check again on a trusted one, and on a flagged one no way to trust it, only the plain instruction', () => {
    const trusted = panel([dest(1)]);
    expect(textOf(trusted)).toContain('Check again');
    expect(textOf(trusted)).not.toMatch(/\bTrust\b(?! ?ed)/);
    const pending = panel([dest(3, { trustStatus: 'pending', trust: null })]);
    expect(pending).toMatch(/>Trust<\/button>/);
    const flagged = panel([dest(2, { trustStatus: 'flagged', trust: readout({ result: 'fail', hits: ['sanctioned'] }) })]);
    expect(flagged).not.toMatch(/>Trust<\/button>/);
    expect(flagged).not.toContain('Check again');
    expect(textOf(flagged)).toContain('A flagged address stays flagged. To check it again, remove it and add it back.');
  });

  it('says what each pill means', () => {
    const t = textOf(panel([dest(1)]));
    expect(t).toContain('Pass: every check we ran came back without a flag.');
    expect(t).toContain('Fail: a check we ran came back with a flag.');
    expect(t).toContain('Limited: a check could not run, so nothing is claimed either way.');
  });

  it('shows each address in full, with its chain and its label, and a button that copies it', () => {
    const html = panel([dest(1, { chain: 'polygon', label: 'Payroll' }), dest(2, { label: null })]);
    const t = textOf(html);
    expect(t).toContain(addr(1));
    expect(t).toContain(addr(2));
    expect(t).toContain('Polygon');
    expect(t).toContain('Payroll');
    expect(t).toContain('No label');
    expect(html).toContain(`aria-label="Copy address ${addr(1).slice(0, 6)}...${addr(1).slice(-4)}"`);
    expect((html.match(/>Copy<\/button>/g) ?? []).length).toBe(2);
  });

  it('keeps the checks behind each pill one click away: closed to begin with, the button says it controls them', () => {
    const html = panel([dest(1)]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="ag-readout-d1"');
    expect(html).toContain('>Show checks<');
    expect(html).not.toContain('id="ag-readout-d1"');
  });

  it('shows the readout: each check that ran and what it said, what hit, the community reports and when', () => {
    const open = render(React.createElement(ui.Readout, {
      id: 'ag-readout-x',
      d: { trust: readout({ result: 'fail', hits: ['sanctioned', 'mixer'], sanctions: 'hit', screening: 'unavailable', verify: 'proven', provenBy: 'pay.example.test', communityReports: 3 }) },
    }));
    const t = textOf(open);
    expect(t).toContain('Sanctions lists Flagged');
    expect(t).toContain('Security screening Could not run');
    expect(t).toContain('Verify registry Proven by a domain proof on pay.example.test');
    expect(t).toContain('On a sanctions list');
    expect(t).toContain('Mixer activity');
    expect(t).toContain('3 community scam reports on file. Shown for context; it is not part of the result.');
    expect(t).toContain('Checked 2026-10-17 09:30:00 UTC');
    expect(open).toContain('id="ag-readout-x"');
  });

  it('shows a readout for an address whose checks never ran as exactly that', () => {
    expect(textOf(render(React.createElement(ui.Readout, { id: 'x', d: { trust: null } })))).toContain('The checks have not run for this address yet.');
  });

  it('words every way a check can come back, and a hit it has no words for as a plain hit', () => {
    for (const verify of ['proven', 'claimed', 'unknown', 'unavailable'] as const) {
      const t = textOf(render(React.createElement(ui.Readout, { id: 'x', d: { trust: readout({ verify, provenBy: verify === 'proven' ? 'a.example.test' : null }) } })));
      expect(t).toMatch(/Verify registry [A-Z]/);
    }
    const odd = textOf(render(React.createElement(ui.Readout, { id: 'x', d: { trust: readout({ hits: ['something new' as never] }) } })));
    expect(odd).toContain('Flagged');
    expect(odd).not.toContain('something new');
  });

  it('has a paste box with a label, its help tied to it, a chain to use for lines that name none, and a button', () => {
    const html = panel([]);
    expect(html).toContain('<label class="ag-field" for="ag-paste-text">Paste addresses</label>');
    expect(html).toMatch(/<textarea[^>]*id="ag-paste-text"[^>]*aria-describedby="ag-paste-help"|<textarea[^>]*aria-describedby="ag-paste-help"[^>]*id="ag-paste-text"/);
    expect(html).toContain('id="ag-paste-help"');
    for (const chain of ['Ethereum', 'Polygon', 'Avalanche']) expect(html).toContain(`>${chain}</option>`);
    expect(textOf(html)).toContain('Add and check');
    expect(textOf(html)).toContain('A pasted CSV works.');
  });

  it('says plainly when nothing is registered yet', () => {
    expect(textOf(panel([]))).toContain('No addresses registered yet. Paste the addresses this agent may pay.');
    expect(panel([])).not.toContain('class="ag-dests"');
  });

  it('offers to check the pending addresses only when there are some', () => {
    expect(textOf(panel([dest(1)]))).not.toContain('Check pending addresses');
    expect(textOf(panel([dest(1), dest(3, { trustStatus: 'pending', trust: null })]))).toContain('Check pending addresses');
  });

  it('counts the account\'s places used on a plan with a limit, and just the addresses on one without', () => {
    expect(textOf(panel([dest(1)], FREE))).toContain('9 of 15 addresses used on this account');
    expect(textOf(panel([dest(1), dest(2)], UNLIMITED))).toContain('2 addresses');
    expect(textOf(panel([dest(1)], UNLIMITED))).toContain('1 address');
  });

  it('at the limit the paste box and its button are off and the plan says why, calmly, with no price', () => {
    const full = panel([dest(1)], { ...FREE, use: { bots: 2, addresses: 15 } });
    expect(textOf(full)).toContain('You are at the most addresses the free plan covers. Remove one to add another.');
    expect(full).toMatch(/<textarea[^>]*disabled=""/);
    expect(full).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
    const roomy = panel([dest(1)], { ...FREE, use: { bots: 2, addresses: 14 } });
    expect(textOf(roomy)).not.toContain('You are at the most addresses');
    expect(roomy).not.toMatch(/<textarea[^>]*disabled=""/);
  });

  it('shows an address and a label as text, whatever they hold', () => {
    const html = panel([dest(1, { label: HOSTILE, address: HOSTILE })]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(textOf(html)).toContain(HOSTILE);
  });

  it('removes only after asking: the button is a plain Remove, and the question is not in the page until it is pressed', () => {
    const html = panel([dest(1)]);
    expect(html).toContain('>Remove</button>');
    expect(html).not.toContain('Yes, remove it');
  });
});

describe('copying an address', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the address on the clipboard and says it worked', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await ui.copyText(addr(1))).toBe(true);
    expect(writeText).toHaveBeenCalledWith(addr(1));
  });

  it('says it did not work when the browser refuses, and when there is no clipboard to ask (a page that is not served securely)', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    expect(await ui.copyText(addr(1))).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await ui.copyText(addr(1))).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(await ui.copyText(addr(1))).toBe(false);
  });
});

describe('the wallets', () => {
  const panel = (wallets: AgentWallet[], plan: PlanSummary = FREE) => render(React.createElement(WalletsPanel, { tinId: 'tin-1', wallets, plan }));

  it('lists each wallet in full with its chain and a copy button, and counts them against the plan\'s limit for an agent', () => {
    const html = panel([wallet(1), wallet(2, { chain: 'avalanche' })]);
    const t = textOf(html);
    expect(t).toContain(addr(901));
    expect(t).toContain(addr(902));
    expect(t).toContain('Avalanche');
    expect(t).toContain('2 of 5 wallets');
    expect((html.match(/>Remove<\/button>/g) ?? []).length).toBe(2);
    expect(unlabelled(html)).toEqual([]);
  });

  it('says plainly when there are none, and counts without a limit when the plan has none', () => {
    expect(textOf(panel([]))).toContain('No wallets yet. Add the address this agent sends from.');
    expect(textOf(panel([wallet(1)], UNLIMITED))).toContain('1 wallet');
    expect(textOf(panel([wallet(1)], UNLIMITED))).not.toContain(' of ');
  });

  it('at the limit the form is off and the plan says why', () => {
    const five = [1, 2, 3, 4, 5].map((n) => wallet(n));
    const full = panel(five);
    expect(textOf(full)).toContain('5 of 5 wallets');
    expect(textOf(full)).toContain('This agent is at the most wallets the free plan covers. Remove one to add another.');
    expect(full).toMatch(/<input[^>]*disabled=""/);
    expect(textOf(panel(five, UNLIMITED))).not.toContain('This agent is at the most wallets');
  });

  it('shows a wallet address as text, whatever it holds', () => {
    const html = panel([wallet(1, { address: HOSTILE })]);
    expect(html).not.toMatch(/<script/i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(textOf(html)).toContain(HOSTILE);
  });
});

describe('the ledger', () => {
  const item = (r: LedgerRow) => render(React.createElement('ol', null, React.createElement(LedgerItem, { row: r })));

  it('shows a check: when (UTC), what was asked about, the answer and the registry\'s word, and why', () => {
    const html = item(row());
    const t = textOf(html);
    expect(t).toContain('2026-10-17 09:30:00 UTC');
    expect(html).toContain('dateTime="2026-10-17T09:30:00.123Z"');
    expect(t).toContain('Checked');
    expect(t).toContain(addr(1));
    expect(t).toContain('Answer: Flagged');
    expect(t).toContain('Registry: Flagged');
    expect(t).toContain('Flagged. The address is flagged in your registry. A person should review it.');
  });

  it('words every answer and every registry word, and a check with no answer as that', () => {
    for (const [answer, title] of [['proven', 'Proven'], ['consistent-with-history', 'Consistent with history'], ['flagged', 'Flagged'], ['unknown', 'Unknown']] as const) {
      expect(textOf(item(row({ answer }))), answer).toContain(`Answer: ${title}`);
    }
    for (const [registry, word] of [['trusted', 'Trusted'], ['flagged', 'Flagged'], ['pending', 'Pending'], ['none', 'Not registered']] as const) {
      expect(textOf(item(row({ registry }))), registry).toContain(`Registry: ${word}`);
    }
    expect(textOf(item(row({ answer: null, registry: null })))).toContain('No answer recorded');
  });

  it('says when a check was asked with a key that was revoked since, or one the account no longer has', () => {
    expect(textOf(item(row({ keyState: 'revoked' })))).toContain('Asked with a key that has since been revoked.');
    expect(textOf(item(row({ keyState: 'unknown' })))).toContain('Asked with a key that is no longer on this account.');
    expect(textOf(item(row({ keyState: 'active' })))).not.toContain('Asked with a key');
  });

  it('shows a transfer in as bought and one out as sold, with the amount, the USD at the time and a link to the explorer that is safe to follow', () => {
    const inbound = item(transfer());
    expect(textOf(inbound)).toContain('Bought (in)');
    expect(textOf(inbound)).toContain('1.5 ETH');
    expect(textOf(inbound)).toContain('$4,500.50 at the time');
    expect(inbound).toContain(`href="https://etherscan.io/tx/${HASH}"`);
    expect(inbound).toContain('target="_blank"');
    expect(inbound).toContain('rel="noopener noreferrer"');
    const outbound = item(transfer({ tx: { hash: HASH, direction: 'out', amount: '300', asset: 'USDC', usd: 300 } }));
    expect(textOf(outbound)).toContain('Sold (out)');
    expect(textOf(outbound)).toContain('300 USDC');
  });

  it('never shows an unpriced transfer as zero', () => {
    const t = textOf(item(transfer({ tx: { hash: HASH, direction: 'in', amount: '10', asset: 'ODD', usd: null } })));
    expect(t).toContain('No USD value on record');
    expect(t).not.toContain('$0.00');
  });

  it('says where a transfer\'s status came from, or why it has none', () => {
    expect(textOf(item(transfer({ linkReason: null, answer: 'proven' })))).toContain('Status taken from the check that came before it.');
    expect(textOf(item(transfer()))).toContain('No check came before this transfer, so it carries the status unknown.');
    expect(textOf(item(transfer({ linkReason: 'ambiguous_checks' })))).toContain('Checks about this address disagreed at that moment, so the transfer took none of their answers.');
  });

  it('links to the explorer of the chain the transfer is on, and to nothing for a chain or a hash it does not trust', () => {
    expect(explorerTxHref('ethereum', HASH)).toBe(`https://etherscan.io/tx/${HASH}`);
    expect(explorerTxHref('polygon', HASH)).toBe(`https://polygonscan.com/tx/${HASH}`);
    expect(explorerTxHref('avalanche', HASH)).toBe(`https://snowtrace.io/tx/${HASH}`);
    expect(explorerTxHref('ethereum', HASH.toUpperCase().replace('0X', '0x'))).toBe(`https://etherscan.io/tx/${HASH}`);
    for (const [chain, hash] of [
      ['solana', HASH], [null, HASH], [undefined, HASH], ['constructor', HASH], ['__proto__', HASH], ['ethereum', '0x123'], ['ethereum', `${HASH}/../..`], ['ethereum', `${HASH}?x=1`], ['ethereum', '" onmouseover="alert(1)'],
      ['ethereum', `javascript:alert(1)`], ['ethereum', ''], ['ethereum', `0x${'g'.repeat(64)}`],
    ] as const) {
      expect(explorerTxHref(chain as never, hash), `${chain} ${hash}`).toBeNull();
    }
    const odd = item(transfer({ tx: { hash: '" onmouseover="alert(1)', direction: 'in', amount: '1', asset: 'ETH', usd: 1 } }));
    expect(odd).not.toContain('href=');
    expect(attributeNames(odd).filter((a) => /^on/.test(a))).toEqual([]);
    expect(item(transfer({ chain: null }))).not.toContain('href=');
  });

  it('shows what came from the chain, an asset\'s symbol and an amount, as text, whatever it holds', () => {
    const html = item(transfer({ tx: { hash: HASH, direction: 'in', amount: HOSTILE, asset: HOSTILE, usd: null } }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(textOf(html)).toContain(HOSTILE);
  });

  it('lists the rows newest first as given, says so when there are none, and offers more only when there is more', () => {
    const rows = [row({ id: 'a', at: '2026-10-17T10:00:00.000Z' }), row({ id: 'b', at: '2026-10-17T09:00:00.000Z' })];
    const html = render(React.createElement(LedgerPanel, { tinId: 'tin-1', ledger: { rows, next: null }, totals: totals() as never }));
    expect(html.indexOf('10:00:00')).toBeLessThan(html.indexOf('09:00:00'));
    expect(textOf(html)).toContain('That is every row.');
    expect(textOf(html)).not.toContain('Load more');
    const more = render(React.createElement(LedgerPanel, { tinId: 'tin-1', ledger: { rows, next: '2026-10-17T09:00:00.000Z|00000000-0000-4000-8000-000000000001' }, totals: totals() as never }));
    expect(textOf(more)).toContain('Load more');
    expect(textOf(more)).not.toContain('That is every row.');
    const empty = render(React.createElement(LedgerPanel, { tinId: 'tin-1', ledger: { rows: [], next: null }, totals: totals({ transactions: 0, bought: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 }, sold: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 } }) as never }));
    expect(textOf(empty)).toContain('Nothing recorded yet.');
    expect(empty).not.toContain('class="ag-events"');
  });

  it('shows the totals strip: bought and sold, raw, with a transfer without a price counted on its own and no word for any difference', () => {
    const html = render(React.createElement(LedgerPanel, { tinId: 'tin-1', ledger: { rows: [], next: null }, totals: totals() as never }));
    const t = textOf(html);
    expect(t).toContain('Bought $4,500.50 1 transfer');
    expect(t).toContain('Sold $0.00 1 transfer, 1 without a USD value (not in the total)');
    expect(t).toContain('The two sides are not compared.');
    expect(t).not.toMatch(/\bnet\b|\bloss\b|\bprofit\b|\bgain\b/i);
  });

  it('has a button to read the chain now, with a place for an honest progress and result line', () => {
    const html = render(React.createElement(LedgerPanel, { tinId: 'tin-1', ledger: { rows: [], next: null }, totals: totals() as never }));
    expect(textOf(html)).toContain('Read the chain now');
    expect(html).toContain('class="ag-readresult"');
    expect(html).toContain('role="status" aria-live="polite" class="ag-readresult"');
  });
});

describe('the agent key and removing an agent', () => {
  it('says which key is linked, and offers the other keys it could take', () => {
    const html = render(React.createElement(AgentKeyCard, { tinId: 'tin-1', linked: { id: 'k1', domain: 'ops.example.test', status: 'active' }, available: [{ id: 'k2', domain: 'pay.example.test', status: 'active' }] }));
    const t = textOf(html);
    expect(t).toContain('Linked to the key proven by ops.example.test.');
    expect(t).toContain('Unlink key');
    expect(html).toContain('<option value="k2">pay.example.test</option>');
    expect(html).toContain('href="/verify/agent-keys"');
    expect(unlabelled(html)).toEqual([]);
  });

  it('says there is no key, offers no unlink, and says so when there is no key left to link', () => {
    const html = render(React.createElement(AgentKeyCard, { tinId: 'tin-1', linked: null, available: [] }));
    expect(textOf(html)).toContain('No key is linked.');
    expect(textOf(html)).toContain('No other active key is free to link.');
    expect(textOf(html)).not.toContain('Unlink key');
  });

  it('says what a revoked key means', () => {
    const html = render(React.createElement(AgentKeyCard, { tinId: 'tin-1', linked: { id: 'k1', domain: 'ops.example.test', status: 'revoked' }, available: [] }));
    expect(textOf(html)).toContain('The key proven by ops.example.test was revoked. Checks asked with it are not recorded. Link another key to record new ones.');
  });

  it('asks before it removes an agent: the button is a plain Remove agent, and what it does is said first', () => {
    const html = render(React.createElement(RemoveAgent, { tinId: 'tin-1' }));
    expect(textOf(html)).toContain('Removing an agent takes it, its wallets and its registered addresses out of use and frees their places.');
    expect(html).toContain('>Remove agent<');
    expect(html).not.toContain('Yes, remove it');
  });
});

describe('the meter', () => {
  it('says what is used and what the plan covers, as a status', () => {
    const html = render(React.createElement(PlanMeter, { plan: FREE }));
    expect(textOf(html)).toContain('Free plan: 2 of 3 agents, 9 of 15 addresses');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Plan and use"');
    expect(textOf(render(React.createElement(PlanMeter, { plan: UNLIMITED })))).toContain('No limits on this account: 4 agents, 17 addresses');
  });
});

describe('the words on the screens', () => {
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      const r = (v as (...a: unknown[]) => unknown)('sample', 'two', 'three', 'four');
      if (typeof r === 'string') out.push(r);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
    return out;
  };
  const screens = [copy.plan, copy.home, copy.agent, copy.registry, copy.readout, copy.wallets, copy.ledger, copy.refresh, copy.export];

  it('keep to the product\'s verbs and say nothing that stops a payment', () => {
    const all = screens.flatMap((s) => strings(s));
    expect(all.length).toBeGreaterThan(120);
    for (const s of all) {
      expect(brightLineViolations(s), s).toEqual([]);
      expect(s, s).not.toMatch(/\b(blocked|stopped|halted|rejected|refused|holds?|holding)\b/i);
    }
  });

  it('never name a price, a gain, a loss, a profit or a net figure, and never call an address safe outside a denial', () => {
    for (const s of screens.flatMap((x) => strings(x))) {
      expect(s, s).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\bloss\b|\bnet\b|\b8949\b|\$\d|\bprices?\b|\bpricing\b|\bbilling\b|\bupgrade/i);
      if (/\bsafe\b/i.test(s)) expect(s, s).toMatch(/\b(never|not|no)\b/i);
    }
  });

  it('write American English and no exclamation marks', () => {
    for (const s of screens.flatMap((x) => strings(x))) expect(s, s).not.toContain('!');
  });

  it('never say Almstins verifies a payment, only addresses: the Vault is not in the payment path', () => {
    for (const s of screens.flatMap((x) => strings(x))) expect(s, s).not.toMatch(/\b(approve|authorize|release|hold|freeze|reverse)s?\b.*\b(payment|transfer|funds)\b/i);
  });
});

describe('the files', () => {
  const files = [
    'AgentsHome.tsx', 'AgentPage.tsx', 'RegistryPanel.tsx', 'WalletsPanel.tsx', 'LedgerPanel.tsx', 'AgentKeyCard.tsx', 'RemoveAgent.tsx', 'PlanMeter.tsx', 'ExportCard.tsx', 'ui.tsx',
  ].map((f) => `src/components/agentics/${f}`);

  it('build no HTML from data, run no code from a string, and never make an element out of a div or a span that is clicked', () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
      expect(src, f).not.toMatch(/<(div|span|p|li)\b[^>]*\bonClick=/);
    }
  });

  it('are client code: they import no database, no secret and no module that does', () => {
    for (const f of [...files, 'src/components/agentics/client.ts', 'src/components/agentics/paste.ts', 'src/components/agentics/refresh.ts', 'src/components/agentics/errors.ts', 'src/components/agentics/paths.ts', 'src/components/agentics/exportDownload.ts', 'src/lib/agentVault/ledgerView.ts']) {
      const src = read(f);
      const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => ({ type: !!m[1], spec: m[2] }));
      for (const { spec } of imports.filter((i) => !i.type)) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^@\/lib\/(db|agentKeys|auth|tenants|owner|subscriptions)|agentVault\/(store|vault|events|entitlements|vaultPages|reports|reportStore|watcher|checkLog)['"]?$|node:|^pg$/);
      }
      expect(src, f).not.toMatch(/process\.env|import\.meta\.env/);
    }
  });

  it('send nothing to any address but the Vault\'s own API', () => {
    for (const f of [...files, 'src/components/agentics/client.ts', 'src/components/agentics/paste.ts']) {
      for (const m of read(f).matchAll(/'(\/api\/[^'`]*)'|`(\/api\/[^`]*)`/g)) {
        expect(m[1] ?? m[2], f).toMatch(/^\/api\/agentics\//);
      }
      expect(read(f), f).not.toMatch(/https?:\/\/(?!etherscan\.io|polygonscan\.com|snowtrace\.io|almstins\.com)/);
    }
  });
});
