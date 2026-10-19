import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { brightLineViolations } from '../helpers/brightLineWording';
import { addr } from '../helpers/agentVault';
import { buildReport, dayBounds, headlineOf, type ReportContent } from '../../src/lib/agentVault/report';
import { BUCKET_MEANING, BUCKET_TITLE, reasonText } from '../../src/lib/agentVault/reportText';
import { formatClock, formatCount, formatDayLong, formatDayShort, formatUsd, formatUtc, plural } from '../../src/lib/agentVault/reportFormat';
import type { ReportDetail, ReportListItem } from '../../src/lib/agentVault/reports';
import type { ReportsPageData } from '../../src/lib/agentVault/reportPages';
import type { LedgerEvent } from '../../src/lib/agentVault/events';
import { errorText } from '../../src/components/agentics/errors';
import { bundleHref, pdfHref, reportHref, REPORTS_PATH, VERIFY_RECORD_PATH } from '../../src/components/agentics/paths';
import { copy } from '../../src/components/agentics/copy';

/**
 * The Reports pages' components, rendered the way the server renders them. What matters here: every
 * string from the ledger or the registry comes out as escaped text (hostile text is rendered to
 * prove it), a signed download is offered only for a report that verifies, every class belongs to
 * Agentics, every color is a token, and the pages are owner-only and carry no assumption about who
 * the owner is beyond the gate. The components are self-contained, so a re-skin is the shell and
 * the stylesheet.
 */
// The unit config compiles JSX with the classic runtime (React.createElement), so React is provided
// as a global before the components are imported, as in tests/walletChecker/goplusCredit.test.ts.
let ReportsPage: typeof import('../../src/components/agentics/ReportsPage').default;
let DeliverySettings: typeof import('../../src/components/agentics/DeliverySettings').default;
let ReportView: typeof import('../../src/components/agentics/ReportView').default;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  const list = await import('../../src/components/agentics/ReportsPage');
  ReportsPage = list.default;
  DeliverySettings = (await import('../../src/components/agentics/DeliverySettings')).default;
  ReportView = (await import('../../src/components/agentics/ReportView')).default;
});

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

const { start: START, end: END } = dayBounds('2026-10-17');
const GENERATED = '2026-10-18T09:10:00.000Z';
const HOSTILE = '"><script>alert(1)</script><img src=x onerror=alert(2)> & \'quoted\'';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 17, h, m)).toISOString();

let n = 0;
const check = (address: string, basis: string, answer: LedgerEvent['answer'], when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'checked', at: when, address, chain: 'ethereum', answer,
  registry: 'trusted', status: 'unknown', keyId: 'k', sourceIp: null, tx: null, detail: { basis },
});
const move = (direction: 'in' | 'out', usd: number | null, when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'transaction', at: when, address: addr(2), chain: 'ethereum',
  answer: 'unknown', registry: 'trusted', status: null, keyId: null, sourceIp: null,
  tx: { hash: `0x${'1'.repeat(64)}`, direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
  detail: { reason: 'no_preceding_check' },
});

const content = (over: { label?: string; labels?: Map<string, string>; events?: LedgerEvent[]; partial?: boolean } = {}): ReportContent =>
  buildReport(
    over.events ?? [
      check(addr(1), 'registry_flagged', 'flagged', at(8)),
      check(addr(1), 'domain_proof', 'proven', at(8, 5)),
      check(addr(1), 'domain_proof', 'proven', at(8, 6)),
      check(addr(3), 'not_in_registry', 'unknown', at(9)),
      check(addr(3), 'not_in_registry', 'unknown', at(9, 30)),
      check(addr(4), 'registered_first_check', 'unknown', at(10)),
      check(addr(5), 'domain_proof', 'proven', at(11)),
      move('in', 1270.56, at(12)),
      move('out', null, at(13)),
    ],
    {
      tin: { id: 'tin-1', label: over.label ?? 'Treasury agent' },
      period: { start: START, end: END, partial: over.partial ?? false },
      labels: over.labels ?? new Map([[addr(1), 'Ops wallet']]),
    },
  );

const item = (c: ReportContent, over: Partial<ReportListItem> = {}): ReportListItem => ({
  id: 'rep-2', tinId: 'tin-1', day: '2026-10-17', version: 2, generatedAt: GENERATED, partial: c.period.partial, signed: true, headline: headlineOf(c), ...over,
});

