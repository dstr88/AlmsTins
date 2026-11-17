import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk, fakeDeps, type FakeDeps } from '../helpers/agentVault';
import { hashWithSalt } from '../../src/lib/analytics/hash';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * Phase 5 of the poisoning warnings (Donnie, Nov 17, 2026): on a keyed check, an address that is not
 * on the agent's list but looks like one on a list in the account answers flagged, with lookalike: true,
 * and its own alert. The scaffold below is the one tests/agentics/keyedCheck.test.ts uses.
 *
 * GET /api/verify/check with and without a key that is linked to an Agent Vault tin. The public
 * answer must not change at all; a keyed call on a linked key is also written to the tin's ledger
 * and gains one `vault` field. The proof lookups are replaced (this suite is about what the route
 * adds), the database is the in-memory stand-in, and fetch is switched off as a net. Every
 * address, key and account is invented.
 */

const holder = vi.hoisted(() => ({
  db: null as any,
  intercept: null as null | ((sql: string) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      holder.intercept?.((typeof s === 'string' ? s : s.sql).replace(/\s+/g, ' ').trim());
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));

const entities = vi.hoisted(() => ({
  address: vi.fn<(v: string) => Promise<any>>(),
  url: vi.fn<(v: string) => Promise<any>>(),
}));
vi.mock('@/lib/verifyEntities', () => ({
  lookupVerifiedAddress: (v: string) => entities.address(v),
  lookupVerifiedUrl: (v: string) => entities.url(v),
}));

// The keyed check screens each address with the public checker's checkWallet (src/lib/agentVault/checkScreening.ts).
// Here it answers from memory, a clean and complete screening unless a test sets one: no network.
const screenAnswers = vi.hoisted(() => ({ byAddress: {} as Record<string, unknown> }));
vi.mock('@/lib/walletChecker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/walletChecker')>()),
  checkWallet: async (address: string) => {
    const set = screenAnswers.byAddress[address];
    if (set instanceof Error) throw set;
    return set ?? (await import('../helpers/agentVault')).walletResult();
  },
}));

const KEY_LINKED = 'a1'.repeat(12);
const KEY_UNLINKED = 'b2'.repeat(12);
const KEY_OWNER = 'c3'.repeat(12);
const BEARER = { linked: 'avk_linked', unlinked: 'avk_unlinked', owner: 'avk_owner' };
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({
  listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [],
  authenticateAgentKey: async (bearer: string) =>
    bearer === 'avk_linked' ? { id: 'a1'.repeat(12), domain: 'agent.example' }
    : bearer === 'avk_unlinked' ? { id: 'b2'.repeat(12), domain: 'other.example' }
    : bearer === 'avk_owner' ? { id: 'c3'.repeat(12), domain: 'owner.example' }
    : null,
}));

const A = 'tenant-a';
let fake: ReceivablesDbFake;
let deps: FakeDeps;
let route: typeof import('../../src/pages/api/verify/check');
let vault: typeof import('../../src/lib/agentVault/vault');

beforeEach(async () => {
  screenAnswers.byAddress = {};
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  keys.byTenant = { [A]: [{ id: KEY_LINKED, status: 'active' }, { id: KEY_UNLINKED, status: 'active' }] };
  deps = fakeDeps();
  entities.address.mockReset().mockResolvedValue(null);
  entities.url.mockReset().mockResolvedValue(null);
  await fake.execute({
    sql: `CREATE TABLE IF NOT EXISTS verify_agent_keys (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`,
    args: [],
  });
  fake.seed('verify_agent_keys', { id: KEY_LINKED, tenant_id: A, domain: 'agent.example', status: 'active' });
  fake.seed('verify_agent_keys', { id: KEY_UNLINKED, tenant_id: A, domain: 'other.example', status: 'active' });
  route = await import('../../src/pages/api/verify/check');
  vault = await import('../../src/lib/agentVault/vault');
});

