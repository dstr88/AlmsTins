import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk, fakeDeps, type FakeDeps } from '../helpers/agentVault';

/**
 * The real-time alert: when a keyed check answers `flagged` for a registered destination, the
 * operator is told at once, if the account turned alerts on, at most once an hour per address, and
 * never in a way that can change the answer the agent gets. Over the real SQL run by the in-memory
 * stand-in for the database. Nothing real is called: the mail and the recipient lookup are replaced.
 * Every address, key, tenant and email is invented.
 */
const holder = vi.hoisted(() => ({
  db: null as any,
  intercept: null as null | ((sql: string, args: unknown[]) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      holder.intercept?.(sql.replace(/\s+/g, ' ').trim(), typeof s === 'string' ? [] : s.args ?? []);
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [] }));
const outbox = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string }>,
  inboxes: {} as Record<string, string | null>,
  fail: false,
}));
vi.mock('@/lib/email', () => ({
  sendMail: async (mail: { to: string; subject: string; text: string }) => {
    if (outbox.fail) throw Object.assign(new Error(`smtp refused ${mail.to}`), { name: 'SmtpError', code: 'ECONNRESET' });
    outbox.sent.push(mail);
  },
}));
vi.mock('@/lib/verifyAlertRecipient', () => ({
  resolveAlertRecipient: async (tenantId: string) => ({ email: outbox.inboxes[tenantId] ?? null, lang: 'en' }),
}));

const A = 'tenant-a';
const B = 'tenant-b';
const KEY_1 = 'a1'.repeat(12);
const KEY_2 = 'b2'.repeat(12);
const NOW = new Date('2026-10-18T12:00:00.123Z');
const APP = 'https://almstins.test';

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let vault: typeof import('../../src/lib/agentVault/vault');
let delivery: typeof import('../../src/lib/agentVault/deliveryStore');
let alerts: typeof import('../../src/lib/agentVault/alerts');
let checkLog: typeof import('../../src/lib/agentVault/checkLog');
let deps: FakeDeps;

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587'); // the Vault's own sender refuses to send with none
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  outbox.sent = [];
  outbox.fail = false;
  outbox.inboxes = { [A]: 'operator-a@example.test', [B]: 'operator-b@example.test' };
  keys.byTenant = { [A]: [{ id: KEY_1, status: 'active' }, { id: KEY_2, status: 'active' }], [B]: [] };
  deps = fakeDeps();
  await fake.execute({
    sql: `CREATE TABLE IF NOT EXISTS verify_agent_keys (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`,
    args: [],
  });
  fake.seed('verify_agent_keys', { id: KEY_1, tenant_id: A, domain: 'agent-a.example', status: 'active' });
  fake.seed('verify_agent_keys', { id: KEY_2, tenant_id: A, domain: 'agent-a2.example', status: 'active' });
  store = await import('../../src/lib/agentVault/store');
  vault = await import('../../src/lib/agentVault/vault');
  delivery = await import('../../src/lib/agentVault/deliveryStore');
  alerts = await import('../../src/lib/agentVault/alerts');
  checkLog = await import('../../src/lib/agentVault/checkLog');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const alertDeps = (now: Date = NOW) => ({
  now: () => now,
  recipient: async (tenantId: string) => outbox.inboxes[tenantId] ?? null,
  send: async (mail: { to: string; subject: string; text: string }) => {
    if (outbox.fail) throw Object.assign(new Error(`smtp refused ${mail.to}`), { name: 'SmtpError', code: 'ECONNRESET' });
    outbox.sent.push(mail);
  },
  appBase: APP,
});
const info = (over: Partial<import('../../src/lib/agentVault/alerts').FlaggedCheckInfo> = {}) => ({ tenantId: A, tinId: 'tin-1', address: addr(1), ...over });
const turnOn = (tenant = A, alertsOn = true) => delivery.writeSettings(tenant, { cadence: 'off', alerts: alertsOn }, '2026-10-01 00:00:00');