const detail = (c: ReportContent, over: Partial<ReportDetail> = {}): ReportDetail => ({
  ...item(c),
  period: { start: START, end: END },
  keyId: 'almstins-0123456789abcdef',
  merkleRoot: 'ab'.repeat(32),
  verification: 'verified',
  content: c,
  versions: [item(c), item(c, { id: 'rep-1', version: 1, generatedAt: '2026-10-18T08:00:00.000Z', signed: false })],
  ...over,
});

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
/** Every attribute name on every tag, read the way a browser reads them (a quoted value is one token, whatever it holds). */
const attributeNames = (html: string): string[] => {
  const names: string[] = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g)) {
    for (const a of tag[2].matchAll(/\s+([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g)) names.push(a[1].toLowerCase());
  }
  return names;
};
const classes = (html: string) => [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean));

const pageData = (over: Partial<ReportsPageData> = {}): ReportsPageData => {
  const c = content();
  return {
    today: '2026-10-18',
    yesterday: '2026-10-17',
    signing: { available: true },
    tins: [{ id: 'tin-1', label: 'Treasury agent', since: '2026-10-01', reports: [item(c), item(c, { id: 'rep-0', day: '2026-10-16', version: 1, partial: true, signed: false })] }],
    delivery: { settings: { cadence: 'off', alerts: false }, recipientAvailable: true },
    ...over,
  };
};

describe('the checks used below see what a browser sees', () => {
  it('attributeNames reads a quoted value as one token, so a hostile value is text and a real injected attribute is caught', () => {
    expect(attributeNames('<p title="a onerror=b > c" class=x>')).toEqual(['title', 'class']);
    expect(attributeNames('<img src="x" onerror="alert(1)"><a href=\'y\' onclick=z>')).toEqual(['src', 'onerror', 'href', 'onclick']);
    expect(attributeNames('<p>&lt;img onerror=x&gt;</p>')).toEqual([]);
  });
});

