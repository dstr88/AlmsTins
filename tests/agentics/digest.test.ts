import { describe, it, expect, vi } from 'vitest';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';
import { brightLineViolations } from '../helpers/brightLineWording';
import { buildReport, dayBounds, type ReportContent } from '../../src/lib/agentVault/report';
import { attentionOf, composeDigest, countsOf, digestPeriod, emptyCounts, mondayOf, shouldSend, type DigestCounts } from '../../src/lib/agentVault/digest';
import { digestLead, en, getAgentReportEmail, reportsLink } from '../../src/i18n/emails/agentReport';
import type { LedgerEvent } from '../../src/lib/agentVault/events';

/**
 * The digest an account asked for, as pure rules: which period each cadence covers, the numbers, whether
 * it is worth sending, and the email's subject and text. The subject leads with whether action is
 * needed; the body is counts and a link and never an address, a label or an amount. No database: the
 * imports below need '@/lib/db' only because events.ts and store.ts load it. Every address, label and amount is invented.
 */
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const APP = 'https://almstins.test';
let n = 0;
const at = (day: string, h: number, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const check = (address: string, basis: string, answer: LedgerEvent['answer'], when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 't', kind: 'checked', at: when, address, chain: 'ethereum', answer,
  registry: 'trusted', status: 'unknown', keyId: 'k', sourceIp: null, tx: null, detail: { basis },
});
const move = (usd: number | null, when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 't', kind: 'transaction', at: when, address: addr(2), chain: 'ethereum',
  answer: 'unknown', registry: 'trusted', status: null, keyId: null, sourceIp: null,
  tx: { hash: txHash(n), direction: 'out', wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 }, detail: {},
});
const DAY = '2026-10-17';
const content = (events: LedgerEvent[], label = 'Agent'): ReportContent => {
  const { start, end } = dayBounds(DAY);
  return buildReport(events, { tin: { id: 't', label }, period: { start, end, partial: false }, labels: new Map([[addr(1), 'Ops wallet']]) });
};
const counts = (over: Partial<DigestCounts> = {}): DigestCounts => ({ ...emptyCounts(), agents: 1, ...over });

describe('the numbers of a digest', () => {
  it('add up the agents that had activity: addresses per group, and the checks that came back clear', () => {
    const a = content([check(addr(1), 'registry_flagged', 'flagged', at(DAY, 8)), check(addr(5), 'domain_proof', 'proven', at(DAY, 9)), check(addr(5), 'domain_proof', 'proven', at(DAY, 10))]);
    const b = content([check(addr(3), 'not_in_registry', 'unknown', at(DAY, 8)), check(addr(4), 'registered_first_check', 'unknown', at(DAY, 9))]);
    expect(countsOf([a, b])).toEqual({ agents: 2, issues: 1, notConfirmed: 1, new: 1, noIssues: 1, checks: 5, noIssuesChecks: 2 });
  });

  it('an agent with nothing in the period is not an agent with activity', () => {
    expect(countsOf([content([])])).toEqual(emptyCounts());
    expect(countsOf([])).toEqual(emptyCounts());
    expect(countsOf([content([move(5, at(DAY, 9))])]).agents).toBe(1); // transfers alone are activity
  });

  it('what needs a look is had issues plus not confirmed: new and clear do not', () => {
    expect(attentionOf(counts({ issues: 2, notConfirmed: 3, new: 9, noIssues: 9 }))).toBe(5);
    expect(attentionOf(counts({ new: 9, noIssues: 9 }))).toBe(0);
  });
});

