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
let events: typeof import('../../src/pages/api/agentics/events');
let refresh: typeof import('../../src/pages/api/agentics/refresh');
let totals: typeof import('../../src/pages/api/agentics/totals');
let reportsRoute: typeof import('../../src/pages/api/agentics/reports');
let pdfRoute: typeof import('../../src/pages/api/agentics/reports/pdf');
let bundleRoute: typeof import('../../src/pages/api/agentics/reports/bundle');
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
  events = await import('../../src/pages/api/agentics/events');
  refresh = await import('../../src/pages/api/agentics/refresh');
  totals = await import('../../src/pages/api/agentics/totals');
  reportsRoute = await import('../../src/pages/api/agentics/reports');
  pdfRoute = await import('../../src/pages/api/agentics/reports/pdf');
  bundleRoute = await import('../../src/pages/api/agentics/reports/bundle');
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
  ['events GET', () => events.GET, '/api/agentics/events?tinId=x', 'GET'],
  ['refresh POST', () => refresh.POST, '/api/agentics/refresh', 'POST', { tinId: 'x' }],
  ['totals GET', () => totals.GET, '/api/agentics/totals?tinId=x', 'GET'],
  ['reports GET list', () => reportsRoute.GET, '/api/agentics/reports?tinId=x', 'GET'],
  ['reports GET one', () => reportsRoute.GET, '/api/agentics/reports?id=x', 'GET'],
  ['reports POST', () => reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId: 'x', day: '2026-10-17' }],
  ['reports pdf GET', () => pdfRoute.GET, '/api/agentics/reports/pdf?id=x', 'GET'],
  ['reports bundle GET', () => bundleRoute.GET, '/api/agentics/reports/bundle?id=x', 'GET'],
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

  it('finds the ten endpoint files', () => {
    expect(files.map((f) => path.relative(API, f).split(path.sep).join('/')).sort()).toEqual([
      'destinations.ts', 'destinations/trust.ts', 'events.ts', 'refresh.ts', 'reports.ts', 'reports/bundle.ts', 'reports/pdf.ts', 'tins.ts', 'totals.ts', 'wallets.ts',
    ]);
  });

  it('read only an id from the URL (and, for the ledger and the reports, a page size and a cursor): an address goes in the body, never in a query string', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const allowed = file.endsWith('events.ts') || file.endsWith('reports.ts') ? ['id', 'tinId', 'limit', 'before'] : ['id', 'tinId'];
      const keys = [...src.matchAll(/searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const key of keys) expect(allowed, `${file}: ${key}`).toContain(key);
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

describe('the owner: read a tin\'s ledger', () => {
  const put = async (tinId: string, i: number, over: Record<string, unknown> = {}) => {
    const ledger = await import('../../src/lib/agentVault/events');
    return ledger.insertCheckedEvent(OWNER_TENANT_ID, {
      tinId, address: addr(i), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
      keyId: KEY, sourceIp: null, detail: { basis: 'not_in_registry' }, at: new Date(Date.UTC(2026, 9, 18, 12, 0, 0, i)).toISOString(),
      ...over,
    });
  };
  const newTin = async () => (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent', agentKeyId: KEY })).json.tin.id as string;

  it('answers JSON, newest first, with a cursor for the older page, and carries no account id', async () => {
    const tinId = await newTin();
    for (const i of [1, 2, 3]) await put(tinId, i);
    const first = await call(events.GET, `/api/agentics/events?tinId=${tinId}&limit=2`, 'GET');
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(first.json.events.map((e: any) => e.address)).toEqual([addr(3), addr(2)]);
    expect(first.json.events[0]).toMatchObject({ kind: 'checked', answer: 'unknown', registry: 'none', keyId: KEY, keyStatus: 'active' });
    expect(first.json.next).toEqual(expect.any(String));
    expect(first.raw).not.toMatch(/tenant/i);

    const second = await call(events.GET, `/api/agentics/events?tinId=${tinId}&limit=2&before=${encodeURIComponent(first.json.next)}`, 'GET');
    expect(second.json.events.map((e: any) => e.address)).toEqual([addr(1)]);
    expect(second.json.next).toBeNull();
  });

  it('answers codes, not raw errors, for a missing tin, an unknown tin and a bad cursor', async () => {
    const tinId = await newTin();
    expect((await call(events.GET, '/api/agentics/events', 'GET')).json).toEqual({ ok: false, error: 'invalid_id' });
    const unknown = await call(events.GET, '/api/agentics/events?tinId=no-such-tin', 'GET');
    expect(unknown.res.status).toBe(404);
    expect(unknown.json).toEqual({ ok: false, error: 'tin_not_found' });
    const bad = await call(events.GET, `/api/agentics/events?tinId=${tinId}&before=nope`, 'GET');
    expect(bad.res.status).toBe(400);
    expect(bad.json).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('has no way to change or remove an event: only GET exists', async () => {
    expect(Object.keys(events).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });

  it('a database failure is a plain 500 with no database text', async () => {
    const tinId = await newTin();
    holder.intercept = (sql) => { if (/FROM agent_events/i.test(sql)) throw Object.assign(new Error('relation "secret_table" exploded'), { code: 'XX000' }); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, raw, json } = await call(events.GET, `/api/agentics/events?tinId=${tinId}`, 'GET');
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
    expect(raw).not.toMatch(/secret_table|exploded/);
  });
});

describe('the owner: read the chain now, and the totals', () => {
  const newTin = async () => (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent' })).json.tin.id as string;

  it('a read with no wallets or no trusted destinations is an answer, not an error', async () => {
    const tinId = await newTin();
    const r = await call(refresh.POST, '/api/agentics/refresh', 'POST', { tinId });
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.json).toEqual({
      ok: true,
      pass: { tinId, startedAt: expect.any(String), watchedDestinations: 0, notWatched: { pending: 0, flagged: 0, overLimit: 0 }, wallets: [], recorded: 0 },
    });
    expect(r.raw).not.toMatch(/tenant/i);
  });

  it('a read with the explorer unreachable says so with a code, and writes nothing to the ledger', async () => {
    const tinId = await newTin();
    await call(wallets.POST, '/api/agentics/wallets', 'POST', { tinId, chain: 'ethereum', address: addr(1) });
    await call(destinations.POST, '/api/agentics/destinations', 'POST', { tinId, text: addr(2) });
    const r = await call(refresh.POST, '/api/agentics/refresh', 'POST', { tinId });
    expect(r.res.status).toBe(200);
    expect(r.json.pass.wallets).toHaveLength(1);
    expect(r.json.pass.wallets[0]).toMatchObject({ chain: 'ethereum', address: addr(1), status: expect.stringMatching(/^(idle|unavailable)$/), recorded: 0 });
    expect(fake.rows('agent_events') ?? []).toEqual([]);
    expect(r.raw).not.toMatch(/tenant/i);
  });

  it('answers codes for a missing or unknown tin and a body that is not JSON', async () => {
    expect((await call(refresh.POST, '/api/agentics/refresh', 'POST', {})).json).toEqual({ ok: false, error: 'invalid_id' });
    const unknown = await call(refresh.POST, '/api/agentics/refresh', 'POST', { tinId: 'no-such-tin' });
    expect(unknown.res.status).toBe(404);
    expect(unknown.json).toEqual({ ok: false, error: 'tin_not_found' });
    expect((await call(refresh.POST, '/api/agentics/refresh', 'POST', '{not json')).json).toEqual({ ok: false, error: 'expected_json' });
  });

  it('has no GET: reading the chain is something the owner asks for, not a page that loads', () => {
    expect(Object.keys(refresh).filter((k) => /^(GET|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
    expect(Object.keys(totals).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });

  it('the totals of a tin with nothing recorded are zero, and carry no account id', async () => {
    const tinId = await newTin();
    const r = await call(totals.GET, `/api/agentics/totals?tinId=${tinId}`, 'GET');
    expect(r.res.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      tinId,
      totals: {
        transactions: 0,
        bought: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 },
        sold: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 },
      },
    });
    expect(r.raw).not.toMatch(/tenant/i);
  });

  it('the totals add up the transfers in the ledger', async () => {
    const tinId = await newTin();
    const ledger = await import('../../src/lib/agentVault/events');
    const put = (leg: string, direction: 'in' | 'out', usd: number | null) => ledger.insertTransactionEvent(OWNER_TENANT_ID, {
      tinId, address: addr(2), chain: 'ethereum', leg, answer: 'unknown', status: null,
      tx: { hash: `0x${'1'.repeat(64)}`, direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
      detail: {}, at: new Date().toISOString(),
    });
    await put('a', 'in', 120.5);
    await put('b', 'out', 20);
    await put('c', 'out', null);
    const r = await call(totals.GET, `/api/agentics/totals?tinId=${tinId}`, 'GET');
    expect(r.json.totals).toEqual({
      transactions: 3,
      bought: { count: 1, pricedCount: 1, unpricedCount: 0, usd: 120.5 },
      sold: { count: 2, pricedCount: 1, unpricedCount: 1, usd: 20 },
    });
  });

  it('answers codes for the totals of a missing or unknown tin', async () => {
    expect((await call(totals.GET, '/api/agentics/totals', 'GET')).json).toEqual({ ok: false, error: 'invalid_id' });
    const unknown = await call(totals.GET, '/api/agentics/totals?tinId=no-such-tin', 'GET');
    expect(unknown.res.status).toBe(404);
    expect(unknown.json).toEqual({ ok: false, error: 'tin_not_found' });
  });

  it('a database failure is a plain 500 with no database text', async () => {
    const tinId = await newTin();
    holder.intercept = (sql) => { if (/FROM agent_events/i.test(sql)) throw Object.assign(new Error('relation "secret_table" exploded'), { code: 'XX000' }); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, raw, json } = await call(totals.GET, `/api/agentics/totals?tinId=${tinId}`, 'GET');
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
    expect(raw).not.toMatch(/secret_table|exploded/);
  });
});

describe('the owner: operator reports', () => {
  const DAY = '2026-10-17';
  const newTin = async () => {
    const id = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent', agentKeyId: KEY })).json.tin.id as string;
    fake.rows('agent_tins').find((t) => t.id === id)!.created_at = '2026-10-01 00:00:00'; // a tin old enough to have a report for DAY
    return id;
  };
  const put = async (tinId: string, i: number, basis: string, answer: string) => {
    const ledger = await import('../../src/lib/agentVault/events');
    return ledger.insertCheckedEvent(OWNER_TENANT_ID, {
      tinId, address: addr(i), chain: null, answer: answer as never, registry: 'none', status: 'unknown',
      keyId: KEY, sourceIp: null, detail: { basis }, at: new Date(Date.UTC(2026, 9, 17, 12, 0, 0, i)).toISOString(),
    });
  };

  it('makes a report, 201 the first time and 200 when nothing changed, and reads it back with its versions', async () => {
    const tinId = await newTin();
    await put(tinId, 1, 'registry_flagged', 'flagged');
    await put(tinId, 2, 'not_in_registry', 'unknown');

    const made = await call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: DAY });
    expect(made.res.status).toBe(201);
    expect(made.res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(made.json).toMatchObject({ ok: true, created: true, report: { day: DAY, version: 1, tinId, headline: { issues: 1, notConfirmed: 1, new: 0, noIssues: 0, checks: 2 } } });
    expect(made.json.report.content.buckets.issues.listed[0].address).toBe(addr(1));
    expect(made.raw).not.toMatch(/tenant/i);

    const again = await call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: DAY });
    expect(again.res.status).toBe(200);
    expect(again.json).toMatchObject({ created: false, report: { id: made.json.report.id } });

    const one = await call(reportsRoute.GET, `/api/agentics/reports?id=${made.json.report.id}`, 'GET');
    expect(one.res.status).toBe(200);
    expect(one.json.report).toMatchObject({ id: made.json.report.id, versions: [{ version: 1 }] });
    expect(one.raw).not.toMatch(/tenant/i);
  });

  it('lists a tin\'s reports with headline counts and no address, and pages', async () => {
    const tinId = await newTin();
    await put(tinId, 1, 'registry_flagged', 'flagged');
    for (const day of ['2026-10-15', '2026-10-16', DAY]) await call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day });
    const list = await call(reportsRoute.GET, `/api/agentics/reports?tinId=${tinId}&limit=2`, 'GET');
    expect(list.res.status).toBe(200);
    expect(list.json.reports.map((r: any) => r.day)).toEqual([DAY, '2026-10-16']);
    expect(list.json.next).toBe('2026-10-16');
    expect(list.raw).not.toContain(addr(1));
    expect(list.raw).not.toMatch(/tenant/i);
    const older = await call(reportsRoute.GET, `/api/agentics/reports?tinId=${tinId}&limit=2&before=${list.json.next}`, 'GET');
    expect(older.json.reports.map((r: any) => r.day)).toEqual(['2026-10-15']);
    expect(older.json.next).toBeNull();
  });

  it('answers codes, with the status that fits, for every way a request can be wrong', async () => {
    const tinId = await newTin();
    const cases: Array<[string, Promise<{ res: Response; json: any }>, number, string]> = [
      ['no tin id', call(reportsRoute.GET, '/api/agentics/reports', 'GET'), 400, 'invalid_id'],
      ['unknown tin', call(reportsRoute.GET, '/api/agentics/reports?tinId=ghost', 'GET'), 404, 'tin_not_found'],
      ['unknown report', call(reportsRoute.GET, '/api/agentics/reports?id=ghost', 'GET'), 404, 'report_not_found'],
      ['bad cursor', call(reportsRoute.GET, `/api/agentics/reports?tinId=${tinId}&before=nope`, 'GET'), 400, 'invalid_cursor'],
      ['no day', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId }), 400, 'invalid_period'],
      ['not a date', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: '2026-02-30' }), 400, 'invalid_period'],
      ['the future', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: '2999-01-01' }), 400, 'invalid_period'],
      ['before the tin existed', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: '2026-09-30' }), 400, 'invalid_period'],
      ['unknown tin on make', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId: 'ghost', day: DAY }), 404, 'tin_not_found'],
      ['no tin id on make', call(reportsRoute.POST, '/api/agentics/reports', 'POST', { day: DAY }), 400, 'invalid_id'],
      ['not JSON', call(reportsRoute.POST, '/api/agentics/reports', 'POST', '{nope'), 400, 'expected_json'],
    ];
    for (const [name, pending, status, error] of cases) {
      const r = await pending;
      expect(r.res.status, name).toBe(status);
      expect(r.json, name).toEqual({ ok: false, error });
    }
  });

  it('has no way to change or remove a report: only GET and POST exist, and POST adds a version', () => {
    expect(Object.keys(reportsRoute).filter((k) => /^(PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
    expect(Object.keys(reportsRoute).filter((k) => /^(GET|POST)$/.test(k)).sort()).toEqual(['GET', 'POST']);
  });

  it('a database failure is a plain 500 with no database text', async () => {
    const tinId = await newTin();
    holder.intercept = (sql) => { if (/FROM agent_events/i.test(sql)) throw Object.assign(new Error('relation "secret_table" exploded'), { code: 'XX000' }); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, raw, json } = await call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: DAY });
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
    expect(raw).not.toMatch(/secret_table|exploded/);
  });
});