describe('alertFlaggedCheck', () => {
  it('says nothing until the account turned alerts on, and claims nothing', async () => {
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('alerts_off');
    await turnOn(A, false);
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('alerts_off');
    expect(outbox.sent).toEqual([]);
    expect(fake.rows('agent_alert_claims') ?? []).toEqual([]);
  });

  it('tells the verified operator email once, with the email that leads with the action and links to the Reports page', async () => {
    await turnOn();
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('sent');
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0].to).toBe('operator-a@example.test');
    expect(outbox.sent[0].subject).toBe('Action needed: a check on a registered address came back flagged');
    expect(outbox.sent[0].text).toContain('https://almstins.test/dashboard/agentics/reports');
    expect(`${outbox.sent[0].subject}\n${outbox.sent[0].text}`).not.toContain(addr(1));
    expect(fake.rows('agent_alert_claims')).toEqual([expect.objectContaining({ tenant_id: A, tin_id: 'tin-1', address: addr(1), last_sent_at: NOW.toISOString() })]);
  });

  it('at most one an hour for the same address of the same agent: the second is rate limited', async () => {
    await turnOn();
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('sent');
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 30 * 60_000)))).toBe('rate_limited');
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 60 * 60_000)))).toBe('rate_limited'); // exactly an hour is not yet past it
    expect(outbox.sent).toHaveLength(1);
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 60 * 60_000 + 1)))).toBe('sent');
    expect(outbox.sent).toHaveLength(2);
    expect(fake.rows('agent_alert_claims')).toHaveLength(1); // one row per address, moved forward
    expect(fake.rows('agent_alert_claims')[0].last_sent_at).toBe(new Date(NOW.getTime() + 60 * 60_000 + 1).toISOString());
  });

  it('a different address, agent or account is its own alert', async () => {
    await turnOn(A);
    await turnOn(B);
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('sent');
    expect(await alerts.alertFlaggedCheck(info({ address: addr(2) }), alertDeps())).toBe('sent');
    expect(await alerts.alertFlaggedCheck(info({ tinId: 'tin-2' }), alertDeps())).toBe('sent');
    expect(await alerts.alertFlaggedCheck(info({ tenantId: B }), alertDeps())).toBe('sent');
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('rate_limited');
    expect(outbox.sent.map((m) => m.to)).toEqual(['operator-a@example.test', 'operator-a@example.test', 'operator-a@example.test', 'operator-b@example.test']);
  });

  it('a burst of flagged checks at once sends one email, however many see them', async () => {
    await turnOn();
    const results = await Promise.all(Array.from({ length: 12 }, () => alerts.alertFlaggedCheck(info(), alertDeps())));
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'rate_limited')).toHaveLength(11);
    expect(outbox.sent).toHaveLength(1);
    expect(fake.rows('agent_alert_claims')).toHaveLength(1);
  });

  it('with no email address on file it sends nothing and does not use up the hour', async () => {
    await turnOn();
    outbox.inboxes[A] = null;
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('no_recipient');
    expect(fake.rows('agent_alert_claims') ?? []).toEqual([]);
    outbox.inboxes[A] = 'operator-a@example.test';
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('sent');
  });

  it('a mail that will not send is reported, never thrown, and logs no address', async () => {
    await turnOn();
    outbox.fail = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('failed');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('SmtpError');
    expect(logged).toContain('ECONNRESET');
    expect(logged).not.toContain('operator-a@example.test');
    expect(logged).not.toContain(addr(1));
  });

  it('a send that fails gives the hour back: the next flagged check on that address tries again', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    outbox.fail = true;
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('failed');
    expect(outbox.sent).toEqual([]);
    outbox.fail = false; // the mail system is back a minute later
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 60_000)))).toBe('sent');
    expect(outbox.sent).toHaveLength(1);
    // And now that one did go, the hour is spent as it always was.
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 120_000)))).toBe('rate_limited');
  });

  it('a failed send after an alert that did go earlier leaves the address free for the next check, not held for an hour that never produced an email', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('sent');
    const later = new Date(NOW.getTime() + 2 * 60 * 60_000);
    outbox.fail = true;
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(later))).toBe('failed');
    expect(fake.rows('agent_alert_claims')).toEqual([expect.objectContaining({ last_sent_at: delivery.NEVER_ALERTED })]);
    outbox.fail = false;
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(later.getTime() + 1_000)))).toBe('sent');
    expect(outbox.sent).toHaveLength(2);
  });

  it('a failed first alert leaves the address as if it had never been alerted about', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    outbox.fail = true;
    await alerts.alertFlaggedCheck(info(), alertDeps());
    expect(fake.rows('agent_alert_claims')).toEqual([expect.objectContaining({ last_sent_at: delivery.NEVER_ALERTED })]);
    expect(delivery.NEVER_ALERTED < new Date(NOW.getTime() - alerts.ALERT_WINDOW_MS).toISOString()).toBe(true);
  });

  it('a burst of flagged checks while the mail is down sends nothing, and the next check after it retries', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = { ...alertDeps(), send: async () => { throw Object.assign(new Error('refused'), { name: 'SmtpError', code: 'ECONNRESET' }); } };
    const results = await Promise.all(Array.from({ length: 8 }, () => alerts.alertFlaggedCheck(info(), down)));
    expect(results.every((r) => r === 'failed' || r === 'rate_limited')).toBe(true);
    expect(results).toContain('failed');
    expect(outbox.sent).toEqual([]);
    expect(await alerts.alertFlaggedCheck(info(), alertDeps(new Date(NOW.getTime() + 1_000)))).toBe('sent');
    expect(outbox.sent).toHaveLength(1);
  });

  it('a burst whose first send fails still sends at most one email: the claim is given back only for a send that failed', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const flaky = {
      ...alertDeps(),
      send: async (mail: { to: string; subject: string; text: string }) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('refused'), { name: 'SmtpError', code: 'ECONNRESET' });
        outbox.sent.push(mail);
      },
    };
    const results = await Promise.all(Array.from({ length: 12 }, () => alerts.alertFlaggedCheck(info(), flaky)));
    expect(results.filter((r) => r === 'failed')).toHaveLength(1);
    expect(results.filter((r) => r === 'sent').length).toBeLessThanOrEqual(1);
    expect(outbox.sent.length).toBeLessThanOrEqual(1);
    // Whichever way the burst fell (the first failure's claim given back before some of the others
    // looked, or after all of them did), one more check leaves exactly one email sent in all.
    await alerts.alertFlaggedCheck(info(), flaky);
    expect(outbox.sent).toHaveLength(1);
  });

  it('a claim that cannot be given back is logged by name and code, and the failure is still only reported', async () => {
    await turnOn();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    outbox.fail = true;
    holder.intercept = (sql) => {
      if (/^UPDATE agent_alert_claims SET last_sent_at = \? WHERE .* AND last_sent_at = \?$/.test(sql)) throw Object.assign(new Error(`lost the connection for ${addr(1)}`), { name: 'DatabaseError', code: '57P01' });
    };
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('failed');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('SmtpError'); // the send failure
    expect(logged).toContain('DatabaseError'); // and the release that failed
    expect(logged).toContain('57P01');
    expect(logged).not.toContain(addr(1));
    expect(logged).not.toContain('operator-a@example.test');
  });

  it('giving a claim back leaves it alone when it is no longer the one that was made', async () => {
    expect(await delivery.claimAlert(A, 'tin-1', addr(1), '2026-10-18T12:00:00.000Z', '2026-10-18T11:00:00.000Z')).toBe(true);
    fake.rows('agent_alert_claims')[0].last_sent_at = '2026-10-18T14:00:00.000Z'; // another caller's later claim
    await delivery.releaseAlert(A, 'tin-1', addr(1), '2026-10-18T12:00:00.000Z');
    expect(fake.rows('agent_alert_claims')[0].last_sent_at).toBe('2026-10-18T14:00:00.000Z');
    await delivery.releaseAlert(B, 'tin-1', addr(1), '2026-10-18T14:00:00.000Z'); // another account's call reaches nothing
    expect(fake.rows('agent_alert_claims')[0].last_sent_at).toBe('2026-10-18T14:00:00.000Z');
    await delivery.releaseAlert(A, 'tin-1', addr(1), '2026-10-18T14:00:00.000Z'); // the claim that is there: given back
    expect(fake.rows('agent_alert_claims')[0].last_sent_at).toBe(delivery.NEVER_ALERTED);
  });

  it('with no mail transport the Vault\'s sender fails, so the alert is "failed" and the hour is not spent (not "sent")', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('EMAIL_SERVER', '');
    const withDefaultSender = { ...alerts.defaultAlertDeps(), now: () => NOW, recipient: async () => 'operator-a@example.test' };
    expect(await alerts.alertFlaggedCheck(info(), withDefaultSender)).toBe('failed');
    expect(outbox.sent).toEqual([]);
    expect(JSON.stringify((console.error as any).mock.calls)).toContain('E_NO_MAIL_TRANSPORT');
    vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587');
    expect(await alerts.alertFlaggedCheck(info(), { ...withDefaultSender, now: () => new Date(NOW.getTime() + 1_000) })).toBe('sent');
    expect(outbox.sent).toHaveLength(1);
  });

  it('a lookup or a database that fails is reported, never thrown', async () => {
    await turnOn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...alertDeps(), recipient: async () => { throw new Error('directory down'); } };
    expect(await alerts.alertFlaggedCheck(info(), broken)).toBe('failed');
    holder.intercept = (sql) => { if (/agent_alert_claims/.test(sql)) throw Object.assign(new Error('relation exploded'), { code: 'XX000' }); };
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('failed');
    holder.intercept = (sql) => { if (/agent_report_settings/.test(sql) && /^SELECT/.test(sql)) throw new Error('settings down'); };
    expect(await alerts.alertFlaggedCheck(info(), alertDeps())).toBe('failed');
  });

  it('an account that was never set up (no row at all) is simply off', async () => {
    expect(await alerts.alertFlaggedCheck(info({ tenantId: 'someone-new' }), alertDeps())).toBe('alerts_off');
  });
});

