import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * GET /api/cron/onboarding-drip, end to end, for the Verify welcome series: who gets which email,
 * what the request to the mail provider carries (Reply-To, the unsubscribe header), and that a
 * registered destination ends the series.
 *
 * Nothing leaves this process. The database is the in-memory stand-in, `fetch` is replaced by a
 * recorder, the provider key is a made-up string, and every address is invented on a reserved
 * test domain. The engine's rules are tested on their own in tests/verify/welcomeDrip.test.ts.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/email', () => ({ sendMail: async () => {} }));
// The business enrollment joins three tables, which the stand-in does not run: it throws there.
// The route isolates each campaign, so that one failure is logged and the other campaigns go on,
// which is itself part of what these tests show (see `errors` below).

const SIGNED_UP = '2026-11-20 15:00:00';
const SIGNED_UP_MS = Date.parse('2026-11-20T15:00:00Z');
const DAY_MS = 86_400_000;
const APP = 'https://almstins.com';

interface Sent {
  url: string;
  authorization: string;
  body: { from: string; to: string; reply_to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
}

let fake: ReceivablesDbFake;
let sent: Sent[];
/** What the route logged as an error: one line per failure, by its opening words. */
let errors: string[];
let GET: typeof import('../../src/pages/api/cron/onboarding-drip').GET;
let replyTo: string;
let welcome: typeof import('../../src/i18n/emails/verifyWelcome');
let onboarding: typeof import('../../src/i18n/emails/onboarding');

const run = (secret = 'test-secret') =>
  GET({ request: new Request(`${APP}/api/cron/onboarding-drip`, { headers: { 'x-cron-secret': secret } }) } as never);
const atDay = (days: number) => vi.setSystemTime(SIGNED_UP_MS + days * DAY_MS + 20 * 60_000);

function account(name: string, signupService?: string, proof: 'google' | 'none' = 'google'): string {
  const id = `u-${name}`;
  fake.seed('auth_users', { id, email: `${name}@example.test`, email_verified: null, created_at: SIGNED_UP, ...(signupService ? { signup_service: signupService } : {}) });
  if (proof === 'google') fake.seed('auth_accounts', { id: `acct-${name}`, user_id: id, provider: 'google' });
  fake.seed('tenant_memberships', { id: `m-${name}`, tenant_id: `t-${name}`, user_id: id, role: 'owner' });
  return id;
}
const destination = (name: string) => fake.seed('verify_destinations', { id: `d-${name}`, tenant_id: `t-${name}`, kind: 'address', registered_at: SIGNED_UP });

async function load(env: Record<string, string> = { RESEND_API_KEY: 'made-up-key-for-tests' }): Promise<void> {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('RESEND_API_KEY', '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  ({ GET } = await import('../../src/pages/api/cron/onboarding-drip'));
  ({ VERIFY_WELCOME_REPLY_TO: replyTo } = await import('../../src/lib/campaignEmail'));
  welcome = await import('../../src/i18n/emails/verifyWelcome');
  onboarding = await import('../../src/i18n/emails/onboarding');
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: SIGNED_UP_MS + 20 * 60_000 });
  fake = createReceivablesDbFake();
  holder.db = fake;
  for (const ddl of [
    `CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT, email_verified TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT, provider TEXT)`,
    `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, tenant_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS verify_destinations (id TEXT PRIMARY KEY, tenant_id TEXT, kind TEXT, registered_at TEXT)`,
  ]) await fake.execute({ sql: ddl, args: [] });
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    sent.push({
      url: String(url),
      authorization: String((init?.headers as Record<string, string>)?.Authorization ?? ''),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ id: `made-up-${sent.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((first: unknown) => { errors.push(String(first)); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await load();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a Verify sign-up with no destination', () => {
  it('gets the first welcome email on the day it signs up, and only that one', async () => {
    account('verify', 'verify');
    const res = await run();

    expect(res.status).toBe(200);
    expect((await res.json()).campaigns).toEqual({
      onboarding: { enrolled: 0, sent: 0, failed: 0 },
      business: { enrolled: 0, sent: 0, failed: 0 },
      'verify-welcome': { enrolled: 1, sent: 1, failed: 0 },
    });
    // The one thing the stand-in cannot run, and nothing else, failed.
    expect(errors).toEqual(['[cron/onboarding-drip] enroll business failed']);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.resend.com/emails');
    expect(sent[0].body.to).toBe('verify@example.test');
    expect(sent[0].body.subject).toBe(welcome.en.emails[0].subject);
    expect(sent[0].body.html).toContain(`<a href="${APP}/dashboard/verify"`);
    expect(sent[0].body.text).toContain('What were you hoping to check? Reply to this email. It comes to me.');
  });

  it('sets Reply-To to the founder\'s Almstins mailbox, and sends from Almstins', async () => {
    account('verify', 'verify');
    await run();
    expect(sent[0].body.reply_to).toBe(replyTo);
    expect(replyTo).toMatch(/^[a-z]+@almstins\.com$/);
    expect(sent[0].body.from).toMatch(/<[a-z]+@almstins\.com>$/);
  });

  it('carries the unsubscribe link in the body and as a one-click header', async () => {
    account('verify', 'verify');
    await run();
    const token = String(fake.rows('campaign_drip')[0].unsub_token);
    const link = `${APP}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
    expect(sent[0].body.html).toContain(`<a href="${link}"`);
    expect(sent[0].body.text).toContain(link);
    expect(sent[0].body.headers).toEqual({ 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  });

  it('is not sent the same email again by the next run', async () => {
    account('verify', 'verify');
    await run();
    await run();
    expect(sent).toHaveLength(1);
    expect(fake.rows('campaign_drip')[0].last_step).toBe(1);
  });

  it('gets the second email three days later, with the same Reply-To, and nothing after', async () => {
    account('verify', 'verify');
    await run();
    atDay(2.9);
    await run();
    expect(sent).toHaveLength(1);

    atDay(3);
    await run();
    expect(sent).toHaveLength(2);
    expect(sent[1].body.subject).toBe(welcome.en.emails[1].subject);
    expect(sent[1].body.reply_to).toBe(replyTo);

    atDay(30);
    await run();
    expect(sent).toHaveLength(2);
  });

  it('writes in the language the account holds', async () => {
    account('verify', 'verify');
    fake.rows('auth_users')[0].lang = 'es';
    await run();
    expect(sent[0].body.subject).toBe(welcome.es.emails[0].subject);
  });
});

describe('registering a destination ends the series', () => {
  it('sends no second email', async () => {
    account('verify', 'verify');
    await run();
    destination('verify');
    atDay(3);
    await run();
    expect(sent).toHaveLength(1);
  });

  it('sends no first email either, when the destination is there before the first run', async () => {
    account('verify', 'verify');
    destination('verify');
    await run();
    expect(sent).toEqual([]);
  });
});

describe('the other accounts in the same run', () => {
  it('an account with no stored sign-up product gets the wallet and tax email, with the default Reply-To', async () => {
    account('older');
    account('verify', 'verify');
    await run();

    const byTo = Object.fromEntries(sent.map((s) => [s.body.to, s.body]));
    expect(Object.keys(byTo).sort()).toEqual(['older@example.test', 'verify@example.test']);
    expect(byTo['older@example.test'].subject).toBe(onboarding.en.emails[0].subject);
    expect(byTo['older@example.test'].reply_to).not.toBe(replyTo);
    expect(byTo['older@example.test'].reply_to).toMatch(/@/);
    expect(byTo['verify@example.test'].reply_to).toBe(replyTo);
  });

  it('an unverified password sign-up gets nothing', async () => {
    account('typed', 'verify', 'none');
    await run();
    atDay(3);
    await run();
    expect(sent).toEqual([]);
    expect(fake.rows('campaign_drip')).toEqual([]);
  });
});

describe('the route\'s own gates', () => {
  it('refuses a request without the cron secret, and sends nothing', async () => {
    account('verify', 'verify');
    const res = await run('wrong-secret');
    expect(res.status).toBe(401);
    expect(sent).toEqual([]);
    expect(fake.rows('campaign_drip') ?? []).toEqual([]);
  });

  it('sends nothing and enrolls nobody when the mail provider key is not set', async () => {
    await load({});
    account('verify', 'verify');
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: false, error: 'resend_not_configured' });
    expect(sent).toEqual([]);
  });

  it('a provider failure leaves the step unsent, so the next run tries again', async () => {
    account('verify', 'verify');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('made-up failure', { status: 500 })));
    const res = await run();
    expect((await res.json()).campaigns['verify-welcome']).toEqual({ enrolled: 1, sent: 0, failed: 1 });
    expect(fake.rows('campaign_drip')[0].last_step).toBe(0);
  });
});

describe('the sender', () => {
  it('uses the mailbox it is given for replies, and its default when it is given none', async () => {
    const { sendCampaignEmail } = await import('../../src/lib/campaignEmail');
    const base = { to: 'someone@example.test', subject: 's', html: '<p>h</p>', text: 't' };
    await sendCampaignEmail({ ...base, replyTo: 'replies@example.test' });
    await sendCampaignEmail(base);
    expect(sent[0].body.reply_to).toBe('replies@example.test');
    expect(sent[1].body.reply_to).not.toBe('replies@example.test');
    expect(sent[1].body.reply_to).toMatch(/@/);
    expect(sent[0].authorization).toBe('Bearer made-up-key-for-tests');
  });
});