describe('the Reports page', () => {
  it('lists each agent with its reports, newest first, each linking to its own page, with the counts and the strip', () => {
    const html = render(React.createElement(ReportsPage, { data: pageData() }));
    const t = textOf(html);
    expect(t).toContain('Reports');
    expect(t).toContain('Treasury agent');
    expect(html).toContain(`href="${reportHref('rep-2')}"`);
    expect(html).toContain(`href="${reportHref('rep-0')}"`);
    expect(html.indexOf('October 17, 2026')).toBeLessThan(html.indexOf('October 16, 2026'));
    expect(t).toContain('1 had issues');
    expect(t).toContain('1 not confirmed');
    expect(t).toContain('1 new');
    expect(t).toContain('1 no issues');
    expect(t).toContain('Bought $1,270.56');
    expect(t).toContain('Version 2');
    expect(t).toContain('Partial day');
    expect(t).toContain('Unsigned');
    expect(t).toContain('Signed');
  });

  it('a count of zero is shown muted, not as an alarm', () => {
    const empty = content({ events: [] });
    const html = render(React.createElement(ReportsPage, { data: pageData({ tins: [{ id: 't', label: 'Quiet', since: '2026-10-01', reports: [item(empty)] }] }) }));
    expect((html.match(/ag-count--zero/g) ?? []).length).toBe(4);
    expect(html).not.toMatch(/ag-count--issues|ag-count--confirm/);
    expect(textOf(html)).toContain('No transfers with registered destinations');
  });

  it('says plainly when there are no agents, and when an agent has no reports', () => {
    expect(textOf(render(React.createElement(ReportsPage, { data: pageData({ tins: [] }) })))).toContain('No agents yet.');
    const html = render(React.createElement(ReportsPage, { data: pageData({ tins: [{ id: 't', label: 'New agent', since: '2026-10-01', reports: [] }] }) }));
    expect(textOf(html)).toContain('No reports yet for this agent.');
  });

  it('says when this server cannot sign, and says nothing when it can', () => {
    expect(textOf(render(React.createElement(ReportsPage, { data: pageData({ signing: { available: false } }) })))).toContain('No signing key is configured on this server');
    expect(textOf(render(React.createElement(ReportsPage, { data: pageData() })))).not.toContain('No signing key');
  });

  it('offers a form to make a report for a day: yesterday by default, nothing before the agent existed or after today', () => {
    const html = render(React.createElement(ReportsPage, { data: pageData() }));
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-10-17"');
    expect(html).toContain('min="2026-10-01"');
    expect(html).toContain('max="2026-10-18"');
    expect(html).toContain('Make report');
  });

  it('shows an agent\'s name as text, whatever it holds', () => {
    const html = render(React.createElement(ReportsPage, { data: pageData({ tins: [{ id: 'tin-1', label: HOSTILE, since: '2026-10-01', reports: [item(content())] }] }) }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(attributeNames(html).length).toBeGreaterThan(20);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(textOf(html)).toContain(HOSTILE);
  });

  it('turns an error code from the API into plain words, and anything it does not know into the fallback', () => {
    expect(errorText('invalid_period')).toBe(copy.errors.invalid_period);
    expect(errorText('tin_not_found')).toBe(copy.errors.tin_not_found);
    for (const odd of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'nope', undefined, null, 7, {}]) {
      expect(errorText(odd), String(odd)).toBe(copy.errors.generic);
    }
  });

  it('every class on the page belongs to Agentics', () => {
    const html = render(React.createElement(ReportsPage, { data: pageData() }));
    const all = classes(html);
    expect(all.length).toBeGreaterThan(10);
    for (const c of all) expect(c, c).toMatch(/^ag-/);
  });
});

describe('the email settings', () => {
  const html = (over: Partial<{ cadence: 'off' | 'daily' | 'weekly' | 'issues'; alerts: boolean; recipientAvailable: boolean }> = {}) =>
    render(React.createElement(DeliverySettings, { settings: { cadence: over.cadence ?? 'off', alerts: over.alerts ?? false }, recipientAvailable: over.recipientAvailable ?? true }));

  it('shows the four choices, with the saved one selected, and says everything is off until turned on', () => {
    const h = html({ cadence: 'weekly' });
    const t = textOf(h);
    for (const label of ['Off', 'Every day', 'Every Monday, for the week before', 'Only when something needs a look']) expect(t, label).toContain(label);
    expect(h).toMatch(/<option value="weekly" selected="">/);
    expect((h.match(/<option /g) ?? []).length).toBe(4);
    expect(t).toContain('Email is off until you turn it on');
    expect(t).toContain('Emails carry counts only. Wallet addresses, labels and amounts stay behind your sign-in.');
  });

  it('shows the alerts choice as saved: off by default', () => {
    expect(html()).not.toMatch(/type="checkbox" checked/);
    expect(html({ alerts: true })).toMatch(/type="checkbox" checked/);
    expect(textOf(html())).toContain('at most one an hour for each address');
  });

  it('warns when there is no address to send to, and says nothing otherwise', () => {
    expect(textOf(html({ recipientAvailable: false }))).toContain('No email address is on file for this account');
    expect(textOf(html())).not.toContain('No email address is on file');
  });

  it('is on the Reports page, after the agents, and every class on it belongs to Agentics', () => {
    const page = render(React.createElement(ReportsPage, { data: pageData({ delivery: { settings: { cadence: 'daily', alerts: true }, recipientAvailable: true } }) }));
    expect(page.indexOf('Treasury agent')).toBeLessThan(page.indexOf('Report email'));
    expect(page).toMatch(/<option value="daily" selected="">/);
    for (const c of classes(page)) expect(c, c).toMatch(/^ag-/);
  });

  it('turns an error code into plain words and the invalid-settings code into its own words', () => {
    expect(errorText('invalid_settings')).toBe(copy.errors.invalid_settings);
    expect(errorText('invalid_settings')).not.toBe(copy.errors.generic);
    // The two limits say what happened and what to do, calmly, and never in the words of a price list.
    for (const code of ['rate_limited', 'version_limit'] as const) {
      expect(errorText(code), code).toBe(copy.errors[code]);
      expect(errorText(code), code).not.toBe(copy.errors.generic);
      expect(errorText(code), code).not.toMatch(/upgrade|plan\b|price|pric|billing|subscri|pay|quota|premium|pro\b|!/i);
      expect(brightLineViolations(errorText(code)), code).toEqual([]);
    }
    expect(errorText('rate_limited')).toMatch(/wait a minute/i);
    expect(errorText('version_limit')).toMatch(/newest version/i);
  });
});

describe('one report', () => {
  it('shows the four groups, the strip, each listed address with its label and reason, and the versions of the day', () => {
    const c = content();
    const html = render(React.createElement(ReportView, { report: detail(c), signing: { available: true } }));
    const t = textOf(html);
    expect(t).toContain('Operator report');
    expect(t).toContain('October 17, 2026 (UTC day)');
    expect(t).toContain('Treasury agent');
    for (const title of ['Had issues', 'Not confirmed', 'New', 'No issues']) expect(t, title).toContain(title);
    expect(t).toContain('$1,270.56');
    expect(t).toContain('1 without a USD value (not in the total)');
    for (const a of [addr(1), addr(3), addr(4)]) expect(t, a).toContain(a);
    expect(t).not.toContain(addr(5));
    expect(t).toContain('Ops wallet');
    expect(t).toContain(reasonText('registry_flagged'));
    expect(t).toContain('1 of 3'); // flagged once, and asked about three times that day
    expect(t).toContain('Versions of this day');
    expect(html).toContain(`href="${reportHref('rep-1')}"`);
    expect(t).toContain('Shown');
  });

  it('offers the signed PDF and the proof bundle only for a report that verifies', () => {
    const c = content();
    const ok = render(React.createElement(ReportView, { report: detail(c), signing: { available: true } }));
    expect(ok).toContain(`href="${pdfHref('rep-2')}"`);
    expect(ok).toContain(`href="${bundleHref('rep-2')}"`);
    expect(ok).toContain(`href="${VERIFY_RECORD_PATH}"`);
    expect(textOf(ok)).toContain(copy.verification.verified);

    for (const [state, message] of [
      ['unsigned', copy.verification.unsigned],
      ['unverifiable', copy.verification.unverifiable],
      ['altered', copy.verification.altered],
    ] as const) {
      const html = render(React.createElement(ReportView, { report: detail(c, { verification: state, signed: state !== 'unsigned' }), signing: { available: true } }));
      expect(html, state).not.toContain('/api/agentics/reports/pdf');
      expect(html, state).not.toContain('/api/agentics/reports/bundle');
      expect(html, state).not.toContain('Download signed PDF');
      expect(textOf(html), state).toContain(message);
    }
    expect(render(React.createElement(ReportView, { report: detail(c, { verification: 'altered' }), signing: { available: true } }))).toContain('ag-notice--bad');
  });

  it('says when this server cannot sign, for a report that is not verified', () => {
    const html = render(React.createElement(ReportView, { report: detail(content(), { verification: 'unsigned', signed: false }), signing: { available: false } }));
    expect(textOf(html)).toContain('No signing key is configured on this server');
  });

  it('says a partial day is partial, and a quiet day is quiet', () => {
    const partial = render(React.createElement(ReportView, { report: detail(content({ partial: true })), signing: { available: true } }));
    expect(textOf(partial)).toContain('Partial day. This report was made at 2026-10-18 09:10:00 UTC');
    const quiet = render(React.createElement(ReportView, { report: detail(content({ events: [] })), signing: { available: true } }));
    expect(textOf(quiet)).toContain('Nothing recorded for your registered destinations needs a person to look at it.');
    expect(textOf(quiet)).toContain('No check came back proven or consistent with history in this period.');
    expect(textOf(quiet)).not.toContain('Partial day');
  });

  it('says a day that reached the daily limit of recorded checks was cut, and when; a day that was not says nothing', () => {
    const marked = { ...check(addr(5), 'domain_proof', 'proven', at(11, 7)), detail: { basis: 'domain_proof', limit: { reached: true, perDay: 5000 } } };
    const cut = content({ events: [check(addr(1), 'domain_proof', 'proven', at(8)), marked] });
    const html = render(React.createElement(ReportView, { report: detail(cut), signing: { available: true } }));
    expect(textOf(html)).toContain('Daily limit reached. This agent reached its daily limit of recorded checks at 2026-10-17 11:07:00 UTC. Checks after that were answered and not recorded, except checks that came back flagged, so the counts below cover the recorded checks.');
    expect(html).toContain('ag-notice ag-notice--warn');
    expect(textOf(render(React.createElement(ReportView, { report: detail(content()), signing: { available: true } })))).not.toContain('Daily limit reached');
  });

  it('an all-clear is about what was recorded: it names the registered destinations and says a transfer to an unregistered address is not seen', () => {
    const quiet = textOf(render(React.createElement(ReportView, { report: detail(content({ events: [] })), signing: { available: true } })));
    expect(quiet).toContain('A transfer to an address that was never registered is not recorded here.');
    expect(quiet).not.toMatch(/Nothing here needs/);
    // The strip says the same about "no transfers" on both sides, on the page and in the list.
    expect(quiet.match(/No transfers with registered destinations/g)).toHaveLength(2);
    expect(quiet).not.toMatch(/No transfers(?! with registered destinations)/);
  });

  it('the page and the PDF use one set of words for what was and was not recorded', async () => {
    const text = await import('../../src/lib/agentVault/reportText');
    expect(copy.strip.none).toBe(text.NO_TRANSFERS);
    expect(copy.view.nothingNeeds).toBe(text.NOTHING_NEEDS_A_PERSON);
    expect(copy.view.clearNote).toContain(text.NOT_REGISTERED_NOTE);
    // And neither file keeps an older, unscoped line of its own.
    for (const file of ['src/components/agentics/copy.ts', 'src/lib/agentVault/reportPdf.ts', 'src/components/agentics/ReportView.tsx', 'src/components/agentics/ReportsPage.tsx']) {
      expect(read(file), file).not.toMatch(/Nothing here needs|'No transfers'|"No transfers"/);
    }
  });

  it('says how many addresses a group left out', () => {
    const many = Array.from({ length: 205 }, (_, i) => check(addr(100 + i), 'not_in_registry', 'unknown', at(8, i % 60)));
    const html = render(React.createElement(ReportView, { report: detail(content({ events: many })), signing: { available: true } }));
    expect(textOf(html)).toContain('5 more counted above but not listed.');
    expect(textOf(html)).toContain('Not confirmed · 205');
  });

  it('shows the owner\'s text and the agent\'s name as text, whatever they hold', () => {
    const c = content({ label: HOSTILE, labels: new Map([[addr(1), HOSTILE], [addr(3), '<b onmouseover=alert(3)>x</b>']]) });
    const html = render(React.createElement(ReportView, { report: detail(c), signing: { available: true } }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b /i);
    expect(attributeNames(html).filter((a) => /^on/.test(a))).toEqual([]);
    expect(html).toContain('&lt;script&gt;');
    expect(textOf(html)).toContain(HOSTILE);
    expect(textOf(html)).toContain('<b onmouseover=alert(3)>x</b>');
  });

  it('every class on the page belongs to Agentics', () => {
    const html = render(React.createElement(ReportView, { report: detail(content()), signing: { available: true } }));
    const all = classes(html);
    expect(all.length).toBeGreaterThan(20);
    for (const c of all) expect(c, c).toMatch(/^ag-/);
  });

  it('links to nothing but its own pages, the downloads and the public verify page', () => {
    const html = render(React.createElement(ReportView, { report: detail(content()), signing: { available: true } }));
    const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    for (const h of hrefs) expect(h, h).toMatch(/^(\/dashboard\/agentics\/reports(\/|$)|\/api\/agentics\/reports\/(pdf|bundle)\?id=|\/verify-record$)/);
  });
});

describe('the words on the pages', () => {
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      const r = (v as (...a: unknown[]) => unknown)('sample', 'two', 'three');
      if (typeof r === 'string') out.push(r);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
    return out;
  };
  const all = [
    ...strings(copy),
    ...Object.values(BUCKET_TITLE),
    ...Object.values(BUCKET_MEANING),
    ...['registry_flagged', 'domain_mismatch', 'not_in_registry', 'registry_pending', 'domain_proof', 'registered_and_checked_before', 'registered_first_check', 'other'].map(reasonText),
  ];

  it('keep to the product\'s verbs: verify, flag and record, and nothing that stops a payment', () => {
    expect(all.length).toBeGreaterThan(60);
    for (const s of all) expect(brightLineViolations(s), s).toEqual([]);
    for (const s of all) expect(s, s).not.toMatch(/\b(blocked|stopped|halted|rejected|refused)\b/i);
  });

  it('never name profit, loss, cost or a net figure, and never call an address safe outside a denial', () => {
    for (const s of all) {
      expect(s, s).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\bloss\b|\bnet\b|\b8949\b/i);
      if (/\bsafe\b/i.test(s)) expect(s, s).toMatch(/\b(never|not|no)\b/i);
    }
  });

  it('the flagged reasons say a person should look, and do not say anything was stopped', () => {
    expect(reasonText('registry_flagged')).toMatch(/A person should review it/);
    expect(reasonText('domain_mismatch')).toMatch(/A person should review it/);
    expect(reasonText('anything else at all')).toBe(reasonText('other'));
  });
});