describe('what starts the alert: a keyed check that is flagged for a registered address', () => {
  const KEYED = (over: Partial<import('../../src/lib/agentVault/checkLog').KeyedCheckInput> = {}) => ({
    keyId: KEY_1, value: addr(1), status: 'unknown' as const, level: null, domain: null, proofAgeDays: null, sourceIp: '203.0.113.9', now: NOW, ...over,
  });
  const tinWith = async (text: string) => {
    const tin = expectOk(await vault.createTin(A, { label: 'Treasury agent', agentKeyId: KEY_1 })).tin;
    if (text) expectOk(await vault.addDestinations(A, { tinId: tin.id, text }, deps));
    return tin;
  };
  const events = () => fake.rows('agent_events');

  it('a domain mismatch on a trusted address calls the alert once, with the account, agent and address, after the event is written', async () => {
    const tin = await tinWith(addr(1));
    const seen: Array<{ info: unknown; eventsThen: number }> = [];
    const block = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged: (i) => { seen.push({ info: i, eventsThen: events().length }); } });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].info).toEqual({ tenantId: A, tinId: tin.id, address: addr(1) });
    expect(seen[0].eventsThen).toBe(1); // the check was already on the ledger
    expect(block).toMatchObject({ answer: 'flagged', registry: 'trusted', logged: true });
  });

  it('a flag in the registry calls it too', async () => {
    const tin = await tinWith('');
    const d = (await store.insertDestination(A, { tinId: tin.id, chain: 'ethereum', address: addr(1), label: null, at: '2026-10-01 00:00:00' })).destination;
    await store.recordTrust(A, d.id, { status: 'flagged', readout: { result: 'fail', hits: ['sanctioned'], limits: [], checkedAt: '2026-10-01T00:00:00.000Z' } as never, checkedAt: '2026-10-01 00:00:00' });
    const onFlagged = vi.fn();
    const block = await checkLog.recordKeyedCheck(KEYED(), { onFlagged });
    await vi.waitFor(() => expect(onFlagged).toHaveBeenCalledTimes(1));
    expect(block).toMatchObject({ answer: 'flagged', registry: 'flagged' });
  });

  it('a mismatch on an address that is NOT in the registry does not alert: it shows in the report instead', async () => {
    await tinWith('');
    const onFlagged = vi.fn();
    const block = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged });
    expect(block).toMatchObject({ answer: 'flagged', registry: 'none', logged: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(onFlagged).not.toHaveBeenCalled();
  });

  it('proven, consistent-with-history and unknown never alert', async () => {
    await tinWith(addr(1));
    const onFlagged = vi.fn();
    await checkLog.recordKeyedCheck(KEYED({ status: 'proven' }), { onFlagged });
    await checkLog.recordKeyedCheck(KEYED({ status: 'unknown' }), { onFlagged }); // second check: consistent with history
    await checkLog.recordKeyedCheck(KEYED({ value: addr(9) }), { onFlagged }); // not in the registry: unknown
    await new Promise((r) => setTimeout(r, 20));
    expect(onFlagged).not.toHaveBeenCalled();
  });

  it('a check that could not be written does not alert', async () => {
    await tinWith(addr(1));
    holder.intercept = (sql) => { if (/^INSERT INTO agent_events/i.test(sql)) throw new Error('disk full'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFlagged = vi.fn();
    const block = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged });
    expect(block).toMatchObject({ logged: false, answer: 'flagged' });
    await new Promise((r) => setTimeout(r, 20));
    expect(onFlagged).not.toHaveBeenCalled();
  });

  const strip = (b: unknown) => { const { eventId: _e, ...rest } = b as Record<string, unknown>; return rest; };

  it('however the alert fails, the answer is exactly what it would have been', async () => {
    await tinWith(addr(1));
    const baseline = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged: () => {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const hook of [
      () => { throw new Error('thrown at once'); },
      () => Promise.reject(Object.assign(new Error(`rejected for ${addr(1)}`), { name: 'AlertError', code: 'E_ALERT' })),
      () => new Promise(() => {}), // never settles
    ]) {
      const block = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged: hook });
      expect(strip(block)).toEqual(strip(baseline));
      expect((block as { logged: boolean }).logged).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 20));
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('AlertError');
    expect(logged).toContain('E_ALERT');
    expect(logged).not.toContain(addr(1)); // logged by name and code only
  });

  it('the answer is not delayed by a slow alert', async () => {
    await tinWith(addr(1));
    const started = Date.now();
    const block = await checkLog.recordKeyedCheck(KEYED({ status: 'mismatch' }), { onFlagged: () => new Promise((r) => setTimeout(r, 400)) });
    expect(Date.now() - started).toBeLessThan(300);
    expect(block).toMatchObject({ logged: true });
  });

  it('with nothing replaced, a flagged check on a registered address emails the operator when alerts are on, and only then', async () => {
    await tinWith(addr(1));
    await recordFlagged();
    await new Promise((r) => setTimeout(r, 40));
    expect(outbox.sent).toEqual([]); // alerts are off by default

    await turnOn();
    await recordFlagged();
    await vi.waitFor(() => expect(outbox.sent).toHaveLength(1));
    expect(outbox.sent[0].to).toBe('operator-a@example.test');
    expect(outbox.sent[0].subject).toMatch(/^Action needed/);
    expect(outbox.sent[0].text).not.toContain(addr(1));

    await recordFlagged(); // the same address again within the hour
    await recordFlagged();
    await new Promise((r) => setTimeout(r, 40));
    expect(outbox.sent).toHaveLength(1);
  });

  const recordFlagged = () => checkLog.recordKeyedCheck(KEYED({ status: 'mismatch', now: new Date() }));

  it('with the mail down, the answer is still the same bytes as with alerts off', async () => {
    await tinWith(addr(1));
    const off = await recordFlagged();
    await turnOn();
    outbox.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const on = await recordFlagged();
    await new Promise((r) => setTimeout(r, 40));
    expect(strip(on)).toEqual(strip(off));
  });
});

