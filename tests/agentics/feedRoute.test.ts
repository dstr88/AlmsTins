import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIRoute } from 'astro';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The two live-feed endpoints, called directly: GET /api/agentics/feed and POST /api/agentics/feed/read. The
 * owner-only 404 for everyone else is checked for every endpoint at once in routes.test.ts; what is checked here
 * is what the owner gets: the shape of the answer, the codes, the headers, and the limits on how often an account
 * may ask. The session, the database and the outside checks are replaced; fetch is switched off as a net.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const mem = vi.hoisted(() => ({ session: null as null | { tenantId: string; isDemo?: boolean } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: vi.fn(), getCached: vi.fn(() => null) }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: vi.fn() }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: vi.fn() }));

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let feedRoute: typeof import('../../src/pages/api/agentics/feed');
let readRoute: typeof import('../../src/pages/api/agentics/feed/read');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  mem.session = { tenantId: OWNER_TENANT_ID };
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  feedRoute = await import('../../src/pages/api/agentics/feed');
  readRoute = await import('../../src/pages/api/agentics/feed/read');
  await events.ensureAgentEventsTable();
});

afterEach(() => {
  vi.useRealTimers();
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

const newTin = (label = 'Treasury agent') => store.insertTin(OWNER_TENANT_ID, { label, agentKeyId: null, at: '2026-10-01 00:00:00' });
function put(tinId: string, writtenAt: string, id: string) {
  fake.seed('agent_events', {
    id, tenant_id: OWNER_TENANT_ID, tin_id: tinId, kind: 'checked', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
    key_id: null, source_ip: 'hash', tx_hash: null, direction: null, wallet: null, amount: null, asset: null, asset_contract: null, usd_value: null,
    block_number: null, detail_json: '{"basis":"not_in_registry"}', occurred_at: `${writtenAt.replace(' ', 'T')}.000Z`, created_at: writtenAt,
  });
}

describe('GET /api/agentics/feed', () => {
  it('answers the owner with the events, where to poll next, and a clock', async () => {
    const t = await newTin();
    put(t.id, '2026-10-19 11:00:01', '00000000-0000-4000-8000-000000000001');
    put(t.id, '2026-10-19 11:00:02', '00000000-0000-4000-8000-000000000002');
    const { res, json } = await call(feedRoute.GET, '/api/agentics/feed', 'GET');
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, more: false, cursor: null, since: '2026-10-19 11:00:02' });
    expect(json.events.map((e: any) => e.id)).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(json.events[0]).toMatchObject({ agent: 'Treasury agent', label: null, kind: 'checked', writtenAt: '2026-10-19 11:00:01' });
    expect(typeof json.now).toBe('string');
  });

  it('is never cached', async () => {
    await newTin();
    const { res } = await call(feedRoute.GET, '/api/agentics/feed', 'GET');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Type')).toMatch(/json/);
  });

  it('reads `since`, `after`, `limit` and `tinId` from the query string and nothing else', async () => {
    const t = await newTin();
    put(t.id, '2026-10-19 11:00:01', '00000000-0000-4000-8000-000000000001');
    put(t.id, '2026-10-19 11:00:02', '00000000-0000-4000-8000-000000000002');
    put(t.id, '2026-10-19 11:00:03', '00000000-0000-4000-8000-000000000003');
    const poll = await call(feedRoute.GET, `/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}&limit=2&tinId=${t.id}`, 'GET');
    expect(poll.json.events).toHaveLength(2);
    expect(poll.json.more).toBe(true);
    const next = await call(feedRoute.GET, `/api/agentics/feed?after=${encodeURIComponent(poll.json.cursor)}`, 'GET');
    expect(next.json.events.map((e: any) => e.id)).toEqual(['00000000-0000-4000-8000-000000000003']);
    // A tenant in the query string is not read.
    const sneaky = await call(feedRoute.GET, '/api/agentics/feed?tenantId=someone-else&tenant_id=someone-else', 'GET');
    expect(sneaky.json.events).toHaveLength(3);
  });

  it('answers a time or a cursor it did not make with 400 invalid_cursor, and an unknown agent with 404', async () => {
    await newTin();
    expect((await call(feedRoute.GET, '/api/agentics/feed?since=yesterday', 'GET')).json).toEqual({ ok: false, error: 'invalid_cursor' });
    expect((await call(feedRoute.GET, '/api/agentics/feed?since=yesterday', 'GET')).res.status).toBe(400);
    expect((await call(feedRoute.GET, '/api/agentics/feed?after=nope', 'GET')).res.status).toBe(400);
    const missing = await call(feedRoute.GET, '/api/agentics/feed?tinId=no-such-agent', 'GET');
    expect(missing.res.status).toBe(404);
    expect(missing.json).toEqual({ ok: false, error: 'tin_not_found' });
  });

  it('answers 500 with a code and no text when the database fails', async () => {
    await newTin();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.options.failDml = () => true;
    const { res, json, raw } = await call(feedRoute.GET, '/api/agentics/feed', 'GET');
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: 'server_error' });
    expect(raw).not.toMatch(/fake db|syntax|SELECT/i);
  });

  it('lets an account ask 120 times a minute and then says to wait, with how long', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    await newTin();
    for (let i = 0; i < 120; i += 1) expect((await call(feedRoute.GET, '/api/agentics/feed', 'GET')).res.status, `request ${i + 1}`).toBe(200);
    const over = await call(feedRoute.GET, '/api/agentics/feed', 'GET');
    expect(over.res.status).toBe(429);
    expect(over.json).toEqual({ ok: false, error: 'rate_limited' });
    expect(over.res.headers.get('Retry-After')).toBe('60');
    vi.setSystemTime(new Date('2026-10-19T12:01:01Z'));
    expect((await call(feedRoute.GET, '/api/agentics/feed', 'GET')).res.status).toBe(200);
  });

  it('counts a page that polls every three seconds as 20 a minute: well inside the limit, with room for several tabs', async () => {
    const { FEED_REQUESTS_PER_WINDOW, FEED_REQUEST_WINDOW_MS } = await import('../../src/lib/agentVault/feed');
    const perTab = FEED_REQUEST_WINDOW_MS / 3000;
    expect(perTab).toBe(20);
    expect(Math.floor(FEED_REQUESTS_PER_WINDOW / perTab)).toBeGreaterThanOrEqual(5);
  });
});

