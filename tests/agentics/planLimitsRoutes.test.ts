import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, walletResult } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

/**
 * The plan and its limits over HTTP, as the Vault will answer every account once it is opened (slice
 * 7 flips the flag; here it is pinned open, the way ownerOnlyPublicMode.test.ts pins it). The
 * session, the database and the outside checks are replaced; fetch is switched off as a net.
 *
 * What matters: a create that would pass a limit is 409 `plan_limit` with the cap, the limit and the
 * use, as codes and numbers and never as text; a paste that only partly fits goes through with the
 * rest reported; removing something frees its slot; the owner is not limited; one account never
 * counts against another; and the plan endpoint only reads.
 */
vi.mock('../../src/lib/agenticsFlag.mjs', () => ({ AGENTICS_VAULT_PUBLIC: true }));
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
  db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) },
}));
const mem = vi.hoisted(() => ({ session: null as null | { tenantId: string; isDemo?: boolean } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));
const checks = vi.hoisted(() => ({ checkWallet: vi.fn(), getCached: vi.fn(() => null), lookupVerifiedAddress: vi.fn(), isClaimedElsewhere: vi.fn() }));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: checks.checkWallet, getCached: checks.getCached }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: checks.lookupVerifiedAddress }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: checks.isClaimedElsewhere }));

const A = { tenantId: '00000000-0000-4000-8000-0000000000a1' };
const B = { tenantId: '00000000-0000-4000-8000-0000000000b2' };
const OWNER = { tenantId: OWNER_TENANT_ID };