describe('the delivery store', () => {
  it('reads an account that set nothing as everything off', async () => {
    expect(await delivery.readSettings('never-seen')).toEqual({ cadence: 'off', alerts: false, lastDigestKey: null });
  });

  it('keeps the settings of each account apart', async () => {
    await delivery.writeSettings(A, { cadence: 'daily', alerts: true }, '2026-10-01 00:00:00');
    await delivery.writeSettings(B, { cadence: 'weekly', alerts: false }, '2026-10-01 00:00:00');
    expect(await delivery.readSettings(A)).toMatchObject({ cadence: 'daily', alerts: true });
    expect(await delivery.readSettings(B)).toMatchObject({ cadence: 'weekly', alerts: false });
    await delivery.writeSettings(A, { cadence: 'off', alerts: false }, '2026-10-02 00:00:00');
    expect(await delivery.readSettings(A)).toMatchObject({ cadence: 'off', alerts: false });
    expect(await delivery.readSettings(B)).toMatchObject({ cadence: 'weekly' });
  });

  it('lists only the accounts with a digest on, in order, and says what each last got', async () => {
    await delivery.writeSettings('tenant-c', { cadence: 'issues', alerts: false }, '2026-10-01 00:00:00');
    await delivery.writeSettings(B, { cadence: 'off', alerts: true }, '2026-10-01 00:00:00');
    await delivery.writeSettings(A, { cadence: 'daily', alerts: false }, '2026-10-01 00:00:00');
    expect(await delivery.listOptedIn(10)).toEqual([
      { tenantId: A, cadence: 'daily', lastDigestKey: null },
      { tenantId: 'tenant-c', cadence: 'issues', lastDigestKey: null },
    ]);
    expect(await delivery.listOptedIn(1)).toHaveLength(1);
  });

  it('claims a digest for one caller only, gives it back only if it is still theirs, and saving settings does not forget the last digest', async () => {
    await delivery.writeSettings(A, { cadence: 'daily', alerts: false }, '2026-10-01 00:00:00');
    expect(await delivery.claimDigest(A, 'daily:2026-10-17', 'daily')).toBe(true);
    expect(await delivery.claimDigest(A, 'daily:2026-10-17', 'daily')).toBe(false);
    expect(await delivery.claimDigest(B, 'daily:2026-10-17', 'daily')).toBe(false); // B has no settings row: nothing to claim
    await delivery.writeSettings(A, { cadence: 'daily', alerts: true }, '2026-10-02 00:00:00');
    expect((await delivery.readSettings(A)).lastDigestKey).toBe('daily:2026-10-17');
    await delivery.releaseDigest(A, 'daily:2026-10-16', null); // not the current one: left alone
    expect((await delivery.readSettings(A)).lastDigestKey).toBe('daily:2026-10-17');
    await delivery.releaseDigest(A, 'daily:2026-10-17', null);
    expect((await delivery.readSettings(A)).lastDigestKey).toBeNull();
    expect(await delivery.claimDigest(A, 'daily:2026-10-17', 'daily')).toBe(true);
    const racing = await Promise.all(Array.from({ length: 8 }, () => delivery.claimDigest(A, 'daily:2026-10-18', 'daily')));
    expect(racing.filter(Boolean)).toHaveLength(1);
  });

  it('every statement names the account', async () => {
    await delivery.writeSettings(A, { cadence: 'daily', alerts: true }, '2026-10-01 00:00:00');
    await delivery.readSettings(A);
    await delivery.claimDigest(A, 'k', 'daily');
    await delivery.releaseDigest(A, 'k', null);
    await delivery.claimAlert(A, 't', addr(1), NOW.toISOString(), NOW.toISOString());
    await delivery.claimAlert(A, 't', addr(1), '2026-10-18T14:00:00.000Z', '2026-10-18T13:00:00.000Z'); // the address is known now: moved forward
    await delivery.releaseAlert(A, 't', addr(1), '2026-10-18T14:00:00.000Z');
    const own = fake.log.map((s) => s.sql).filter((sql) => /^(INSERT|UPDATE|SELECT)\b/i.test(sql) && /agent_(report_settings|alert_claims)/.test(sql));
    expect(own.length).toBeGreaterThanOrEqual(8);
    for (const sql of own) expect(sql, sql).toMatch(/\btenant_id\b/);
  });
});