describe('numbers and times', () => {
  it('write dollars with cents, counts with separators and times in UTC', () => {
    expect(formatUsd(1270.5)).toBe('$1,270.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatCount(1284)).toBe('1,284');
    expect(plural(1, 'address', 'addresses')).toBe('1 address');
    expect(plural(2, 'address', 'addresses')).toBe('2 addresses');
    expect(plural(1284, 'check', 'checks')).toBe('1,284 checks');
    expect(formatUtc('2026-10-18T09:10:00.000Z')).toBe('2026-10-18 09:10:00 UTC');
    expect(formatClock('2026-10-18T09:10:07.123Z')).toBe('09:10:07');
    expect(formatDayLong('2026-10-17')).toBe('October 17, 2026');
    expect(formatDayShort('2026-10-17')).toBe('Oct 17');
    // Anything that is not a time or a day is shown as it is, never as "Invalid Date".
    expect(formatUtc('not a time')).toBe('not a time');
    expect(formatClock('')).toBe('');
    expect(formatDayLong('nope')).toBe('nope');
  });
});

describe('the stylesheet', () => {
  const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const css = stripCss(read('src/components/agentics/agentics.css'));
  const tokens = stripCss(read('src/styles/tokens.css'));
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

  it('uses only the product\'s 22 tokens: no hard-coded color, no variable of its own', () => {
    expect(defined.size).toBe(22);
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(/);
    expect(css).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/); // it defines no custom property
  });

  it('styles only its own classes: nothing global, nothing from the crypto vault', () => {
    const selectors = [...css.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => !/^\d+%|^from|^to$/.test(s));
    expect(selectors.length).toBeGreaterThan(40);
    for (const group of selectors) {
      for (const sel of group.split(',').map((s) => s.trim())) {
        expect(sel, sel).toMatch(/^\.ag-/);
      }
    }
  });
});

