import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The Agentics signup record and its welcome letter: written once per account, sent once, never
 * thrown into the page, and kept per tenant. The database is the in-memory stand-in and the mail
 * server is a stub; every address is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
// The real sendMail never runs: the default dependencies reach this spy, so the defaults can be checked.
const realMail = vi.hoisted(() => ({ sendMail: vi.fn<(m: any) => Promise<void>>() }));
vi.mock('@/lib/email', () => ({ sendMail: (m: any) => realMail.sendMail(m) }));

const ROOT = path.resolve(__dirname, '../..');
const A = 'tenant-a';
const B = 'tenant-b';
const EMAIL = 'new.person@example.test';
const NOW = new Date('2026-10-18T12:00:00.000Z');

let fake: ReceivablesDbFake;
let signup: typeof import('../../src/lib/agenticsSignup');
let source: typeof import('../../src/lib/agenticsSource');

const sendMail = vi.fn<(m: any) => Promise<void>>();
const deps = (over: Record<string, unknown> = {}) => ({
  send: sendMail as any,
  now: () => NOW,
  appUrl: 'https://almstins.com/',
  replyTo: 'support@almstins.com',
  vaultOpen: false,
  ...over,
});

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  sendMail.mockReset().mockResolvedValue(undefined);
  realMail.sendMail.mockReset().mockResolvedValue(undefined);
  signup = await import('../../src/lib/agenticsSignup');
  source = await import('../../src/lib/agenticsSource');
});

// The stand-in leaves a column the INSERT did not name undefined; Postgres makes it NULL.
const row = (tenant = A): Record<string, any> | undefined => {
  const r = fake.rows('agentics_signups').find((x) => x.tenant_id === tenant);
  return r && { ...r, claimed_at: r.claimed_at ?? null, welcomed_at: r.welcomed_at ?? null, open_claimed_at: r.open_claimed_at ?? null, opened_notified_at: r.opened_notified_at ?? null };
};

describe('the campaign label', () => {
  it('keeps a short lowercase label and turns everything else into direct', () => {
    expect(source.cleanSource('linkedin')).toBe('linkedin');
    expect(source.cleanSource('  LinkedIn_Post-3 ')).toBe('linkedin_post-3');
    for (const bad of [undefined, null, 42, '', '   ', 'x'.repeat(25), 'a b', 'a/b', 'a?b=1', 'é', '<script>', '../x', 'a\nb']) {
      expect(source.cleanSource(bad), String(bad)).toBe('direct');
    }
    expect(source.cleanSource('x'.repeat(24))).toBe('x'.repeat(24));
  });

  it('builds the welcome path and the sign-in link, carrying the label only when there is one', () => {
    expect(source.welcomePath('direct')).toBe('/dashboard/agentics');
    expect(source.welcomePath('linkedin')).toBe('/dashboard/agentics?src=linkedin');
    expect(source.signupHref('direct')).toBe('/agentics/login?next=%2Fdashboard%2Fagentics');
    expect(source.signupHref('linkedin')).toBe('/agentics/login?next=%2Fdashboard%2Fagentics%3Fsrc%3Dlinkedin');
  });

  it('the sign-in link survives the sign-in\'s own next-path check, query and all', async () => {
    const { safeNextPath } = await import('../../src/lib/safeNext');
    expect(safeNextPath(source.welcomePath('linkedin'))).toBe('/dashboard/agentics?src=linkedin');
    expect(safeNextPath(source.welcomePath('direct'))).toBe('/dashboard/agentics');
    const next = new URL(`https://almstins.com${source.signupHref('linkedin')}`).searchParams.get('next');
    expect(safeNextPath(next)).toBe('/dashboard/agentics?src=linkedin');
  });
});

