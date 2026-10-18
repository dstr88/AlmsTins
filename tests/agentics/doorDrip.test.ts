import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The getting-started email series is about wallets and crypto taxes, so it must not reach an account
 * that came in through the Agentics door and has not used wallets: the Agentics letter promises one more
 * email (when the vault opens) and no newsletter. The rule is `agenticsOnlyUser` in
 * src/lib/onboardingDrip.ts, used at enrollment and again at send time. The database is the in-memory
 * stand-in; every id and address is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/email', () => ({ sendMail: async () => {} }));

const ROOT = path.resolve(__dirname, '../..');
let fake: ReceivablesDbFake;
let drip: typeof import('../../src/lib/onboardingDrip');
let signup: typeof import('../../src/lib/agenticsSignup');

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  drip = await import('../../src/lib/onboardingDrip');
  signup = await import('../../src/lib/agenticsSignup');
  for (const ddl of [
    `CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT)`,
    `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, tenant_id TEXT)`,
  ]) await fake.execute({ sql: ddl, args: [] });
  await signup.ensureAgenticsSignupsTable();
});

const user = (id: string) => fake.seed('auth_users', { id, email: `${id}@example.test` });
const owns = (userId: string, tenantId: string, role = 'owner') => fake.seed('tenant_memberships', { id: `${userId}-${tenantId}`, tenant_id: tenantId, user_id: userId, role });
const agentics = (tenantId: string) => fake.seed('agentics_signups', { tenant_id: tenantId, source: 'direct' });
const wallet = (tenantId: string) => fake.seed('wallets', { id: `w-${tenantId}-${fake.rows('wallets').length}`, tenant_id: tenantId });

/** The users the rule lets through to the getting-started series (everyone who is NOT Agentics-only). */
async function eligible(): Promise<string[]> {
  const r = await fake.execute({ sql: `SELECT au.id FROM auth_users au WHERE NOT ${drip.agenticsOnlyUser('au.id')} ORDER BY au.id`, args: [] });
  return r.rows.map((x: any) => String(x.id));
}

describe('who counts as Agentics-only', () => {
  it('an owner of an Agentics tenant with no wallets is left out of the series', async () => {
    user('u-agentics'); owns('u-agentics', 't-agentics'); agentics('t-agentics');
    user('u-regular'); owns('u-regular', 't-regular');
    expect(await eligible()).toEqual(['u-regular']);
  });

  it('an Agentics account that has added a wallet is a tracker user again, and is eligible', async () => {
    user('u-both'); owns('u-both', 't-both'); agentics('t-both'); wallet('t-both');
    expect(await eligible()).toEqual(['u-both']);
  });

  it('an ordinary account is eligible, with or without wallets', async () => {
    user('u-a'); owns('u-a', 't-a');
    user('u-b'); owns('u-b', 't-b'); wallet('t-b');
    expect(await eligible()).toEqual(['u-a', 'u-b']);
  });

  it('only the owner of the tenant counts: a member of an Agentics tenant keeps whatever else they are', async () => {
    user('u-member'); owns('u-member', 't-agentics', 'member'); agentics('t-agentics');
    expect(await eligible()).toEqual(['u-member']);
  });

  it('another account\'s wallets do not make an Agentics account a tracker user', async () => {
    user('u-agentics'); owns('u-agentics', 't-agentics'); agentics('t-agentics');
    user('u-other'); owns('u-other', 't-other'); wallet('t-other');
    expect(await eligible()).toEqual(['u-other']);
  });

  it('an account is Agentics-only from the moment its signup row exists, not before', async () => {
    user('u-new'); owns('u-new', 't-new');
    expect(await eligible()).toEqual(['u-new']);
    agentics('t-new');
    expect(await eligible()).toEqual([]);
  });
});

describe('the rule is applied where the series is built', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/onboardingDrip.ts'), 'utf8');

  it('at enrollment and at send time, next to the financing-only rule', () => {
    expect(src).toContain("AND NOT ${financingOnlyUser('au.id')}\n            AND NOT ${agenticsOnlyUser('au.id')}");
    expect(src).toContain("AND NOT ${financingOnlyUser('campaign_drip.user_id')} AND NOT ${agenticsOnlyUser('campaign_drip.user_id')}");
  });

  it('only for the onboarding series: the business series is about Verify destinations and is not touched', () => {
    const business = src.slice(src.indexOf('async function enrollBusiness'), src.indexOf('export async function enrollForCampaign'));
    expect(business).not.toMatch(/agenticsOnlyUser/);
    // and at send time the exclusions are switched on for the onboarding campaign alone
    expect(src).toContain("const skipFinancingOnly = campaign === 'onboarding';");
  });

  it('creates the signup table before the filter reads it, so a database with no Agentics signup yet still works', () => {
    expect(src).toContain('await ensureAgenticsSignupsTable();');
    expect(src.match(/await ensureExclusionTables\(\);/g)).toHaveLength(2);
  });

  it('is scoped by the owned tenant, and trusts only a column reference', () => {
    const rule = src.slice(src.indexOf('export const agenticsOnlyUser'), src.indexOf('/** The tables the exclusion filters read'));
    expect(rule).toContain("tm.role = 'owner'");
    expect(rule).toContain('s.tenant_id = tm.tenant_id');
    expect(rule).toContain('w.tenant_id = tm.tenant_id');
  });
});