const call = async (value: string, opts: { bearer?: string; expect?: string; ip?: string } = {}) => {
  const url = new URL('https://almstins.com/api/verify/check');
  url.searchParams.set('value', value);
  if (opts.expect) url.searchParams.set('expect', opts.expect);
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  const res = await (route.GET as any)({ request: new Request(url, { headers }), url, clientAddress: '203.0.113.1' });
  return { res, body: await res.json() };
};

const hit = (over: Record<string, any> = {}) => ({
  source: 'merchant', level: 'verified', since: '2026-08-01', domain: 'acme.example',
  provingDomain: 'acme.example', label: null, chain: 'ethereum', ...over,
});

const linkedTin = async () => expectOk(await vault.createTin(A, { label: 'Treasury agent', agentKeyId: KEY_LINKED })).tin;
const register = async (tinId: string, text: string) => expectOk(await vault.addDestinations(A, { tinId, text }, deps));
const events = () => fake.rows('agent_events');
/** The public part of an answer: everything but the time it was made and the Vault's own field. */
const publicPart = (b: Record<string, unknown>) => { const { checkedAt, vault: _v, ...rest } = b; return rest; };


import { deriveAnswer } from '../../src/lib/agentVault/checkLog';
import { looksLikeListed } from '../../src/lib/agentVault/lookalike';
import { alertKindOf } from '../../src/lib/agentVault/alerts';
import { reasonText } from '../../src/lib/agentVault/reportText';
import { classifyCheck, ANSWER_BASES } from '../../src/lib/agentVault/report';
import { getAgentReportEmail } from '../../src/i18n/emails/agentReport';

const LISTED = `0xabcd${'1'.repeat(32)}9f3e`;
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const TAIL_OFF = `0xabcd${'7'.repeat(32)}9f3f`;

describe('the rule', () => {
  it('looks like a listed address: trusted or pending entries count, flagged ones and the same address do not', () => {
    expect(looksLikeListed(POISON, [{ address: LISTED, trustStatus: 'trusted' }])).toBe(true);
    expect(looksLikeListed(POISON, [{ address: LISTED, trustStatus: 'pending' }])).toBe(true);
    expect(looksLikeListed(POISON, [{ address: LISTED, trustStatus: 'flagged' }])).toBe(false);
    expect(looksLikeListed(LISTED, [{ address: LISTED, trustStatus: 'trusted' }])).toBe(false);
    expect(looksLikeListed(TAIL_OFF, [{ address: LISTED, trustStatus: 'trusted' }])).toBe(false);
  });

  it('flags a look-alike that is not on the list, after a registry flag, the screening and a domain mismatch', () => {
    expect(deriveAnswer({ status: 'unknown', registry: 'none', checkedBefore: false, lookalike: true }))
      .toEqual({ answer: 'flagged', basis: 'lookalike_of_listed', cleared: false, history: 'none' });
    expect(deriveAnswer({ status: 'unknown', registry: 'none', checkedBefore: false, lookalike: true, screening: 'fail' }).basis).toBe('screening_flagged');
    expect(deriveAnswer({ status: 'mismatch', registry: 'none', checkedBefore: false, lookalike: true }).basis).toBe('domain_mismatch');
    expect(deriveAnswer({ status: 'unknown', registry: 'none', checkedBefore: false }).basis).toBe('not_in_registry');
  });

  it('never applies to an address on the list', () => {
    expect(deriveAnswer({ status: 'unknown', registry: 'trusted', checkedBefore: true, lookalike: true }).basis).toBe('registered_and_checked_before');
  });

  it('has its own alert, report bucket and reason', () => {
    expect(alertKindOf('lookalike_of_listed', 'unknown')).toBe('lookalike');
    expect(ANSWER_BASES).toContain('lookalike_of_listed');
    expect(classifyCheck({ answer: 'flagged', detail: { basis: 'lookalike_of_listed' } })).toBe('issues');
    expect(reasonText('lookalike_of_listed')).toMatch(/address poisoning/);
  });

  it('emails without an address, a label or an amount', () => {
    const t = getAgentReportEmail('en');
    const check = t.alert({ appBase: 'https://almstins.com', kind: 'lookalike' });
    expect(check.subject).toMatch(/Flagged/);
    expect(check.text).toMatch(/looks like one that is/);
    const paid = t.alert({ appBase: 'https://almstins.com', kind: 'unmatched', tinId: 't1', payments: 1, lookalike: true });
    expect(paid.subject).toMatch(/looks like one on its list/);
    const plain = t.alert({ appBase: 'https://almstins.com', kind: 'unmatched', tinId: 't1', payments: 1 });
    expect(plain.subject).toMatch(/never asked about/);
    for (const m of [check, paid]) {
      expect(m.text).not.toMatch(/0x[0-9a-f]{40}/i);
      expect(m.text).not.toMatch(/—/);
    }
  });
});

