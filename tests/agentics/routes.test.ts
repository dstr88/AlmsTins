import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, upper, walletResult } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

/**
 * The /api/agentics endpoints, called directly. Two things are checked here:
 *
 *   1. Each endpoint answers anyone but the owner with a plain 404 on its own, whatever the
 *      middleware gate does (tests/agentics/ownerOnlyGate.test.ts covers the gate), and touches
 *      neither the database nor a check.
 *   2. For the owner they take JSON, answer JSON with codes (never raw error text), and add,
 *      check, list and remove through the real Vault code over the in-memory database.
 *
 * The session, the database and the three outside checks are replaced; fetch is switched off as a
 * net. Every address, label and key is invented.
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
const mem = vi.hoisted(() => ({ session: null as null | { tenantId: string; isDemo?: boolean } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
const keys = vi.hoisted(() => ({ list: [] as Array<{ id: string; status: string }> }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => keys.list }));
const checks = vi.hoisted(() => ({
  checkWallet: vi.fn(),
  lookupVerifiedAddress: vi.fn(),
  isClaimedElsewhere: vi.fn(),
}));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: checks.checkWallet }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: checks.lookupVerifiedAddress }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: checks.isClaimedElsewhere }));

const KEY = 'a1'.repeat(12);
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const OWNER = { tenantId: OWNER_TENANT_ID };

let fake: ReceivablesDbFake;
let tins: typeof import('../../src/pages/api/agentics/tins');
let wallets: typeof import('../../src/pages/api/agentics/wallets');
let destinations: typeof import('../../src/pages/api/agentics/destinations');
let trust: typeof import('../../src/pages/api/agentics/destinations/trust');
const answers = new Map<string, ReturnType<typeof walletResult>>();

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  mem.session = OWNER;
  keys.list = [{ id: KEY, status: 'active' }];
  answers.clear();
  checks.checkWallet.mockReset().mockImplementation(async (a: string) => answers.get(a) ?? walletResult());
  checks.lookupVerifiedAddress.mockReset().mockResolvedValue(null);
  checks.isClaimedElsewhere.mockReset().mockResolvedValue(false);
  tins = await import('../../src/pages/api/agentics/tins');
  wallets = await import('../../src/pages/api/agentics/wallets');
  destinations = await import('../../src/pages/api/agentics/destinations');
  trust = await import('../../src/pages/api/agentics/destinations/trust');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function call(handler: APIRoute, url: string, method: string, body?: unknown) {
  const request = new Request(`https://almstins.com${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = (await handler({ request, url: new URL(request.url) } as never)) as Response;
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* a plain-text answer */ }
  return { res, raw, json };
}

/** Every method of every endpoint, with a body that would succeed for the owner. */
const ENDPOINTS: Array<[string, () => APIRoute, string, string, unknown?]> = [
  ['tins GET', () => tins.GET, '/api/agentics/tins', 'GET'],
  ['tins GET one', () => tins.GET, '/api/agentics/tins?id=x', 'GET'],
  ['tins POST', () => tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' }],
  ['tins PATCH', () => tins.PATCH, '/api/agentics/tins', 'PATCH', { id: 'x', label: 'Agent' }],
  ['tins DELETE', () => tins.DELETE, '/api/agentics/tins?id=x', 'DELETE'],
  ['wallets POST', () => wallets.POST, '/api/agentics/wallets', 'POST', { tinId: 'x', chain: 'ethereum', address: addr(1) }],
  ['wallets DELETE', () => wallets.DELETE, '/api/agentics/wallets?id=x', 'DELETE'],
  ['destinations GET', () => destinations.GET, '/api/agentics/destinations?tinId=x', 'GET'],
  ['destinations POST', () => destinations.POST, '/api/agentics/destinations', 'POST', { tinId: 'x', text: addr(1) }],
  ['destinations DELETE', () => destinations.DELETE, '/api/agentics/destinations?id=x', 'DELETE'],
  ['trust POST', () => trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId: 'x' }],
];