describe('whether a digest is worth sending', () => {
  it('never when no agent had any activity, whatever the cadence', () => {
    for (const c of ['daily', 'weekly', 'issues'] as const) expect(shouldSend(c, emptyCounts()), c).toBe(false);
  });

  it('daily and weekly send for any activity, a quiet day included', () => {
    expect(shouldSend('daily', counts({ noIssues: 4, noIssuesChecks: 40, checks: 40 }))).toBe(true);
    expect(shouldSend('weekly', counts({ noIssues: 4, noIssuesChecks: 40, checks: 40 }))).toBe(true);
    expect(shouldSend('daily', counts({ issues: 1 }))).toBe(true);
  });

  it('only-when-needed sends only when something needs a look', () => {
    expect(shouldSend('issues', counts({ noIssues: 4, noIssuesChecks: 40, checks: 40, new: 3 }))).toBe(false);
    expect(shouldSend('issues', counts({ issues: 1 }))).toBe(true);
    expect(shouldSend('issues', counts({ notConfirmed: 1 }))).toBe(true);
  });
});

describe('the period each cadence covers, and the key that names it', () => {
  it('Monday is the start of the week, whatever day it is asked on', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // a Monday
    expect(mondayOf('2026-10-20')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // the Sunday after it
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // across a year end
  });

  it('daily and only-when-needed cover yesterday, and are named by cadence and day', () => {
    expect(digestPeriod('daily', '2026-10-18')).toEqual({ kind: 'day', from: '2026-10-17', to: '2026-10-17', key: 'daily:2026-10-17' });
    expect(digestPeriod('issues', '2026-10-18')).toEqual({ kind: 'day', from: '2026-10-17', to: '2026-10-17', key: 'issues:2026-10-17' });
    expect(digestPeriod('daily', '2026-11-01')).toMatchObject({ from: '2026-10-31' });
  });

  it('weekly covers the seven days before this week began, the same whatever day of this week it runs', () => {
    const monday = digestPeriod('weekly', '2026-10-19');
    expect(monday).toEqual({ kind: 'week', from: '2026-10-12', to: '2026-10-18', key: 'weekly:2026-10-12' });
    for (const day of ['2026-10-20', '2026-10-22', '2026-10-25']) expect(digestPeriod('weekly', day), day).toEqual(monday);
    expect(digestPeriod('weekly', '2026-10-26')).toMatchObject({ from: '2026-10-19', to: '2026-10-25' });
    expect(digestPeriod('weekly', '2027-01-04')).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
  });

  it('keys of different cadences or periods never collide, so changing cadence never suppresses the first digest of the new one', () => {
    const keys = new Set([digestPeriod('daily', '2026-10-18').key, digestPeriod('issues', '2026-10-18').key, digestPeriod('weekly', '2026-10-19').key, digestPeriod('daily', '2026-10-19').key]);
    expect(keys.size).toBe(4);
  });
});