describe('the keyed check', () => {
  it('answers flagged with lookalike: true for a look-alike of an address on the list', async () => {
    const tin = await linkedTin();
    await register(tin.id, LISTED);
    const { body } = await call(POISON, { bearer: BEARER.linked });
    expect(body.vault.answer).toBe('flagged');
    expect(body.vault.lookalike).toBe(true);
    expect(body.vault.cleared).toBe(false);
    expect(body.status).toBe('unknown');
    const written: any = events().filter((e: any) => e.kind === 'checked').pop() ?? {};
    expect(JSON.parse(written.detail_json ?? written.detail ?? '{}').basis ?? '').toBe('lookalike_of_listed');
  });

  it('compares with every agent in the account, not just this one', async () => {
    const tin = await linkedTin();
    const other = expectOk(await vault.createTin(A, { label: 'Payroll agent', agentKeyId: null })).tin;
    await register(other.id, LISTED);
    void tin;
    const { body } = await call(POISON, { bearer: BEARER.linked });
    expect(body.vault.answer).toBe('flagged');
    expect(body.vault.lookalike).toBe(true);
  });

  it('leaves an ordinary unlisted address unknown, with no lookalike field', async () => {
    const tin = await linkedTin();
    await register(tin.id, LISTED);
    const { body } = await call(TAIL_OFF, { bearer: BEARER.linked });
    expect(body.vault.answer).toBe('unknown');
    expect('lookalike' in body.vault).toBe(false);
  });

  it('changes nothing for a call without a key', async () => {
    const tin = await linkedTin();
    await register(tin.id, LISTED);
    const { body } = await call(POISON);
    expect(body.vault).toBeUndefined();
    expect(body.status).toBe('unknown');
  });
});

describe('the unmatched-payment email', () => {
  it('says when the payment went to a look-alike of a listed address', async () => {
    const { alertCheck } = await import('../../src/lib/agentVault/alerts');
    const sent: Array<{ subject: string; text: string }> = [];
    const base = {
      now: () => new Date('2026-11-17T12:00:00Z'),
      recipient: async () => 'owner@example.com',
      send: async (m: { to: string; subject: string; text: string }) => { sent.push(m); },
      appBase: 'https://almstins.com',
      countUnmatched: async () => 1,
    };
    const outcome = await alertCheck(
      { tenantId: A, tinId: 'tin-1', address: POISON, kind: 'unmatched' },
      { ...base, listListed: async () => [{ address: LISTED, trustStatus: 'trusted' as const }] },
    );
    expect(outcome).toBe('sent');
    expect(sent[0].subject).toMatch(/looks like one on its list/);
    expect(sent[0].text).not.toContain(POISON);

    await alertCheck(
      { tenantId: A, tinId: 'tin-1', address: TAIL_OFF, kind: 'unmatched' },
      { ...base, listListed: async () => [{ address: LISTED, trustStatus: 'trusted' as const }] },
    );
    expect(sent[1].subject).toMatch(/never asked about/);
  });
});