describe('owner only: anyone else gets a plain 404 from the endpoint itself', () => {
  const viewers: Array<[string, null | { tenantId: string; isDemo?: boolean }]> = [
    ['signed out', null],
    ['a demo session', { tenantId: DEMO_TENANT_ID, isDemo: true }],
    ['another account', { tenantId: OTHER_TENANT_ID }],
    ['the owner tenant flagged as demo', { tenantId: OWNER_TENANT_ID, isDemo: true }],
    ['a session with no tenant', { tenantId: '' }],
  ];

  for (const [who, session] of viewers) {
    it(`${who}: every endpoint is a 404, and no statement and no check runs`, async () => {
      mem.session = session;
      for (const [name, handler, url, method, body] of ENDPOINTS) {
        const { res, raw } = await call(handler(), url, method, body);
        expect(res.status, name).toBe(404);
        expect(raw, name).toBe('Not found');
        expect(res.headers.get('Content-Type'), name).not.toMatch(/json/);
      }
      expect(fake.log).toEqual([]);
      expect(checks.checkWallet).not.toHaveBeenCalled();
      expect(checks.lookupVerifiedAddress).not.toHaveBeenCalled();
      expect(checks.isClaimedElsewhere).not.toHaveBeenCalled();
    });
  }

  it('it makes no difference what the body says: nothing is parsed before the owner check', async () => {
    mem.session = { tenantId: OTHER_TENANT_ID };
    const { res } = await call(tins.POST, '/api/agentics/tins', 'POST', '{not json');
    expect(res.status).toBe(404);
  });

  it('the owner is not confused with another account by letter case', async () => {
    mem.session = { tenantId: OWNER_TENANT_ID.toUpperCase() };
    expect((await call(tins.GET, '/api/agentics/tins', 'GET')).res.status).toBe(200);
  });
});

describe('the owner: add a tin, an own wallet and destinations, check them, list them, remove them', () => {
  it('runs the whole flow', async () => {
    // A tin, linked to the agent key.
    const created = await call(tins.POST, '/api/agentics/tins', 'POST', { label: ' Treasury agent ', agentKeyId: KEY });
    expect(created.res.status).toBe(201);
    expect(created.json).toEqual({ ok: true, tin: { id: expect.any(String), label: 'Treasury agent', agentKeyId: KEY, createdAt: expect.any(String) } });
    const tinId = created.json.tin.id as string;
    expect((await call(tins.GET, '/api/agentics/tins', 'GET')).json.tins.map((t: { id: string }) => t.id)).toEqual([tinId]);

    // The agent's own wallet, twice.
    const first = await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: upper(addr(1)) });
    expect(first.res.status).toBe(201);
    expect(first.json).toMatchObject({ ok: true, added: true, wallet: { chain: 'ethereum', address: addr(1) } });
    const again = await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(1) });
    expect(again.res.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, added: false });

    // Add + Trust: three lines, one on a sanctions list, one repeated, one not an address.
    answers.set(addr(3), walletResult({ flags: { sanctioned: true } }));
    const text = `address,label\n${addr(2)}, Exchange\n${addr(3)}, Bad actor\n${addr(2)}\nnot an address`;
    const added = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text });
    expect(added.res.status).toBe(201);
    expect(added.json.summary).toEqual({ added: 2, trusted: 1, flagged: 1, pending: 0, skipped: 1, rejected: 1 });
    expect(added.json.skipped).toEqual([{ line: 4, chain: 'ethereum', address: addr(2), reason: 'repeated_in_paste' }]);
    expect(added.json.rejected).toEqual([{ line: 5, reason: 'no_address', text: 'not an address' }]);
    const byAddress = Object.fromEntries(added.json.destinations.map((d: any) => [d.address, d]));
    expect(byAddress[addr(2)]).toMatchObject({ label: 'Exchange', trustStatus: 'trusted', trust: { result: 'pass', hits: [] } });
    expect(byAddress[addr(3)]).toMatchObject({ label: 'Bad actor', trustStatus: 'flagged', trust: { result: 'fail', hits: ['sanctioned'] } });

    // The list shows both, pills and all.
    const listed = await call(destinations.GET, `/api/agentics/destinations?tinId=${tinId}`, 'GET');
    expect(listed.json.destinations.map((d: any) => d.trustStatus).sort()).toEqual(['flagged', 'trusted']);

    // The trust call: nothing pending, so nothing to do.
    const nothing = await call(trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId });
    expect(nothing.res.status).toBe(200);
    expect(nothing.json).toMatchObject({ ok: true, destinations: [], stillFlagged: [], notFound: [], remaining: 0 });

    // Asking about the flagged one with a clean answer now: it stays flagged.
    answers.set(addr(3), walletResult());
    const flaggedId = byAddress[addr(3)].id as string;
    const recheck = await call(trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId, ids: [flaggedId] });
    expect(recheck.json.stillFlagged).toEqual([flaggedId]);
    expect(recheck.json.destinations[0].trustStatus).toBe('flagged');

    // The whole tin, in one read.
    const detail = await call(tins.GET, `/api/agentics/tins?id=${tinId}`, 'GET');
    expect(detail.json.tin.id).toBe(tinId);
    expect(detail.json.wallets).toHaveLength(1);
    expect(detail.json.destinations).toHaveLength(2);

    // Rename, then remove the flagged destination, then the wallet, then the tin.
    expect((await call(tins.PATCH, '/api/agentics/tins', 'PATCH', { id: tinId, label: 'Renamed', agentKeyId: null })).json.tin).toMatchObject({ label: 'Renamed', agentKeyId: null });
    expect((await call(destinations.DELETE, `/api/agentics/destinations?id=${flaggedId}`, 'DELETE')).json).toEqual({ ok: true });
    expect((await call(destinations.GET, `/api/agentics/destinations?tinId=${tinId}`, 'GET')).json.destinations).toHaveLength(1);
    expect((await call(wallets.DELETE, `/api/agentics/wallets?id=${first.json.wallet.id}`, 'DELETE')).json).toEqual({ ok: true });
    expect((await call(tins.DELETE, `/api/agentics/tins?id=${tinId}`, 'DELETE')).json).toEqual({ ok: true });
    const gone = await call(tins.GET, `/api/agentics/tins?id=${tinId}`, 'GET');
    expect(gone.res.status).toBe(404);
    expect(gone.json).toEqual({ ok: false, error: 'tin_not_found' });
    // History stays: every row is still in the table.
    expect(fake.rows('agent_tins')).toHaveLength(1);
    expect(fake.rows('agent_wallets')).toHaveLength(1);
    expect(fake.rows('agent_destinations')).toHaveLength(2);
  });

  it('adds without checking when asked, and the trust call then checks the pending ones', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const added = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(1), trust: false });
    expect(added.json.checked).toBe(false);
    expect(added.json.destinations[0].trustStatus).toBe('pending');
    expect(checks.checkWallet).not.toHaveBeenCalled();
    const run = await call(trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId });
    expect(run.json.destinations.map((d: any) => d.trustStatus)).toEqual(['trusted']);
    expect(checks.checkWallet).toHaveBeenCalledTimes(1);
  });

  it('answers 201 only when something was added: a paste of repeats and rejects is a 200', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    expect((await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(1) })).res.status).toBe(201);
    const again = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: `${addr(1)}\nnot an address` });
    expect(again.res.status).toBe(200);
    expect(again.json.summary).toMatchObject({ added: 0, skipped: 1, rejected: 1 });
  });

  it('a polygon line is stored on polygon', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const r = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: `polygon, ${addr(1)}`, chain: 'avalanche' });
    expect(r.json.destinations[0].chain).toBe('polygon');
  });
});