describe('the files under src/components/agentics and src/pages/dashboard/agentics', () => {
  const files = [...walk(path.join(ROOT, 'src/components/agentics')), ...walk(path.join(ROOT, 'src/pages/dashboard/agentics'))].map(rel).sort();

  it('are these, and nothing else', () => {
    expect(files).toEqual([
      'src/components/agentics/AccountPanel.tsx',
      'src/components/agentics/AgentKeyCard.tsx',
      'src/components/agentics/AgentPage.tsx',
      'src/components/agentics/AgenticsShell.astro',
      'src/components/agentics/AgentsHome.tsx',
      'src/components/agentics/DeliverySettings.tsx',
      'src/components/agentics/ExportCard.tsx',
      'src/components/agentics/FeedPage.tsx',
      'src/components/agentics/LedgerPanel.tsx',
      'src/components/agentics/PlanMeter.tsx',
      'src/components/agentics/RegistryPanel.tsx',
      'src/components/agentics/RemoveAgent.tsx',
      'src/components/agentics/ReportView.tsx',
      'src/components/agentics/ReportsPage.tsx',
      'src/components/agentics/WalletsPanel.tsx',
      'src/components/agentics/account.ts',
      'src/components/agentics/agentics.css',
      'src/components/agentics/client.ts',
      'src/components/agentics/copy.ts',
      'src/components/agentics/errors.ts',
      'src/components/agentics/exportDownload.ts',
      'src/components/agentics/feedPlayer.ts',
      'src/components/agentics/feedPoller.ts',
      'src/components/agentics/feedReader.ts',
      'src/components/agentics/feedRows.ts',
      'src/components/agentics/paste.ts',
      'src/components/agentics/paths.ts',
      'src/components/agentics/refresh.ts',
      'src/components/agentics/ui.tsx',
      'src/components/agentics/withTimeout.ts',
      // The free-signup door's welcome letter (the page a new account lands on); an account that may use
      // the Vault is handed to the agents page from here (tests/agentics/home.test.ts). It is not a Vault
      // page, but it lives in this directory, so the checks below read it as well.
      'src/pages/dashboard/agentics/agents.astro',
      'src/pages/dashboard/agentics/feed.astro',
      'src/pages/dashboard/agentics/index.astro',
      'src/pages/dashboard/agentics/reports.astro',
      'src/pages/dashboard/agentics/reports/[id].astro',
      'src/pages/dashboard/agentics/tins/[id].astro',
    ]);
  });

  it('never build HTML from data: no innerHTML, no set:html, no dangerouslySetInnerHTML, no eval', () => {
    for (const f of files) {
      expect(read(f), f).not.toMatch(/innerHTML|outerHTML|set:html|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
    }
  });

  it('assume nothing about who the owner is: the gate is the only place that knows', () => {
    for (const f of files) {
      expect(read(f), f).not.toMatch(/@\/lib\/owner|OWNER_TENANT_ID|isOwner|titaniumhut/);
    }
  });

  it('keep to Agentics: no crypto-vault component, stylesheet or navigation is imported', () => {
    for (const f of files.filter((x) => !x.endsWith('.css'))) {
      const imports = [...read(f).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/components\/(dashboard|vault|petro-tins|transactions|yearEnd|bookkeeping)|dashboard\.css|vault\.css|\/Footer|Layout\.css/);
      }
    }
  });

  it('are documents of their own: not one of them uses the app\'s Layout, so nothing of the crypto tracker is on an Agentics screen', () => {
    // The tracker's chrome (its navigation, its "Titanium Hut" brand, its account menu and its site footer)
    // comes with the Layout; the Agentics screens stand on the shell alone, like the door and the letter.
    expect(files.filter((f) => /layouts\/|Layout\.astro|<Footer|LoginLayout/.test(read(f)))).toEqual([]);
    for (const f of ['src/pages/dashboard/agentics/reports.astro', 'src/pages/dashboard/agentics/reports/[id].astro', 'src/pages/dashboard/agentics/tins/[id].astro', 'src/pages/dashboard/agentics/agents.astro', 'src/pages/dashboard/agentics/feed.astro']) {
      expect(read(f), f).toMatch(/import AgenticsShell from/);
      expect(read(f), f).not.toMatch(/import Layout from/);
    }
    const shell = read('src/components/agentics/AgenticsShell.astro');
    // A whole document, with its own head: never indexed, its own icon, the one analytics tag.
    expect(shell).toMatch(/<!doctype html>/);
    expect(shell).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/);
    expect(shell).toMatch(/import '\.\/agentics\.css'/);
    expect(shell).toMatch(/import '@\/styles\/tokens\.css'/);
    expect(shell).toMatch(/<Analytics owner=\{internal\} \/>/);
    // None of the tracker's names or links: the bar is Agentics' own (the file's comment names what is left out, so only its code is read).
    const code = shell.replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/Titanium Hut|\/dashboard\/(vault|portfolio|wallets|bookkeeping|alerts|research|billing)|\/year-summary|petro/i);
  });

  it('has a bar and a footer of its own: the name, the two places an account goes, the plan meter and the way out', () => {
    const shell = read('src/components/agentics/AgenticsShell.astro');
    expect(shell).toMatch(/class="ag-shell__brand" href=\{HOME_PATH\}/);
    expect(shell).toMatch(/aria-current=\{active === 'agents' \? 'page' : undefined\}/);
    expect(shell).toMatch(/aria-current=\{active === 'reports' \? 'page' : undefined\}/);
    expect(shell).toMatch(/<PlanMeter client:load plan=\{plan\} \/>/);
    expect(shell).toMatch(/<LogoutButton class="ag-shell__out" next="\/agentics">/);
    expect(shell).toMatch(/<footer class="ag-shell__foot">/);
    // The footer is the door's own, with the links the door has: docs, the free checker, privacy.
    expect(shell).toMatch(/door\.landing\.footer/);
    expect(shell).toMatch(/href="\/agentics\/docs"/);
    expect(shell).toMatch(/href="\/wallet-checker"/);
    expect(shell).toMatch(/href="\/privacy"/);
  });

  it('title every page with a fixed word, never with text an account chose', () => {
    for (const f of ['src/pages/dashboard/agentics/reports.astro', 'src/pages/dashboard/agentics/reports/[id].astro', 'src/pages/dashboard/agentics/tins/[id].astro', 'src/pages/dashboard/agentics/agents.astro', 'src/pages/dashboard/agentics/feed.astro']) {
      const title = /<AgenticsShell title=(\{[^}]*\}|"[^"]*")/.exec(read(f))?.[1];
      expect(title, f).toMatch(/^"[A-Za-z ]+"$/);
    }
    // And the shell puts the title in the head as given, with the product's name after it.
    expect(read('src/components/agentics/AgenticsShell.astro')).toMatch(/<title>\{`\$\{title\} \| \$\{copy\.brand\}`\}<\/title>/);
  });

  it('are owner-only twice: each page checks the gate itself, and a report that is not this account\'s is a 404', () => {
    for (const f of ['src/pages/dashboard/agentics/reports.astro', 'src/pages/dashboard/agentics/reports/[id].astro', 'src/pages/dashboard/agentics/tins/[id].astro', 'src/pages/dashboard/agentics/agents.astro', 'src/pages/dashboard/agentics/feed.astro']) {
      const src = read(f);
      expect(src, f).toMatch(/const session = await requireTenantSession\(Astro\.request\);/);
      expect(src, f).toMatch(/if \(!session \|\| !canAccessAgenticsVault\(session\)\) return new Response\(null, \{ status: 404 \}\);/);
      expect(src, f).toMatch(/session\.tenantId/);
      expect(src, f).not.toMatch(/Astro\.url\.searchParams|searchParams\.get\(\s*['"]tenant/); // the account comes from the session, never the request
    }
    expect(read('src/pages/dashboard/agentics/reports/[id].astro')).toMatch(/if \(!page\) return new Response\(null, \{ status: 404 \}\);/);
    expect(read('src/pages/dashboard/agentics/tins/[id].astro')).toMatch(/if \(!page\) return new Response\(null, \{ status: 404 \}\);/);
  });

  it('read their data from the Vault directly, never through their own API', () => {
    for (const f of ['src/pages/dashboard/agentics/reports.astro', 'src/pages/dashboard/agentics/reports/[id].astro', 'src/pages/dashboard/agentics/tins/[id].astro', 'src/pages/dashboard/agentics/agents.astro', 'src/pages/dashboard/agentics/feed.astro', 'src/pages/dashboard/agentics/index.astro']) {
      expect(read(f), f).not.toMatch(/fetch\(|\/api\/agentics/);
    }
  });
});

describe('the links name real routes', () => {
  it('every path the components use is a page or an endpoint that exists', () => {
    expect(existsSync(path.join(ROOT, 'src/pages/dashboard/agentics/reports.astro'))).toBe(true);
    expect(REPORTS_PATH).toBe('/dashboard/agentics/reports');
    expect(reportHref('abc')).toBe('/dashboard/agentics/reports/abc');
    expect(existsSync(path.join(ROOT, 'src/pages/dashboard/agentics/reports/[id].astro'))).toBe(true);
    expect(pdfHref('abc')).toBe('/api/agentics/reports/pdf?id=abc');
    expect(existsSync(path.join(ROOT, 'src/pages/api/agentics/reports/pdf.ts'))).toBe(true);
    expect(bundleHref('abc')).toBe('/api/agentics/reports/bundle?id=abc');
    expect(existsSync(path.join(ROOT, 'src/pages/api/agentics/reports/bundle.ts'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'src/pages/verify-record.astro'))).toBe(true);
    expect(VERIFY_RECORD_PATH).toBe('/verify-record');
  });

  it('an id is encoded, so it can never change the path or the query', () => {
    expect(reportHref('a b/c?x=1')).toBe('/dashboard/agentics/reports/a%20b%2Fc%3Fx%3D1');
    expect(pdfHref('a&b=c')).toBe('/api/agentics/reports/pdf?id=a%26b%3Dc');
  });
});
