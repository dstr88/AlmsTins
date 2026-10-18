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
  return r && { ...r, claimed_at: r.claimed_at ?? null, welcomed_at: r.welcomed_at ?? null };
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

  it('migrations-pg/0060_agentics_signups.sql holds exactly the statement the code runs', () => {
    const file = squash(readFileSync(path.join(ROOT, 'migrations-pg/0060_agentics_signups.sql'), 'utf8'))
      .split(';').map((s) => s.trim()).filter(Boolean);
    expect(file).toEqual(signup.AGENTICS_SIGNUPS_DDL.map(squash));
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
