import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The Verify welcome series (campaign `verify-welcome`, src/lib/onboardingDrip.ts).
 *
 * An account that signed up through Almstins Verify and has not registered a destination gets
 * two emails about Verify: one on the day it signs up (at the first hourly run after it), one
 * three days after that. It does not get the
 * wallet and tax series (`onboarding`) unless it adds a wallet. The welcome series ends the
 * moment the account registers a destination, where the `business` series takes over. Accounts
 * with no stored sign-up product behave exactly as before.
 *
 * The engine's own enrollment and due-list SQL runs here, on the in-memory stand-in for the
 * database. Nothing is sent: these tests stop at the list of who is due. Every id and address is
 * invented. tests/pgVerifyWelcomeDrip.test.ts runs the same statements on a real Postgres.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/email', () => ({ sendMail: async () => {} }));

const ROOT = path.resolve(__dirname, '../..');
const DAY_MS = 86_400_000;
/** The moment the accounts below sign up. The first cron run is twenty minutes after it. */
const SIGNED_UP = '2026-11-20 15:00:00';
const SIGNED_UP_MS = Date.parse('2026-11-20T15:00:00Z');
const FIRST_RUN = '2026-11-20 15:20:00';

let fake: ReceivablesDbFake;
let drip: typeof import('../../src/lib/onboardingDrip');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'], now: SIGNED_UP_MS + 20 * 60_000 });
  fake = createReceivablesDbFake();
  holder.db = fake;
  drip = await import('../../src/lib/onboardingDrip');
  // auth_users as it was before Part A: the engine adds lang and signup_service itself.
  for (const ddl of [
    `CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT, email_verified TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT, provider TEXT)`,
    `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, tenant_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS verify_destinations (id TEXT PRIMARY KEY, tenant_id TEXT, kind TEXT, registered_at TEXT)`,
  ]) await fake.execute({ sql: ddl, args: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Move the clock to `days` after the first cron run (which is twenty minutes after the sign-up). */
const atDay = (days: number) => vi.setSystemTime(SIGNED_UP_MS + days * DAY_MS + 20 * 60_000);

interface Account {
  /** The product stored at sign-up, or none for an account older than the column. */
  signupService?: string | null;
  /** How the address is known to be real: a Google sign-in, a confirmed email, or neither. */
  proof?: 'google' | 'verified-email' | 'none';
  createdAt?: string;
}

/** One account with its own tenant. The address is invented, on a reserved test domain. */
function account(name: string, a: Account = {}): string {
  const id = `u-${name}`;
  const proof = a.proof ?? 'google';
  fake.seed('auth_users', {
    id,
    email: `${name}@example.test`,
    email_verified: proof === 'verified-email' ? SIGNED_UP : null,
    created_at: a.createdAt ?? SIGNED_UP,
    ...(a.signupService === undefined ? {} : { signup_service: a.signupService }),
  });
  if (proof === 'google') fake.seed('auth_accounts', { id: `acct-${name}`, user_id: id, provider: 'google' });
  fake.seed('tenant_memberships', { id: `m-${name}`, tenant_id: `t-${name}`, user_id: id, role: 'owner' });
  return id;
}
const wallet = (name: string) => fake.seed('wallets', { id: `w-${name}-${fake.rows('wallets').length}`, tenant_id: `t-${name}` });
const destination = (name: string, kind = 'address') =>
  fake.seed('verify_destinations', { id: `d-${name}-${fake.rows('verify_destinations').length}`, tenant_id: `t-${name}`, kind, registered_at: SIGNED_UP });
const removeDestinations = (name: string) => {
  const rows = fake.rows('verify_destinations');
  rows.splice(0, rows.length, ...rows.filter((r) => r.tenant_id !== `t-${name}`));
};

/** One cron pass over enrollment, the way /api/cron/onboarding-drip runs it. `business` is seeded by hand below: its two-join query is not in the stand-in. */
async function enrollAll(): Promise<void> {
  await drip.enrollForCampaign('onboarding');
  await drip.enrollForCampaign('verify-welcome');
}
const enrolledIn = (campaign: string) => fake.rows('campaign_drip').filter((r) => r.campaign === campaign).map((r) => String(r.user_id)).sort();
const due = async (campaign: 'onboarding' | 'verify-welcome') => (await drip.getDueDrips(campaign)).map((d) => `${d.userId}:${d.nextStep}`).sort();
/** What the cron does after a send: move every due account one step on. */
async function sendDue(campaign: 'onboarding' | 'verify-welcome'): Promise<string[]> {
  const list = await drip.getDueDrips(campaign);
  for (const d of list) await drip.markStepSent(d.campaign, d.userId, d.nextStep);
  return list.map((d) => `${d.userId}:${d.nextStep}`).sort();
}
/** What `business` enrollment writes when an account registers its first destination. */
const inBusinessSeries = (userId: string) =>
  fake.seed('campaign_drip', { campaign: 'business', user_id: userId, email: `${userId}@example.test`, lang: 'en', enrolled_at: SIGNED_UP, last_step: 0, unsubscribed: 0, unsub_token: `tok-${userId}` });

describe('the series is two emails, on day 0 and day 3', () => {
  it('is a campaign of the engine, after business in the order the cron works through', () => {
    expect(drip.CAMPAIGNS['verify-welcome'].cadence).toEqual([0, 3]);
    expect(drip.CAMPAIGN_IDS).toEqual(['onboarding', 'business', 'verify-welcome']);
    for (const lang of ['en', 'es', 'fr'] as const) expect(drip.campaignLocale('verify-welcome', lang).emails).toHaveLength(2);
  });

  it('a language the series does not have falls back to English', () => {
    expect(drip.campaignLocale('verify-welcome', 'de' as never)).toBe(drip.campaignLocale('verify-welcome', 'en'));
  });

  it('leaves the two older campaigns as they were', () => {
    expect(drip.CAMPAIGNS.onboarding.cadence).toEqual([0, 2, 5, 10]);
    expect(drip.CAMPAIGNS.business.cadence).toEqual([0, 2, 5, 10]);
    expect(drip.campaignReplyTo('onboarding')).toBeUndefined();
    expect(drip.campaignReplyTo('business')).toBeUndefined();
  });
});

describe('a Verify sign-up with no destination', () => {
  it('is enrolled in the Verify welcome series and not in the wallet and tax series', async () => {
    const id = account('verify', { signupService: 'verify' });
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([id]);
    expect(enrolledIn('onboarding')).toEqual([]);
  });

  it('is anchored to its enrollment, the first run after the sign-up, in the language and at the address the account holds', async () => {
    const id = account('verify', { signupService: 'verify' });
    fake.rows('auth_users')[0].lang = 'fr';
    await enrollAll();
    const [row] = fake.rows('campaign_drip');
    expect(row).toMatchObject({ campaign: 'verify-welcome', user_id: id, email: 'verify@example.test', lang: 'fr', enrolled_at: FIRST_RUN, last_step: 0, unsubscribed: 0 });
    expect(String(row.unsub_token).length).toBeGreaterThan(8);
  });

  it('gets email 1 on day 0 and email 2 on day 3, and nothing after', async () => {
    const id = account('verify', { signupService: 'verify' });
    await enrollAll();

    expect(await sendDue('verify-welcome')).toEqual([`${id}:1`]);
    expect(await due('verify-welcome')).toEqual([]);

    atDay(2.9);
    expect(await due('verify-welcome')).toEqual([]);

    atDay(3);
    expect(await sendDue('verify-welcome')).toEqual([`${id}:2`]);

    atDay(40);
    await enrollAll();
    expect(await due('verify-welcome')).toEqual([]);
    expect(await due('onboarding')).toEqual([]);
    expect(enrolledIn('verify-welcome')).toEqual([id]);
  });

  it('an account that can only be written to days later gets email 1 then and email 2 three days after it, never both at once', async () => {
    // A password sign-up that confirms its address five days after signing up.
    const id = account('late', { signupService: 'verify', proof: 'none' });
    atDay(5);
    await enrollAll();
    expect(fake.rows('campaign_drip')).toEqual([]);

    fake.rows('auth_users')[0].email_verified = '2026-11-25 15:10:00';
    await enrollAll();
    expect(await sendDue('verify-welcome')).toEqual([`${id}:1`]);
    // The next hourly run, and the two days after it: nothing.
    atDay(5 + 1 / 24);
    expect(await due('verify-welcome')).toEqual([]);
    atDay(7.9);
    expect(await due('verify-welcome')).toEqual([]);
    atDay(8);
    expect(await sendDue('verify-welcome')).toEqual([`${id}:2`]);
  });

  it('an account already there when the series first runs is treated the same way', async () => {
    const id = account('waiting', { signupService: 'verify', createdAt: '2026-11-16 09:00:00' });
    await enrollAll();
    expect(await sendDue('verify-welcome')).toEqual([`${id}:1`]);
    atDay(1 / 24);
    expect(await due('verify-welcome')).toEqual([]);
    atDay(3);
    expect(await due('verify-welcome')).toEqual([`${id}:2`]);
  });

  it('is enrolled once: a second cron run adds no second row', async () => {
    account('verify', { signupService: 'verify' });
    await enrollAll();
    await enrollAll();
    expect(fake.rows('campaign_drip')).toHaveLength(1);
  });

  it('stops when the person unsubscribes', async () => {
    account('verify', { signupService: 'verify' });
    await enrollAll();
    await sendDue('verify-welcome');
    expect(await drip.unsubscribeByToken(String(fake.rows('campaign_drip')[0].unsub_token))).toBe(true);
    atDay(3);
    expect(await due('verify-welcome')).toEqual([]);
  });
});

describe('registering a destination ends the series', () => {
  it('sends no second email once the account has a destination', async () => {
    const id = account('verify', { signupService: 'verify' });
    await enrollAll();
    expect(await sendDue('verify-welcome')).toEqual([`${id}:1`]);

    destination('verify');
    atDay(3);
    expect(await due('verify-welcome')).toEqual([]);
  });

  it('is checked at send time: a destination registered after enrollment, before the first email, sends nothing', async () => {
    account('verify', { signupService: 'verify' });
    await enrollAll();
    destination('verify');
    expect(await due('verify-welcome')).toEqual([]);
  });

  it('a payment QR or link counts as a destination too', async () => {
    account('verify', { signupService: 'verify' });
    await enrollAll();
    destination('verify', 'qr');
    expect(await due('verify-welcome')).toEqual([]);
  });

  it('never enrolls an account that registered a destination before the first cron run', async () => {
    account('verify', { signupService: 'verify' });
    destination('verify');
    await enrollAll();
    expect(fake.rows('campaign_drip')).toEqual([]);
  });

  it('stays ended if the destination is removed again: the business series has the account by then', async () => {
    const id = account('verify', { signupService: 'verify' });
    await enrollAll();
    await sendDue('verify-welcome');
    destination('verify');
    inBusinessSeries(id);
    removeDestinations('verify');

    atDay(3);
    expect(await due('verify-welcome')).toEqual([]);
  });

  it('never enrolls an account the business series already has, with or without a destination left', async () => {
    const id = account('verify', { signupService: 'verify' });
    inBusinessSeries(id);
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([]);
  });

  it('only the owner\'s own tenant counts: another account\'s destination ends nothing', async () => {
    const id = account('verify', { signupService: 'verify' });
    account('other', { signupService: 'verify' });
    destination('other');
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([id]);
    expect(await due('verify-welcome')).toEqual([`${id}:1`]);
  });
});

describe('Verify sign-ups and the wallet and tax series', () => {
  it('a Verify sign-up that adds a wallet becomes eligible for it', async () => {
    const id = account('verify', { signupService: 'verify' });
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([]);

    wallet('verify');
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([id]);
    expect(await due('onboarding')).toEqual([`${id}:1`]);
  });

  it('stays out of it after registering a destination, while it has no wallet', async () => {
    account('verify', { signupService: 'verify' });
    destination('verify');
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([]);
  });

  it('an account part-way through it when this ships gets no further email from it', async () => {
    const id = account('verify', { signupService: 'verify' });
    fake.seed('campaign_drip', { campaign: 'onboarding', user_id: id, email: 'verify@example.test', lang: 'en', enrolled_at: SIGNED_UP, last_step: 1, unsubscribed: 0, unsub_token: 'tok-part-way' });
    await drip.ensureDripTable();

    atDay(2);
    expect(await due('onboarding')).toEqual([]);
    atDay(30);
    expect(await due('onboarding')).toEqual([]);
  });

  it('that same account picks the series up where it left off if it adds a wallet', async () => {
    const id = account('verify', { signupService: 'verify' });
    fake.seed('campaign_drip', { campaign: 'onboarding', user_id: id, email: 'verify@example.test', lang: 'en', enrolled_at: SIGNED_UP, last_step: 1, unsubscribed: 0, unsub_token: 'tok-part-way' });
    await drip.ensureDripTable();
    wallet('verify');

    atDay(2);
    expect(await due('onboarding')).toEqual([`${id}:2`]);
  });

  it('another account\'s wallet does not make a Verify sign-up a wallet user', async () => {
    account('verify', { signupService: 'verify' });
    const other = account('other', { signupService: 'wallet-watcher' });
    wallet('other');
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([other]);
  });
});

describe('an account with no stored sign-up product behaves exactly as before', () => {
  it('is enrolled in the wallet and tax series on its usual days, and never in the Verify welcome series', async () => {
    const id = account('older');
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([id]);
    expect(enrolledIn('verify-welcome')).toEqual([]);

    expect(await sendDue('onboarding')).toEqual([`${id}:1`]);
    atDay(1.9);
    expect(await due('onboarding')).toEqual([]);
    atDay(2);
    expect(await sendDue('onboarding')).toEqual([`${id}:2`]);
    atDay(5);
    expect(await sendDue('onboarding')).toEqual([`${id}:3`]);
    atDay(10);
    expect(await sendDue('onboarding')).toEqual([`${id}:4`]);
    atDay(60);
    expect(await due('onboarding')).toEqual([]);
  });

  it('nothing is guessed for it, even when it has a Verify destination and no wallet', async () => {
    const id = account('older', { signupService: null });
    destination('older');
    await enrollAll();
    expect(enrolledIn('onboarding')).toEqual([id]);
    expect(enrolledIn('verify-welcome')).toEqual([]);
    expect(await due('onboarding')).toEqual([`${id}:1`]);
  });

  it.each(['wallet-watcher', 'receivables', 'agent-vault', 'unknown'])('an account that signed up for %s is not a Verify sign-up', async (service) => {
    const id = account('elsewhere', { signupService: service });
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([]);
    expect(enrolledIn('onboarding')).toEqual([id]);
  });

  it('the product id the rule reads is the one the sign-in writes', async () => {
    const { serviceForPath } = await import('../../src/lib/signupService');
    const { VERIFY_SIGNUP_SERVICE } = await import('../../src/lib/adminVerifySteps');
    expect(serviceForPath('/dashboard/verify').id).toBe('verify');
    expect(VERIFY_SIGNUP_SERVICE).toBe('verify');
    expect(readFileSync(path.join(ROOT, 'src/lib/onboardingDrip.ts'), 'utf8')).toContain("const VERIFY_SIGNUP: SignupServiceId = 'verify';");
  });
});

describe('only an address known to be real is written to', () => {
  it('an unverified password sign-up gets nothing, from either series', async () => {
    account('typed', { signupService: 'verify', proof: 'none' });
    await enrollAll();
    expect(fake.rows('campaign_drip')).toEqual([]);
    expect(await due('verify-welcome')).toEqual([]);
    expect(await due('onboarding')).toEqual([]);

    atDay(3);
    await enrollAll();
    expect(fake.rows('campaign_drip')).toEqual([]);
  });

  it('it is enrolled once the address is confirmed', async () => {
    const id = account('typed', { signupService: 'verify', proof: 'none' });
    await enrollAll();
    fake.rows('auth_users')[0].email_verified = '2026-11-21 09:00:00';
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([id]);
  });

  it('a confirmed email is enough without Google or GitHub', async () => {
    const id = account('confirmed', { signupService: 'verify', proof: 'verified-email' });
    await enrollAll();
    expect(enrolledIn('verify-welcome')).toEqual([id]);
  });

  it('an account with no address, or one made before the series existed, is left alone', async () => {
    account('early', { signupService: 'verify', createdAt: '2026-06-21 23:59:59' });
    fake.seed('auth_users', { id: 'u-blank', email: '', created_at: SIGNED_UP, signup_service: 'verify' });
    fake.seed('auth_users', { id: 'u-undated', email: 'undated@example.test', created_at: null, signup_service: 'verify', email_verified: SIGNED_UP });
    await enrollAll();
    expect(fake.rows('campaign_drip')).toEqual([]);
  });

  it('a deleted account\'s enrollment never sends', async () => {
    account('gone', { signupService: 'verify' });
    await enrollAll();
    const users = fake.rows('auth_users');
    users.splice(0, users.length);
    expect(await due('verify-welcome')).toEqual([]);
  });
});

describe('the rules are applied where the series are built', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/onboardingDrip.ts'), 'utf8');

  it('Verify-only is checked at enrollment and at send time of the wallet and tax series, next to the other two rules', () => {
    expect(src).toContain("AND NOT ${agenticsOnlyUser('au.id')}\n            AND NOT ${verifyOnlyUser('au.id')}");
    expect(src).toContain("AND NOT ${agenticsOnlyUser('campaign_drip.user_id')} AND NOT ${verifyOnlyUser('campaign_drip.user_id')}");
  });

  it('"has started with Verify" is checked at enrollment and at send time of the welcome series', () => {
    expect(src).toContain("AND NOT ${verifyStartedUser('au.id')}");
    expect(src).toContain("${stopOnceVerifyStarted ? `AND NOT ${verifyStartedUser('campaign_drip.user_id')}` : ''}");
    expect(src).toContain("const stopOnceVerifyStarted = campaign === 'verify-welcome';");
  });

  it('the welcome series uses the reachability rule the other two use', () => {
    const welcome = src.slice(src.indexOf('async function enrollVerifyWelcome'), src.indexOf('export async function enrollForCampaign'));
    expect(welcome).toContain("AND ${reachableUser('au')}");
    expect(welcome).toContain("substr(au.created_at, 1, 10) >= ?");
  });

  it('the business series is not touched: it enrolls on the first destination, as before', () => {
    const business = src.slice(src.indexOf('async function enrollBusiness'), src.indexOf('/**\n * Verify welcome:'));
    expect(business).toContain('HAVING substr(MIN(vd.registered_at), 1, 10) >= ?');
    expect(business).not.toMatch(/verifyOnlyUser|verifyStartedUser|signup_service/);
  });

  it('both rules are scoped by the owned tenant', () => {
    const rules = src.slice(src.indexOf('export const verifyOnlyUser'), src.indexOf('async function ensureSignupServiceColumn'));
    expect(rules.match(/tm\.role = 'owner'/g)).toHaveLength(2);
    expect(rules).toContain('w.tenant_id = tm.tenant_id');
    expect(rules).toContain('vd.tenant_id = tm.tenant_id');
  });

  it('adds the sign-up product column before a rule reads it', async () => {
    account('verify', { signupService: 'verify' });
    expect(fake.columns.get('auth_users')?.has('signup_service')).toBe(false);
    await drip.enrollForCampaign('verify-welcome');
    expect(fake.columns.get('auth_users')?.has('signup_service')).toBe(true);
  });
});