describe('the table', () => {
  const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').trim();

  it('migrations-pg/0060 and 0061 hold exactly the statements the code runs, in order', () => {
    const file = ['0060_agentics_signups.sql', '0061_agentics_signups_opening.sql']
      .flatMap((f) => squash(readFileSync(path.join(ROOT, 'migrations-pg', f), 'utf8')).split(';').map((x) => x.trim()).filter(Boolean));
    expect(file).toEqual(signup.AGENTICS_SIGNUPS_DDL.map(squash));
  });

  it('adds the two opening columns to a table that already exists, and creates them on a fresh one', () => {
    const ddl = signup.AGENTICS_SIGNUPS_DDL.map(squash);
    expect(ddl[0]).toMatch(/^CREATE TABLE IF NOT EXISTS agentics_signups/);
    expect(ddl.slice(1)).toEqual([
      'ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS open_claimed_at TEXT',
      'ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS opened_notified_at TEXT',
    ]);
  });

  it('is keyed by tenant_id, one row per tenant, and creates no tenant', () => {
    const ddl = signup.AGENTICS_SIGNUPS_DDL.join('\n');
    expect(ddl).toMatch(/tenant_id\s+TEXT NOT NULL PRIMARY KEY/);
    expect(ddl).not.toMatch(/INSERT INTO\s+tenants|tenant_memberships/i);
    // The code, without its comments (the header names ensureTenantForUser to say it is NOT called here).
    const code = readFileSync(path.join(ROOT, 'src/lib/agenticsSignup.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/INSERT INTO\s+(tenants|tenant_memberships|auth_users)/i);
    expect(code).not.toMatch(/ensureTenantForUser|createTenant/);
  });

  it('is created on first use, once per process', async () => {
    await signup.registerSignup(A, 'direct');
    await signup.registerSignup(B, 'direct');
    expect(fake.statements(/^CREATE TABLE IF NOT EXISTS agentics_signups/i)).toHaveLength(1);
  });

  it('a failed create is tried again by the next call', async () => {
    let failures = 1;
    fake.options.failDdl = () => (failures-- > 0 ? new Error('lock timeout') : false);
    await expect(signup.registerSignup(A, 'direct')).rejects.toThrow('lock timeout');
    await expect(signup.registerSignup(A, 'direct')).resolves.toBe(true);
  });

  it('is removed with the account', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    expect(TENANT_TABLES as readonly string[]).toContain('agentics_signups');
  });
});

describe('registering a signup', () => {
  it('records the account once, with the label it came with', async () => {
    expect(await signup.registerSignup(A, 'LinkedIn')).toBe(true);
    expect(await signup.registerSignup(A, 'twitter')).toBe(false); // the first label stays
    expect(row()).toMatchObject({ tenant_id: A, source: 'linkedin', claimed_at: null, welcomed_at: null });
    expect(fake.rows('agentics_signups')).toHaveLength(1);
  });

  it('keeps accounts apart', async () => {
    await signup.registerSignup(A, 'linkedin');
    await signup.registerSignup(B, 'x');
    expect(row(A)?.source).toBe('linkedin');
    expect(row(B)?.source).toBe('x');
  });

  it('turns a label that is not one into direct', async () => {
    await signup.registerSignup(A, '<script>alert(1)</script>');
    expect(row()?.source).toBe('direct');
  });
});

describe('the claim on the letter', () => {
  beforeEach(async () => { await signup.registerSignup(A, 'direct'); await signup.registerSignup(B, 'direct'); });

  it('goes to exactly one caller, even when five ask at once', async () => {
    const wins = await Promise.all(Array.from({ length: 5 }, () => signup.claimWelcome(A, NOW)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it('is refused while another caller holds it, and after the letter is sent', async () => {
    expect(await signup.claimWelcome(A, NOW)).toBe(true);
    expect(await signup.claimWelcome(A, new Date(NOW.getTime() + 60_000))).toBe(false);
    await signup.markWelcomed(A, NOW);
    expect(await signup.claimWelcome(A, new Date(NOW.getTime() + 24 * 3600_000))).toBe(false);
    expect(row()).toMatchObject({ welcomed_at: '2026-10-18 12:00:00' });
  });

  it('is taken over once it is stale: a send that never finished does not lose the letter', async () => {
    expect(await signup.claimWelcome(A, NOW)).toBe(true);
    expect(await signup.claimWelcome(A, new Date(NOW.getTime() + signup.CLAIM_STALE_MS - 1000))).toBe(false);
    expect(await signup.claimWelcome(A, new Date(NOW.getTime() + signup.CLAIM_STALE_MS + 1000))).toBe(true);
  });

  it('is given back by a release, but a release never reopens a letter that was sent', async () => {
    await signup.claimWelcome(A, NOW);
    await signup.releaseWelcome(A);
    expect(row()?.claimed_at).toBeNull();
    expect(await signup.claimWelcome(A, NOW)).toBe(true);
    await signup.markWelcomed(A, NOW);
    await signup.releaseWelcome(A);
    expect(row()?.welcomed_at).toBe('2026-10-18 12:00:00');
  });

  it('is per account: one account\'s claim does not touch another\'s', async () => {
    expect(await signup.claimWelcome(A, NOW)).toBe(true);
    expect(await signup.claimWelcome(B, NOW)).toBe(true);
    await signup.markWelcomed(A, NOW);
    expect(row(B)?.welcomed_at).toBeNull();
  });

  it('does nothing for an account that never signed up', async () => {
    expect(await signup.claimWelcome('tenant-ghost', NOW)).toBe(false);
  });
});

describe('the welcome letter, on the first visit', () => {
  it('sends the letter once, to the account\'s address, with replies going to a person', async () => {
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL, source: 'linkedin' }, deps())).toBe('sent');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: EMAIL, subject: 'You’re in: Almstins Agentics', replyTo: 'support@almstins.com' });
    expect(mail.text).toContain('I will write once, when your vault opens. No newsletter.');
    expect(mail.text).toContain('https://almstins.com/agentics/docs'); // the trailing slash of the site address is dropped
    expect(mail.html).toContain('<h1');
    expect(row()).toMatchObject({ source: 'linkedin', welcomed_at: '2026-10-18 12:00:00' });
  });

  it('never sends it twice, however often the page is opened', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps());
    for (let i = 0; i < 3; i++) expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).toBe('already');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('two visits at the same moment send one letter', async () => {
    const results = await Promise.all([
      signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps()),
      signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps()),
      signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps()),
    ]);
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('records the signup but sends nothing when there is no usable address', async () => {
    for (const email of [undefined, null, '', '   ', 'not-an-email', 'a b@example.test']) {
      expect(await signup.welcomeOnFirstVisit({ tenantId: A, email }, deps()), String(email)).toBe('no_email');
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ tenant_id: A, claimed_at: null, welcomed_at: null });
  });

  it('trims the address, and a visit that later has an address still gets its letter', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: null }, deps());
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: `  ${EMAIL}  ` }, deps())).toBe('sent');
    expect(sendMail.mock.calls[0][0].to).toBe(EMAIL);
  });

  it('a failed send says failed, releases its claim, logs no address, and the next visit sends it', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error(`550 mailbox ${EMAIL} unavailable`), { name: 'SMTPError', code: 'EENVELOPE' }));
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).toBe('failed');
    expect(row()).toMatchObject({ claimed_at: null, welcomed_at: null });
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('SMTPError');
    expect(logged).toContain('EENVELOPE');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('mailbox');

    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).toBe('sent');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('a database failure is failed, never thrown into the page', async () => {
    fake.options.failDml = (sql) => /^INSERT INTO agentics_signups/i.test(sql);
    await expect(signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).resolves.toBe('failed');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a failure to even mark the letter sent still does not throw, and the claim goes stale on its own', async () => {
    fake.options.failDml = (sql) => /^UPDATE agentics_signups SET welcomed_at/i.test(sql);
    await expect(signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).resolves.toBe('failed');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('each account gets its own letter, once', async () => {
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps())).toBe('sent');
    expect(await signup.welcomeOnFirstVisit({ tenantId: B, email: 'other@example.test' }, deps())).toBe('sent');
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual([EMAIL, 'other@example.test']);
  });

  it('keeps the first label: a later visit with another one does not change where the account came from', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: null, source: 'linkedin' }, deps());
    await signup.welcomeOnFirstVisit({ tenantId: A, email: null, source: 'twitter' }, deps());
    expect(row()?.source).toBe('linkedin');
  });

  it('by default: replies go to support@almstins.com, the docs link is on almstins.com, and the real mailer is used', async () => {
    vi.stubEnv('AUTH_URL', '');
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL })).toBe('sent');
    expect(realMail.sendMail).toHaveBeenCalledTimes(1);
    const mail = realMail.sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: EMAIL, replyTo: 'support@almstins.com' });
    expect(mail.text).toContain('https://almstins.com/agentics/docs');
    vi.unstubAllEnvs();
  });

  it('by default the docs link follows the configured site address', async () => {
    vi.stubEnv('AUTH_URL', 'https://staging.example.test/');
    await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL });
    expect(realMail.sendMail.mock.calls[0][0].text).toContain('https://staging.example.test/agentics/docs');
    vi.unstubAllEnvs();
  });

  it('the site address: almstins.com unless one is configured; a missing scheme gets https; no trailing slash', () => {
    expect(signup.siteUrl(undefined)).toBe('https://almstins.com');
    expect(signup.siteUrl('')).toBe('https://almstins.com');
    expect(signup.siteUrl('   ')).toBe('https://almstins.com');
    expect(signup.siteUrl('almstins.com')).toBe('https://almstins.com');
    expect(signup.siteUrl('https://almstins.com///')).toBe('https://almstins.com');
    expect(signup.siteUrl('http://localhost:4321/')).toBe('http://localhost:4321');
  });

  it('writes nothing outside its own table', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps());
    expect([...fake.tables.keys()].sort()).toEqual(['agentics_signups']);
  });
});