describe('errors are codes, with the status that fits', () => {
  it('a body that is not a JSON object is a 400, and one that is too large a 413', async () => {
    for (const body of ['{not json', '[]', '"x"', '123', 'null', '']) {
      const r = await call(tins.POST, '/api/agentics/tins', 'POST', body);
      expect(r.res.status, body).toBe(400);
      expect(r.json, body).toEqual({ ok: false, error: 'expected_json' });
    }
    const big = await call(tins.POST, '/api/agentics/tins', 'POST', JSON.stringify({ label: 'x'.repeat(61_000) }));
    expect(big.res.status).toBe(413);
    expect(big.json).toEqual({ ok: false, error: 'too_large' });
    const declared = new Request('https://almstins.com/api/agentics/tins', { method: 'POST', headers: { 'content-length': '999999999' }, body: '{}' });
    const res = (await tins.POST({ request: declared, url: new URL(declared.url) } as never)) as Response;
    expect(res.status).toBe(413);
  });

  it('maps each Vault failure to its status', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const cases: Array<[string, Promise<{ res: Response; json: any }>, number, string]> = [
      ['bad label', call(tins.POST, '/api/agentics/tins', 'POST', { label: '' }), 400, 'invalid_label'],
      ['unknown key', call(tins.POST, '/api/agentics/tins', 'POST', { label: 'x', agentKeyId: 'f6'.repeat(12) }), 404, 'key_not_found'],
      ['no tin', call(tins.GET, '/api/agentics/tins?id=ghost', 'GET'), 404, 'tin_not_found'],
      ['no id', call(tins.DELETE, '/api/agentics/tins', 'DELETE'), 400, 'invalid_id'],
      ['bad chain', call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'bitcoin', address: addr(1) }), 400, 'invalid_chain'],
      ['bad address', call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: 'nope' }), 400, 'invalid_address'],
      ['no wallet', call(wallets.DELETE, '/api/agentics/wallets?id=ghost', 'DELETE'), 404, 'wallet_not_found'],
      ['nothing to add', call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: '   ' }), 400, 'nothing_to_add'],
      ['too long', call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: 'x'.repeat(50_001) }), 413, 'text_too_long'],
      ['no destination', call(destinations.DELETE, '/api/agentics/destinations?id=ghost', 'DELETE'), 404, 'destination_not_found'],
      ['no tin to list', call(destinations.GET, '/api/agentics/destinations?tinId=ghost', 'GET'), 404, 'tin_not_found'],
      ['no tin to trust', call(trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId: 'ghost' }), 404, 'tin_not_found'],
    ];
    for (const [name, pending, status, error] of cases) {
      const r = await pending;
      expect(r.res.status, name).toBe(status);
      expect(r.json, name).toMatchObject({ ok: false, error });
    }
  });

  it('too many destinations in one paste is a 400 that says the limit', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const text = Array.from({ length: 11 }, (_, i) => addr(i + 1)).join('\n');
    const r = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text });
    expect(r.res.status).toBe(400);
    expect(r.json).toEqual({ ok: false, error: 'too_many', max: 10 });
  });

  it('a key already on another tin is a 409', async () => {
    await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'One', agentKeyId: KEY });
    const r = await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Two', agentKeyId: KEY });
    expect(r.res.status).toBe(409);
    expect(r.json).toEqual({ ok: false, error: 'key_in_use' });
  });
});