let fake: ReceivablesDbFake;
let tins: typeof import('../../src/pages/api/agentics/tins');
let wallets: typeof import('../../src/pages/api/agentics/wallets');
let destinations: typeof import('../../src/pages/api/agentics/destinations');
let plan: typeof import('../../src/pages/api/agentics/plan');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  mem.session = A;
  checks.checkWallet.mockReset().mockImplementation(async () => walletResult());
  checks.lookupVerifiedAddress.mockReset().mockResolvedValue(null);
  checks.isClaimedElsewhere.mockReset().mockResolvedValue(false);
  tins = await import('../../src/pages/api/agentics/tins');
  wallets = await import('../../src/pages/api/agentics/wallets');
  destinations = await import('../../src/pages/api/agentics/destinations');
  plan = await import('../../src/pages/api/agentics/plan');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function call(handler: APIRoute, url: string, method: string, body?: unknown) {
  const request = new Request(`https://almstins.com${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = (await handler({ request, url: new URL(request.url) } as never)) as Response;
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* a plain-text answer */ }
  return { res, raw, json };
}

const makeTin = async (label = 'Agent') => (await call(tins.POST, '/api/agentics/tins', 'POST', { label })).json.tin.id as string;
const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => addr(from + i)).join('\n');

describe('GET /api/agentics/plan', () => {
  it('tells an ordinary account its plan, its limits and what it uses', async () => {
    const tinId = await makeTin();
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(1, 4) });
    const { res, json } = await call(plan.GET, '/api/agentics/plan', 'GET');
    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      plan: 'free',
      label: 'Free',
      limits: { bots: 3, addresses: 15, walletsPerBot: 5 },
      use: { bots: 1, addresses: 4 },
    });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('tells the owner it has no limits (a limit of null is no limit)', async () => {
    mem.session = OWNER;
    const { json } = await call(plan.GET, '/api/agentics/plan', 'GET');
    expect(json).toEqual({ ok: true, plan: 'unlimited', label: 'Unlimited', limits: { bots: null, addresses: null, walletsPerBot: null }, use: { bots: 0, addresses: 0 } });
  });

  it('reads the account of the session and nothing from the request', async () => {
    const mine = await makeTin('Mine');
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId: mine, text: lines(1, 3) });
    mem.session = B;
    const { json } = await call(plan.GET, '/api/agentics/plan?tenantId=' + A.tenantId, 'GET');
    expect(json.use).toEqual({ bots: 0, addresses: 0 });
  });

  it('only reads: it exports a GET and nothing else, and nothing to buy', () => {
    const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/agentics/plan.ts'), 'utf8');
    expect([...src.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]).sort()).toEqual(['GET', 'prerender']);
    expect(src).not.toMatch(/\b(stripe|checkout|subscri|billing|invoice|price)\w*/i);
  });

  it('is a 404 for a signed-out visitor and a demo session even with the Vault open', async () => {
    for (const session of [null, { tenantId: DEMO_TENANT_ID, isDemo: true }, { tenantId: '' }]) {
      mem.session = session;
      const { res, raw } = await call(plan.GET, '/api/agentics/plan', 'GET');
      expect(res.status).toBe(404);
      expect(raw).toBe('Not found');
    }
  });
});

describe('an ordinary account at its limits', () => {
  it('the fourth agent is 409 plan_limit, naming the cap, the limit and the use, with no text of its own', async () => {
    for (const label of ['One', 'Two', 'Three']) expect((await call(tins.POST, '/api/agentics/tins', 'POST', { label })).res.status).toBe(201);
    const { res, json, raw } = await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Four' });
    expect(res.status).toBe(409);
    expect(json).toEqual({ ok: false, error: 'plan_limit', cap: 'bots', limit: 3, used: 3 });
    expect(raw).not.toMatch(/upgrade|price|billing|subscri|pay|plan\b.*\bcovers/i);
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('the sixth own wallet of an agent is 409 plan_limit, cap wallets', async () => {
    const tinId = await makeTin();
    for (let n = 1; n <= 5; n += 1) expect((await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(n) })).res.status).toBe(201);
    const { res, json } = await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(6) });
    expect(res.status).toBe(409);
    expect(json).toEqual({ ok: false, error: 'plan_limit', cap: 'wallets', limit: 5, used: 5 });
    // A wallet the agent already lists is a 200, not a refusal.
    expect((await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(2) })).res.status).toBe(200);
  });

  it('the sixteenth address is 409 plan_limit, cap addresses', async () => {
    const tinId = await makeTin();
    expect((await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(1, 10) })).res.status).toBe(201);
    expect((await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(11, 5) })).res.status).toBe(201);
    const { res, json } = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(16) });
    expect(res.status).toBe(409);
    // The refusal also says what became of the line, as an accepted paste would have.
    expect(json).toEqual({
      ok: false,
      error: 'plan_limit',
      cap: 'addresses',
      limit: 15,
      used: 15,
      skipped: [{ line: 1, chain: 'ethereum', address: addr(16), reason: 'over_limit' }],
      rejected: [],
    });
  });

  it('a paste that only partly fits is a 201: it adds what fits and says what it did not add, as over_limit', async () => {
    const tinId = await makeTin();
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(1, 10) });
    const { res, json } = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(11, 8) });
    expect(res.status).toBe(201);
    expect(json.summary).toMatchObject({ added: 5, skipped: 3 });
    expect(json.skipped.map((s: { reason: string }) => s.reason)).toEqual(['over_limit', 'over_limit', 'over_limit']);
    expect((await call(plan.GET, '/api/agentics/plan', 'GET')).json.use).toEqual({ bots: 1, addresses: 15 });
  });

  it('removing something frees its slot, over HTTP', async () => {
    const ids: string[] = [];
    for (const label of ['One', 'Two', 'Three']) ids.push(await makeTin(label));
    expect((await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Four' })).res.status).toBe(409);
    expect((await call(tins.DELETE, `/api/agentics/tins?id=${ids[0]}`, 'DELETE')).res.status).toBe(200);
    expect((await call(plan.GET, '/api/agentics/plan', 'GET')).json.use.bots).toBe(2);
    expect((await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Four' })).res.status).toBe(201);

    const tinId = ids[1];
    const first = (await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(1, 10) })).json.destinations[0].id as string;
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: lines(11, 5) });
    expect((await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(40) })).res.status).toBe(409);
    expect((await call(destinations.DELETE, `/api/agentics/destinations?id=${first}`, 'DELETE')).res.status).toBe(200);
    expect((await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(40) })).res.status).toBe(201);
  });

  it('one account never counts against another', async () => {
    for (const label of ['One', 'Two', 'Three']) await makeTin(label);
    mem.session = B;
    expect((await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Mine' })).res.status).toBe(201);
    expect((await call(plan.GET, '/api/agentics/plan', 'GET')).json.use.bots).toBe(1);
  });
});

describe('the owner is not limited', () => {
  it('has more than three agents, sixteen addresses and six own wallets', async () => {
    mem.session = OWNER;
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await call(tins.POST, '/api/agentics/tins', 'POST', { label: `Agent ${i}` });
      expect(r.res.status, `agent ${i}`).toBe(201);
      ids.push(r.json.tin.id);
    }
    for (let n = 1; n <= 6; n += 1) expect((await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId: ids[0], chain: 'ethereum', address: addr(n) })).res.status).toBe(201);
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId: ids[0], text: lines(1, 10) });
    const more = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId: ids[1], text: lines(11, 7) });
    expect(more.res.status).toBe(201);
    expect(more.json.summary).toMatchObject({ added: 7, skipped: 0 });
    expect((await call(plan.GET, '/api/agentics/plan', 'GET')).json.use).toEqual({ bots: 4, addresses: 17 });
  });
});