describe('the welcome letter once the vault is open', () => {
  it('says the vault is open, links to it, and counts the account as told', async () => {
    expect(await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps({ vaultOpen: true }))).toBe('sent');
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Your vault is open: Almstins Agentics');
    expect(mail.text).toContain('Your vault is open.');
    expect(mail.text).toContain('Your vault: https://almstins.com/dashboard/agentics');
    expect(mail.text).not.toContain('opening soon');
    expect(mail.text).not.toContain('I will write once, when your vault opens');
    expect(row()).toMatchObject({ welcomed_at: '2026-10-18 12:00:00', opened_notified_at: '2026-10-18 12:00:00' });
  });

  it('while the vault is private, the same call leaves the account waiting for the opening email', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL }, deps({ vaultOpen: false }));
    expect(row()).toMatchObject({ welcomed_at: '2026-10-18 12:00:00', opened_notified_at: null });
  });

  it('takes the state of the vault from the flag by default', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: EMAIL });
    expect(realMail.sendMail.mock.calls[0][0].subject).toBe('You’re in: Almstins Agentics'); // the flag is false in this suite
  });
});

describe('the opening email', () => {
  const OWNER = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
  const emails: Record<string, string | null> = { [A]: 'a@example.test', [B]: 'b@example.test', 'tenant-c': 'c@example.test', 'tenant-d': null, [OWNER]: 'owner@example.test' };
  const odeps = (over: Record<string, unknown> = {}) => ({
    send: sendMail as any,
    now: () => NOW,
    appUrl: 'https://almstins.com/',
    replyTo: 'support@almstins.com',
    emailOf: async (t: string) => emails[t] ?? null,
    ...over,
  });
  /** Signs up the tenants one minute apart, oldest first, with the letter already sent while the vault was private. */
  async function signUp(...tenants: string[]) {
    for (const t of tenants) {
      await signup.registerSignup(t, 'direct');
      await signup.markWelcomed(t, NOW);
    }
    // The stand-in gives every row the same created_at; space them so "oldest first" is a rule it can be held to.
    tenants.forEach((t, i) => { fake.rows('agentics_signups').find((r) => r.tenant_id === t)!.created_at = `2026-10-1${i} 12:00:00`; });
  }

  it('a dry run counts the accounts still to be told and sends nothing, claims nothing', async () => {
    await signUp(A, B, 'tenant-c');
    const r = await signup.sendOpeningNotices({ apply: false }, odeps());
    expect(r).toEqual({ dryRun: true, waiting: 3, sent: 0, failed: 0, noEmail: 0, remaining: 3 });
    expect(sendMail).not.toHaveBeenCalled();
    expect(fake.rows('agentics_signups').every((x) => !x.open_claimed_at && !x.opened_notified_at)).toBe(true);
  });

  it('sends each account the opening email once, to its own address, and marks it told', async () => {
    await signUp(A, B);
    const r = await signup.sendOpeningNotices({ apply: true }, odeps());
    expect(r).toEqual({ dryRun: false, waiting: 2, sent: 2, failed: 0, noEmail: 0, remaining: 0 });
    expect(sendMail.mock.calls.map((c) => c[0].to).sort()).toEqual(['a@example.test', 'b@example.test']);
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ subject: 'Your Agentics vault is open', replyTo: 'support@almstins.com' });
    expect(mail.text).toContain('Your vault: https://almstins.com/dashboard/agentics');
    expect(mail.html).toContain('href="https://almstins.com/dashboard/agentics"');
    expect(row(A)?.opened_notified_at).toBe('2026-10-18 12:00:00');
    // Called again, it has no one left to write to.
    expect(await signup.sendOpeningNotices({ apply: true }, odeps())).toMatchObject({ waiting: 0, sent: 0, remaining: 0 });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('two calls at once send each account one email, not two', async () => {
    await signUp(A, B, 'tenant-c');
    const [x, y] = await Promise.all([signup.sendOpeningNotices({ apply: true }, odeps()), signup.sendOpeningNotices({ apply: true }, odeps())]);
    expect(x.sent + y.sent).toBe(3);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('never writes to the owner\'s account, and does not count it as waiting', async () => {
    await signUp(A, OWNER);
    expect(await signup.countOpeningWaiting()).toBe(1);
    await signup.sendOpeningNotices({ apply: true }, odeps());
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.test']);
    expect(row(OWNER)?.opened_notified_at).toBeNull();
  });

  it('leaves out an account already told: a welcome letter sent after the vault opened said so', async () => {
    await signup.welcomeOnFirstVisit({ tenantId: A, email: emails[A], source: 'direct' }, deps({ vaultOpen: true }));
    await signUp(B);
    sendMail.mockClear();
    const r = await signup.sendOpeningNotices({ apply: true }, odeps());
    expect(r.sent).toBe(1);
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.test']);
  });

  it('takes the oldest signups first and stops at the limit, and the next call carries on', async () => {
    await signUp(A, B, 'tenant-c');
    const first = await signup.sendOpeningNotices({ apply: true, limit: 2 }, odeps());
    expect(first).toMatchObject({ sent: 2, remaining: 1 });
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.test', 'b@example.test']);
    const second = await signup.sendOpeningNotices({ apply: true, limit: 2 }, odeps());
    expect(second).toMatchObject({ sent: 1, remaining: 0 });
  });

  it('keeps a call within what one request can carry, whatever it is asked for', async () => {
    expect(signup.OPENING_BATCH_MAX).toBe(200);
    expect(signup.OPENING_BATCH_DEFAULT).toBe(100);
    await signUp(A, B);
    expect((await signup.sendOpeningNotices({ apply: true, limit: 0 }, odeps())).sent).toBe(2); // 0 means the default, not none
    sendMail.mockClear();
    await signUp('tenant-c');
    expect((await signup.sendOpeningNotices({ apply: true, limit: 10_000 }, odeps())).sent).toBe(1);
  });

  it('stops starting new sends at the deadline and says how many are left', async () => {
    await signUp(A, B, 'tenant-c');
    let t = NOW.getTime();
    const r = await signup.sendOpeningNotices({ apply: true, deadlineAt: NOW.getTime() + 1500 }, odeps({ now: () => new Date((t += 1000)) }));
    expect(r.sent).toBeLessThan(3);
    expect(r.remaining).toBe(3 - r.sent);
  });

  it('a failed send gives its claim back and is counted, and the other accounts are still written to', async () => {
    await signUp(A, B);
    sendMail.mockImplementationOnce(async () => { throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }); });
    const r = await signup.sendOpeningNotices({ apply: true }, odeps());
    expect(r).toMatchObject({ sent: 1, failed: 1, remaining: 1 });
    expect(row(A)).toMatchObject({ open_claimed_at: null, opened_notified_at: null }); // the one that failed is free to be tried again
    expect(row(B)?.opened_notified_at).toBe('2026-10-18 12:00:00');
    // Logged by name and code only: the error text can carry the address it was given.
    expect(console.error).toHaveBeenCalledWith('[agentics] opening email not sent', { name: 'Error', code: 'ECONNREFUSED' });
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('connection refused');
    // The next call tries the one that failed.
    sendMail.mockResolvedValue(undefined);
    expect(await signup.sendOpeningNotices({ apply: true }, odeps())).toMatchObject({ sent: 1, remaining: 0 });
  });

  it('marks an account with no address as told so it does not wait for ever, and writes to no one', async () => {
    await signUp('tenant-d');
    const r = await signup.sendOpeningNotices({ apply: true }, odeps());
    expect(r).toMatchObject({ sent: 0, noEmail: 1, remaining: 0 });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('finds an account\'s address from its first sign-in, and nothing that is not an address', async () => {
    await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT, tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)`, args: [] });
    await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS auth_users (id TEXT, email TEXT)`, args: [] });
    fake.seed('tenant_memberships', { id: 'm2', tenant_id: A, user_id: 'u2', role: 'member', created_at: '2026-10-02 00:00:00' });
    fake.seed('tenant_memberships', { id: 'm1', tenant_id: A, user_id: 'u1', role: 'owner', created_at: '2026-10-01 00:00:00' });
    fake.seed('tenant_memberships', { id: 'm3', tenant_id: B, user_id: 'u3', role: 'owner', created_at: '2026-10-01 00:00:00' });
    fake.seed('auth_users', { id: 'u1', email: ' first@example.test ' });
    fake.seed('auth_users', { id: 'u2', email: 'second@example.test' });
    fake.seed('auth_users', { id: 'u3', email: 'not an address' });
    expect(await signup.emailOfTenant(A)).toBe('first@example.test');
    expect(await signup.emailOfTenant(B)).toBeNull();
    expect(await signup.emailOfTenant('tenant-ghost')).toBeNull();
  });

  it('is removed with the account, like the rest of the row', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    expect(TENANT_TABLES as readonly string[]).toContain('agentics_signups');
  });
});