describe('POST /api/agentics/feed/read', () => {
  it('says there is nothing to read for an account with no agent, and when to ask again', async () => {
    const { res, json } = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', {});
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, status: 'nothing', tinId: null, pass: null, waitMs: 300_000 });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('reads an agent that has a wallet and a trusted address, and says how each wallet went, as the button does', async () => {
    const t = await newTin();
    await store.insertWallet(OWNER_TENANT_ID, { tinId: t.id, chain: 'ethereum', address: addr(9), at: '2026-10-01 00:00:00' });
    const d = await store.insertDestination(OWNER_TENANT_ID, { tinId: t.id, chain: 'ethereum', address: addr(1), label: null, at: '2026-10-01 00:00:00' });
    if (d.kind !== 'inserted') throw new Error('setup');
    await store.recordTrust(OWNER_TENANT_ID, d.destination.id, { status: 'trusted', checkedAt: '2026-10-01 00:00:00', readout: null } as never);
    const { res, json } = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', {});
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 'read', tinId: t.id, waitMs: 30_000 });
    // No explorer key in the test, so the wallet could not be read: said plainly, and nothing was recorded.
    expect(json.pass).toMatchObject({ tinId: t.id, recorded: 0, watchedDestinations: 1 });
    expect(json.pass.wallets).toHaveLength(1);
    expect(json.pass.wallets[0].status).toBe('unavailable');
    const again = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', {});
    expect(again.json).toMatchObject({ ok: true, status: 'recent', tinId: null, pass: null });
    expect(again.json.waitMs).toBeGreaterThanOrEqual(5000);
    expect(again.json.waitMs).toBeLessThanOrEqual(45_000);
  });

  it('takes an agent id in the body, never a tenant, and refuses an agent that is not the owner\'s', async () => {
    await newTin();
    const wrong = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', { tinId: 'no-such-agent' });
    expect(wrong.res.status).toBe(404);
    expect(wrong.json).toEqual({ ok: false, error: 'tin_not_found' });
    const bad = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', { tinId: 7 });
    expect(bad.res.status).toBe(400);
    expect(bad.json).toEqual({ ok: false, error: 'invalid_id' });
    const other = await store.insertTin('someone-else', { label: 'Theirs', agentKeyId: null, at: '2026-10-01 00:00:00' });
    const theirs = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', { tinId: other.id, tenantId: 'someone-else' });
    expect(theirs.res.status).toBe(404);
  });

  it('wants a JSON object as a body', async () => {
    expect((await call(readRoute.POST, '/api/agentics/feed/read', 'POST', '{not json')).res.status).toBe(400);
    expect((await call(readRoute.POST, '/api/agentics/feed/read', 'POST', '[]')).res.status).toBe(400);
  });

  it('lets an account ask six times a minute and then says to wait', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    for (let i = 0; i < 6; i += 1) expect((await call(readRoute.POST, '/api/agentics/feed/read', 'POST', {})).res.status, `request ${i + 1}`).toBe(200);
    const over = await call(readRoute.POST, '/api/agentics/feed/read', 'POST', {});
    expect(over.res.status).toBe(429);
    expect(over.json).toEqual({ ok: false, error: 'rate_limited' });
    expect(over.res.headers.get('Retry-After')).toBe('60');
  });

  it('exports a POST and no GET, and the feed a GET and no POST', () => {
    expect(Object.keys(readRoute).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['POST']);
    expect(Object.keys(feedRoute).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(['GET']);
  });
});