describe('the owner: the signed PDF and the proof bundle of a report', () => {
  const DAY = '2026-10-17';
  const useKey = (seed: string) => vi.stubEnv('ALMSTINS_SIGNING_KEY', seed);
  const SEED = 'ab'.repeat(32);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const reportFor = async (signed: boolean) => {
    vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
    vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
    useKey(signed ? SEED : '');
    const tinId = (await call(tins.POST, '/api/agentics/tins', 'POST', { label: 'Agent', agentKeyId: KEY })).json.tin.id as string;
    fake.rows('agent_tins').find((t) => t.id === tinId)!.created_at = '2026-10-01 00:00:00';
    const ledger = await import('../../src/lib/agentVault/events');
    await ledger.insertCheckedEvent(OWNER_TENANT_ID, {
      tinId, address: addr(1), chain: null, answer: 'flagged', registry: 'flagged', status: 'unknown', keyId: KEY, sourceIp: null,
      detail: { basis: 'registry_flagged' }, at: '2026-10-17T12:00:00.000Z',
    });
    const made = await call(reportsRoute.POST, '/api/agentics/reports', 'POST', { tinId, day: DAY });
    return { tinId, id: made.json.report.id as string };
  };

  const getRaw = async (handler: APIRoute, url: string) => {
    const request = new Request(`https://almstins.com${url}`);
    const res = (await handler({ request, url: new URL(request.url) } as never)) as Response;
    return { res, bytes: Buffer.from(await res.arrayBuffer()) };
  };

  it('hands out a PDF of a signed report: private, uncached, named by the day and version, and a real PDF', async () => {
    const { id } = await reportFor(true);
    const { res, bytes } = await getRaw(pdfRoute.GET, `/api/agentics/reports/pdf?id=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="almstins-agent-report-${DAY}-v1-${id.slice(0, 8)}.pdf"`);
    expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('hands out the proof bundle of a signed report, which the public verifier reads as verified', async () => {
    const { id } = await reportFor(true);
    const { res, bytes } = await getRaw(bundleRoute.GET, `/api/agentics/reports/bundle?id=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="almstins-agent-report-${DAY}-v1-${id.slice(0, 8)}-proof.json"`);
    const bundle = JSON.parse(bytes.toString('utf8'));
    expect(bundle.manifest).toMatchObject({ record_id: id, record_type: 'agent_report', version: 1, period: DAY });
    const { verifyReportBundle } = await import('../../src/lib/agentVault/reportProof');
    expect(verifyReportBundle(bundle).verdict).toBe('verified');
    expect(JSON.stringify(bundle.manifest)).not.toContain(addr(1));
    expect(bytes.toString('utf8')).toContain(addr(1)); // the address is in the leaves, which stay with the owner
  });

  it('refuses, with a code and no document, a report that was made unsigned', async () => {
    const { id } = await reportFor(false);
    for (const [handler, url] of [[pdfRoute.GET, `/api/agentics/reports/pdf?id=${id}`], [bundleRoute.GET, `/api/agentics/reports/bundle?id=${id}`]] as const) {
      const r = await call(handler, url, 'GET');
      expect(r.res.status, url).toBe(409);
      expect(r.res.headers.get('Content-Type'), url).toBe('application/json');
      expect(r.json, url).toEqual({ ok: false, error: 'not_signed' });
    }
  });

  it('refuses a report whose stored words no longer match what was signed', async () => {
    const { id } = await reportFor(true);
    const row = fake.rows('agent_reports').find((r) => r.id === id)!;
    row.summary_json = row.summary_json.replace('"issues":{"addresses":1', '"issues":{"addresses":0');
    for (const [handler, url] of [[pdfRoute.GET, `/api/agentics/reports/pdf?id=${id}`], [bundleRoute.GET, `/api/agentics/reports/bundle?id=${id}`]] as const) {
      const r = await call(handler, url, 'GET');
      expect(r.res.status, url).toBe(409);
      expect(r.json, url).toEqual({ ok: false, error: 'report_altered' });
    }
  });

  it('refuses, as unavailable, a signed report when no published key can confirm the signature now', async () => {
    const { id } = await reportFor(true);
    useKey('');
    for (const [handler, url] of [[pdfRoute.GET, `/api/agentics/reports/pdf?id=${id}`], [bundleRoute.GET, `/api/agentics/reports/bundle?id=${id}`]] as const) {
      const r = await call(handler, url, 'GET');
      expect(r.res.status, url).toBe(503);
      expect(r.json, url).toEqual({ ok: false, error: 'signing_unavailable' });
    }
  });

  it('answers codes for a missing or unknown report', async () => {
    for (const handler of [pdfRoute.GET, bundleRoute.GET]) {
      const base = handler === pdfRoute.GET ? '/api/agentics/reports/pdf' : '/api/agentics/reports/bundle';
      expect((await call(handler, base, 'GET')).json).toEqual({ ok: false, error: 'invalid_id' });
      const unknown = await call(handler, `${base}?id=no-such-report`, 'GET');
      expect(unknown.res.status).toBe(404);
      expect(unknown.json).toEqual({ ok: false, error: 'report_not_found' });
    }
  });

  it('has no way to change anything: only GET exists on both', () => {
    for (const mod of [pdfRoute, bundleRoute]) expect(Object.keys(mod).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });

  it('a database failure is a plain 500 with no database text', async () => {
    const { id } = await reportFor(true);
    holder.intercept = (sql) => { if (/FROM agent_reports/i.test(sql)) throw Object.assign(new Error('relation "secret_table" exploded'), { code: 'XX000' }); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, raw, json } = await call(pdfRoute.GET, `/api/agentics/reports/pdf?id=${id}`, 'GET');
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
    expect(raw).not.toMatch(/secret_table|exploded/);
  });
});