describe('the subject leads with whether action is needed', () => {
  const lead = (over: Partial<{ issues: number; notConfirmed: number; clearChecks: number }>) => digestLead({ issues: 0, notConfirmed: 0, clearChecks: 0, ...over });

  it('says how many need attention, in the singular and the plural', () => {
    expect(lead({ issues: 1 })).toBe('1 needs your attention');
    expect(lead({ issues: 1, notConfirmed: 1 })).toBe('2 need your attention');
    expect(lead({ issues: 2, notConfirmed: 1, clearChecks: 900 })).toBe('3 need your attention');
    expect(lead({ issues: 1200, notConfirmed: 34 })).toBe('1,234 need your attention');
  });

  it('says "no flags" and how many checks when nothing needs attention', () => {
    expect(lead({ clearChecks: 1284 })).toBe('No flags, 1,284 checks');
    expect(lead({ clearChecks: 1 })).toBe('No flags, 1 check');
    expect(lead({ clearChecks: 2 })).toBe('No flags, 2 checks');
  });

  it('never calls a check verified or a day all clear: consistent with history is not verified', () => {
    const states = [
      counts({}), counts({ new: 4 }), counts({ noIssuesChecks: 1 }), counts({ noIssuesChecks: 1284, noIssues: 9 }), counts({ issues: 1, noIssuesChecks: 12 }),
      counts({ notConfirmed: 3, noIssuesChecks: 12 }), counts({ agents: 2, issues: 5, notConfirmed: 2, new: 1, noIssues: 8, noIssuesChecks: 300 }),
    ];
    for (const kind of ['day', 'week'] as const) {
      for (const c of states) {
        const m = composeDigest(kind === 'day' ? { kind, from: DAY, to: DAY } : { kind, from: '2026-10-11', to: DAY }, c, APP);
        expect(`${m.subject}\n${m.text}`, JSON.stringify(c)).not.toMatch(/\bverified\b|\ball clear\b/i);
      }
    }
    const alert = getAgentReportEmail('en').alert({ appBase: APP });
    expect(`${alert.subject}\n${alert.text}`).not.toMatch(/\bverified\b|\ball clear\b/i);
  });

  it('says nothing needs attention when there is nothing to call clear either', () => {
    expect(lead({})).toBe('Nothing needs your attention');
  });

  it('puts the period after the lead, for a day and for a week', () => {
    const day = composeDigest({ kind: 'day', from: '2026-10-17', to: '2026-10-17' }, counts({ issues: 2, notConfirmed: 1 }), APP);
    expect(day.subject).toBe('3 need your attention · Agent report, Oct 17, 2026');
    const quiet = composeDigest({ kind: 'day', from: '2026-10-17', to: '2026-10-17' }, counts({ noIssuesChecks: 1284 }), APP);
    expect(quiet.subject).toBe('No flags, 1,284 checks · Agent report, Oct 17, 2026');
    const week = composeDigest({ kind: 'week', from: '2026-10-12', to: '2026-10-18' }, counts({ notConfirmed: 1 }), APP);
    expect(week.subject).toBe('1 needs your attention · Agent report, Oct 12 to Oct 18, 2026');
    const none = composeDigest({ kind: 'day', from: '2026-10-17', to: '2026-10-17' }, counts({ new: 4 }), APP);
    expect(none.subject).toBe('Nothing needs your attention · Agent report, Oct 17, 2026');
    // The first words of every subject are the answer to "do I need to do something?"
    for (const m of [day, quiet, week, none]) expect(m.subject).toMatch(/^(\d[\d,]* needs? your attention|No flags, [\d,]+ checks?|Nothing needs your attention) · /);
  });
});