describe('what the endpoints say', () => {
  it('every answer is private and uncached, and none carries a tenant id', async () => {
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const responses = [
      await call(tins.GET, '/api/agentics/tins', 'GET'),
      await call(tins.GET, `/api/agentics/tins?id=${tinId}`, 'GET'),
      await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(1) }),
      await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(2) }),
      await call(destinations.GET, `/api/agentics/destinations?tinId=${tinId}`, 'GET'),
      await call(trust.POST, '/api/agentics/destinations/trust', 'POST', { tinId }),
      await call(tins.GET, '/api/agentics/tins?id=ghost', 'GET'),
      await call(tins.POST, '/api/agentics/tins', 'POST', '{bad'),
    ];
    for (const { res, raw } of responses) {
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(raw).not.toContain(OWNER_TENANT_ID);
      expect(raw.toLowerCase()).not.toContain('tenant');
    }
  });

  it('an unexpected failure is a plain 500 with no raw error text, logged by name and code only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leaky = `duplicate key value (${OWNER_TENANT_ID}, ${addr(7)})`;
    holder.intercept = (sql) => {
      if (/^INSERT INTO agent_tins/.test(sql)) throw Object.assign(new Error(leaky), { name: 'DatabaseError', code: '57P01' });
    };
    const r = await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' });
    expect(r.res.status).toBe(500);
    expect(r.json).toEqual({ ok: false, error: 'server_error' });
    expect(r.raw).not.toContain(addr(7));
    expect(r.raw).not.toContain(OWNER_TENANT_ID);
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('DatabaseError');
    expect(logged).toContain('57P01');
    expect(logged).not.toContain(addr(7));
    expect(logged).not.toContain(OWNER_TENANT_ID);
  });

  it('checks that cannot run never take the endpoint down: the destination is just pending', async () => {
    checks.checkWallet.mockRejectedValue(new Error('network down'));
    checks.lookupVerifiedAddress.mockRejectedValue(new Error('database down'));
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;
    const r = await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(1) });
    expect(r.res.status).toBe(201);
    expect(r.json.summary).toMatchObject({ added: 1, trusted: 0, pending: 1 });
    expect(r.json.destinations[0].trust.limits).toEqual(['sanctions', 'screening', 'verify']);
  });
});

describe('the endpoint files', () => {
  const API = path.resolve(__dirname, '../../src/pages/api/agentics');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const files = walk(API);

  it('finds the four endpoint files', () => {
    expect(files.map((f) => path.relative(API, f).split(path.sep).join('/')).sort()).toEqual([
      'destinations.ts', 'destinations/trust.ts', 'tins.ts', 'wallets.ts',
    ]);
  });

  it('read only an id from the URL: an address goes in the body, never in a query string', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const keys = [...src.matchAll(/searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const key of keys) expect(['id', 'tinId'], `${file}: ${key}`).toContain(key);
    }
  });

  it('are wrapped in vaultRoute, which checks the owner, and never export a bare handler', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const handlers = [...src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE|OPTIONS|ALL) = (.*)$/gm)];
      expect(handlers.length, file).toBeGreaterThan(0);
      for (const [, method, rest] of handlers) expect(rest, `${file} ${method}`).toMatch(/^vaultRoute\(/);
      expect(src, file).toMatch(/export const prerender = false;/);
    }
  });
});
