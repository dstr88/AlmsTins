import { describe, it, expect, vi } from 'vitest';
import { fakeScreening, walletResult } from '../helpers/agentVault';
import { screenForCheck, screeningOf, SCREEN_TIMEOUT_MS } from '../../src/lib/agentVault/checkScreening';
import { alertKindOf, ALERT_KINDS } from '../../src/lib/agentVault/alerts';
import { getAgentReportEmail } from '../../src/i18n/emails/agentReport';
import { reasonText } from '../../src/lib/agentVault/reportText';

/**
 * The screening a keyed check runs (src/lib/agentVault/checkScreening.ts), with the warm-address cache
 * in front of it, and what a screening hit is called in the alert email. The screening and the cache
 * are in-memory stand-ins (tests/helpers/agentVault.ts fakeScreening); no network, no database. Every
 * address and account is invented.
 */

// alerts.ts reaches the database through its delivery store; nothing here runs a query.
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const A = 'tenant-a';
const B = 'tenant-b';
const ADDR = '0x00000000000000000000000000000000c0ffee01';
const NOW = new Date('2026-11-05T14:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const MIN = 60_000;

describe('screeningOf: what a public-checker answer comes to for a check', () => {
  const at = '2026-11-05T13:59:59.000Z';

  it('passes only when the sanctions check and the security screening both ran and found nothing', () => {
    expect(screeningOf(walletResult(), at)).toMatchObject({ result: 'pass', hits: [], limits: [] });
  });

  it('fails on a sanctions hit or a security flag, even in a partial answer', () => {
    expect(screeningOf(walletResult({ flags: { sanctioned: true } }), at)).toMatchObject({ result: 'fail', hits: ['sanctioned'] });
    expect(screeningOf(walletResult({ flags: { phishing: true }, coverage: { goplus: 'error' } }), at)).toMatchObject({ result: 'fail', hits: ['phishing'] });
  });

  it('is limited when a source did not run, or when there is no answer at all, and never a pass', () => {
    expect(screeningOf(walletResult({ coverage: { goplus: 'skipped' } }), at)).toMatchObject({ result: 'limited', limits: ['screening'] });
    expect(screeningOf(walletResult({ coverage: { sanctions: 'error' } }), at)).toMatchObject({ result: 'limited', limits: ['sanctions'] });
    expect(screeningOf(null, at)).toMatchObject({ result: 'limited', limits: ['sanctions', 'screening'] });
  });

  it('leaves the Verify part out: the check answers that from the registry it already read', () => {
    const s = screeningOf(walletResult(), at);
    expect(s.limits).not.toContain('verify');
    expect(s.hits).not.toContain('claimedElsewhere');
  });
});

describe('screenForCheck: the warm-address cache in front of a fresh screening', () => {
  it('screens fresh on a miss, keeps a pass, and answers the next check from the cache with the original time', async () => {
    const s = fakeScreening();
    s.answers[ADDR] = walletResult({ checkedAt: '2026-11-05T13:59:58.000Z' });
    const first = await screenForCheck(A, ADDR, NOW, s);
    expect(first).toMatchObject({ result: 'pass', cached: false, checkedAt: '2026-11-05T13:59:58.000Z' });
    expect(s.calls.screen).toEqual([ADDR]);

    const second = await screenForCheck(A, ADDR, later(4 * MIN), s);
    expect(second).toEqual({ result: 'pass', hits: [], limits: [], checkedAt: '2026-11-05T13:59:58.000Z', cached: true });
    // A hit asks no screening source.
    expect(s.calls.screen).toEqual([ADDR]);
  });

  it('is per account: another account screens the same address itself', async () => {
    const s = fakeScreening();
    await screenForCheck(A, ADDR, NOW, s);
    expect(await screenForCheck(B, ADDR, later(MIN), s)).toMatchObject({ cached: false });
    expect(s.calls.screen).toEqual([ADDR, ADDR]);
  });

  it('screens fresh again after ten minutes without a check', async () => {
    const s = fakeScreening();
    await screenForCheck(A, ADDR, NOW, s);
    expect(await screenForCheck(A, ADDR, later(10 * MIN), s)).toMatchObject({ cached: false });
    expect(s.calls.screen).toHaveLength(2);
  });

  it('never keeps a failed screening, and evicts the address', async () => {
    const s = fakeScreening();
    s.answers[ADDR] = walletResult({ flags: { sanctioned: true } });
    const out = await screenForCheck(A, ADDR, NOW, s);
    expect(out).toMatchObject({ result: 'fail', hits: ['sanctioned'], cached: false });
    expect(out.readout?.result).toBe('fail');
    expect(s.calls.evict).toEqual([ADDR]);
    expect(await screenForCheck(A, ADDR, later(MIN), s)).toMatchObject({ result: 'fail', cached: false });
    expect(s.calls.screen).toHaveLength(2);
  });

  it('never keeps a limited screening', async () => {
    const s = fakeScreening();
    s.answers[ADDR] = walletResult({ coverage: { goplus: 'error' } });
    expect(await screenForCheck(A, ADDR, NOW, s)).toMatchObject({ result: 'limited', cached: false });
    expect(s.warm.rows.size).toBe(0);
  });

  it('answers limited, asking nothing, when the account has used up its checks for the minute', async () => {
    const s = fakeScreening();
    s.budget = false;
    expect(await screenForCheck(A, ADDR, NOW, s)).toEqual({ result: 'limited', hits: [], limits: ['sanctions', 'screening'], checkedAt: null, cached: false });
    expect(s.calls.screen).toEqual([]);
  });

  it('a cached pass costs nothing from the budget', async () => {
    const s = fakeScreening();
    await screenForCheck(A, ADDR, NOW, s);
    s.budget = false;
    expect(await screenForCheck(A, ADDR, later(MIN), s)).toMatchObject({ result: 'pass', cached: true });
  });

  it('answers limited when the screening throws or takes too long', async () => {
    const s = fakeScreening();
    s.answers[ADDR] = new Error('upstream down');
    expect(await screenForCheck(A, ADDR, NOW, s)).toMatchObject({ result: 'limited', checkedAt: null });
    const slow = fakeScreening();
    slow.timeoutMs = 20;
    slow.screen = () => new Promise(() => {});
    expect(await screenForCheck(A, ADDR, NOW, slow)).toMatchObject({ result: 'limited', cached: false });
    expect(SCREEN_TIMEOUT_MS).toBe(12_000);
  });

  it('a cache that cannot be read is a miss, and one that cannot be written changes no answer', async () => {
    const s = fakeScreening();
    s.warm.take = async () => { throw new Error('connection lost'); };
    s.warm.put = async () => { throw new Error('connection lost'); };
    expect(await screenForCheck(A, ADDR, NOW, s)).toMatchObject({ result: 'pass', cached: false });
    expect(s.calls.screen).toEqual([ADDR]);
  });

  it('never puts a screening time later than the check', async () => {
    const s = fakeScreening();
    s.answers[ADDR] = walletResult({ checkedAt: '2026-11-05T15:00:00.000Z' });
    expect(await screenForCheck(A, ADDR, NOW, s)).toMatchObject({ checkedAt: NOW.toISOString() });
  });
});

describe('a screening hit in the alert and the report', () => {
  it('has its own alert kind, emailed always, whatever the public status', () => {
    expect(ALERT_KINDS).toContain('screening');
    for (const status of ['proven', 'mismatch', 'unanchored', 'unknown']) expect(alertKindOf('screening_flagged', status)).toBe('screening');
  });

  it('reads Flagged in the email, says it was the screening, and shows no address', () => {
    const mail = getAgentReportEmail('en').alert({ appBase: 'https://almstins.example', kind: 'screening' });
    expect(mail.subject).toBe('Action needed: a check came back Flagged');
    expect(mail.text).toContain('the sanctions or security screening Almstins ran on it at that moment found something');
    expect(mail.text).not.toMatch(/0x[0-9a-f]{40}/i);
    expect(mail.text).not.toMatch(/\bsafe\b/i);
  });

  it('gives the report a reason in plain words', () => {
    expect(reasonText('screening_flagged')).toBe('Flagged. The sanctions or security screening run on this check found something. A person should review it.');
  });
});