describe('the body of a digest', () => {
  it('for a day that needs attention: the counts, the link, and the reason it is quiet about the rest', () => {
    const m = composeDigest({ kind: 'day', from: '2026-10-17', to: '2026-10-17' }, counts({ agents: 3, issues: 1, notConfirmed: 1, new: 3, noIssues: 12, noIssuesChecks: 1284 }), APP);
    expect(m.text).toBe(
      [
        'Agent report for October 17, 2026 (UTC)',
        '',
        '2 need your attention.',
        '  Had issues: 1',
        '  Not confirmed: 1',
        'New (first check of a registered address): 3',
        'Checks that came back proven or consistent with history: 1,284',
        'Agents with activity: 3',
        '',
        'View the full report (sign-in required):',
        'https://almstins.test/dashboard/agentics/reports',
        '',
        'This email carries counts only. Addresses, labels and amounts stay behind your sign-in.',
        'A clear result means the checks that ran came back without a flag. It is not a statement that an address is safe.',
        '',
        'You are getting this because you turned on report emails. To change how often, or to turn them off, open the Reports page.',
        '',
        'Almstins',
      ].join('\n'),
    );
  });

  it('for a quiet day: it says nothing needs attention and does not list zero groups', () => {
    const m = composeDigest({ kind: 'day', from: '2026-10-17', to: '2026-10-17' }, counts({ noIssues: 4, noIssuesChecks: 40 }), APP);
    expect(m.text).toContain('Nothing needs your attention.');
    expect(m.text).not.toContain('Had issues');
    expect(m.text).not.toContain('Not confirmed');
    expect(m.text).toContain('Checks that came back proven or consistent with history: 40');
  });

  it('for a week: names the seven days, and says so', () => {
    const m = composeDigest({ kind: 'week', from: '2026-10-12', to: '2026-10-18' }, counts({ issues: 1 }), APP);
    expect(m.text.split('\n')[0]).toBe('Agent report for October 12, 2026 to October 18, 2026 (UTC)');
  });

  it('links to the Reports page behind the sign-in, wherever the site is', () => {
    expect(reportsLink('https://almstins.com')).toBe('https://almstins.com/dashboard/agentics/reports');
    expect(reportsLink('https://almstins.com/')).toBe('https://almstins.com/dashboard/agentics/reports');
    expect(composeDigest({ kind: 'day', from: DAY, to: DAY }, counts({ issues: 1 }), 'http://localhost:4321').text).toContain('http://localhost:4321/dashboard/agentics/reports');
  });

  it('carries no wallet address, no label of an address or an agent, and no amount of money, whatever the report holds', () => {
    const events = [
      check(addr(1), 'registry_flagged', 'flagged', at(DAY, 8)),
      check(addr(3), 'not_in_registry', 'unknown', at(DAY, 9)),
      move(1270.56, at(DAY, 12)),
      move(null, at(DAY, 13)),
    ];
    const c = countsOf([content(events, 'Treasury agent <secret name>')]);
    for (const period of [{ kind: 'day' as const, from: DAY, to: DAY }, { kind: 'week' as const, from: '2026-10-11', to: DAY }]) {
      const m = composeDigest(period, c, APP);
      const all = `${m.subject}\n${m.text}`;
      for (const secret of [addr(1), addr(3), addr(2), 'Ops wallet', 'Treasury agent', 'secret name', '1270', '1,270', '$', '0x', txHash(1)]) {
        expect(all, `${period.kind}: ${secret}`).not.toContain(secret);
      }
      // Nothing in it looks like an address or a dollar amount.
      expect(all).not.toMatch(/0x[0-9a-fA-F]{6,}|\$\s?\d/);
    }
  });

  it('keeps to the product\'s words: nothing stopped, nothing called safe outside a denial, no tax words', () => {
    const all = [
      composeDigest({ kind: 'day', from: DAY, to: DAY }, counts({ issues: 1, notConfirmed: 2, new: 1, noIssuesChecks: 5 }), APP),
      composeDigest({ kind: 'day', from: DAY, to: DAY }, counts({ noIssuesChecks: 5 }), APP),
      composeDigest({ kind: 'week', from: '2026-10-11', to: DAY }, counts({}), APP),
      getAgentReportEmail('en').alert({ appBase: APP }),
    ];
    for (const m of all) {
      const text = `${m.subject}\n${m.text}`;
      expect(brightLineViolations(text)).toEqual([]);
      expect(text).not.toMatch(/\b(blocked|stopped|halted|rejected|refused)\b/i);
      expect(text).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\bloss\b|\bnet\b|\b8949\b/i);
      for (const sentence of text.split(/(?<=[.!?])\s+/)) if (/\bsafe\b/i.test(sentence)) expect(sentence).toMatch(/\b(never|not|no)\b/i);
    }
  });
});

describe('the alert email', () => {
  const m = en.alert({ appBase: APP });

  it('leads with the action: a check came back flagged on a registered address', () => {
    expect(m.subject).toBe('Action needed: a check on a registered address came back flagged');
  });

  it('says a person should look, shows no address, and links to the Reports page behind the sign-in', () => {
    expect(m.text).toContain('A person should look at it before anything is sent to that address.');
    expect(m.text).toContain('This email does not show the address.');
    expect(m.text).toContain('https://almstins.test/dashboard/agentics/reports');
    expect(m.text).toContain('at most one an hour for the same address');
    expect(`${m.subject}\n${m.text}`).not.toMatch(/0x[0-9a-fA-F]{6,}|\$\s?\d/);
  });

  it('says what Almstins does and does not do, in the product\'s verbs', () => {
    expect(m.text).toContain('Almstins flags and records. It does not hold or move funds and is never in the payment path.');
  });
});

describe('every language gets the English text, for now', () => {
  it('has one locale', () => {
    expect(getAgentReportEmail('es')).toBe(en);
    expect(getAgentReportEmail('fr')).toBe(en);
    expect(getAgentReportEmail('en')).toBe(en);
  });
});
