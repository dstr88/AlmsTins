import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk } from '../helpers/agentVault';
import { getPublicKeyHex } from '../../src/lib/recordProof/signing';
import { verifyBundle } from '../../src/lib/recordProof/verify';
import type { ProofBundle } from '../../src/lib/recordProof/buildProof';

/**
 * GET /api/agentics/export, called directly, with the Vault open to every account (the way slice 7
 * will open it) so that two accounts can be told apart. What matters: the file is a signed bundle
 * that verifies, or a CSV that says it is not signed; every refusal is a code and no file; the
 * account always comes from the session; the budget is for the account and is spent even by a bad
 * request; nothing is cached or sniffed. The owner-only rule for the endpoint is in routes.test.ts.
 * Every address, label and key is invented.
 */
vi.mock('../../src/lib/agenticsFlag.mjs', () => ({ AGENTICS_VAULT_PUBLIC: true }));
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const mem = vi.hoisted(() => ({ session: null as null | { tenantId: string; isDemo?: boolean } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const ROOT = path.resolve(__dirname, '../..');
const A = { tenantId: '00000000-0000-4000-8000-0000000000a1' };
const B = { tenantId: '00000000-0000-4000-8000-0000000000b2' };

let fake: ReceivablesDbFake;
let route: typeof import('../../src/pages/api/agentics/export');
let vault: typeof import('../../src/lib/agentVault/vault');
let events: typeof import('../../src/lib/agentVault/events');
let pubHex: string;

beforeAll(() => {
  process.env.ALMSTINS_SIGNING_KEY = randomBytes(32).toString('hex');
  pubHex = getPublicKeyHex() as string;
});
afterAll(() => {
  delete process.env.ALMSTINS_SIGNING_KEY;
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  mem.session = A;
  process.env.ALMSTINS_SIGNING_KEY ||= randomBytes(32).toString('hex');
  route = await import('../../src/pages/api/agentics/export');
  vault = await import('../../src/lib/agentVault/vault');
  events = await import('../../src/lib/agentVault/events');
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (day: number, h = 0, m = 0) => new Date(Date.UTC(2026, 9, day, h, m)).toISOString();

async function seed(tenant = A.tenantId, label = 'Treasury agent') {
  const tin = expectOk(await vault.createTin(tenant, { label })).tin;
  await events.insertCheckedEvent(tenant, { tinId: tin.id, address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', keyId: 'k', sourceIp: '203.0.113.9', detail: { basis: 'not_in_registry' }, at: at(2, 9) });
  await events.insertTransactionEvent(tenant, {
    tinId: tin.id, address: addr(2), chain: 'ethereum', leg: 'native:0', answer: 'unknown', status: null,
    tx: { hash: `0x${'ab'.repeat(32)}`, direction: 'in', wallet: addr(900), amount: '2', asset: 'ETH', assetContract: null, usd: 100.5, blockNumber: 9 }, detail: { reason: 'no_preceding_check' }, at: at(2, 10),
  });
  return tin;
}

async function get(query: Record<string, string>, handler: APIRoute = route.GET) {
  const url = new URL('https://almstins.com/api/agentics/export');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const request = new Request(url);
  const res = (await handler({ request, url } as never)) as Response;
  const raw = await res.text();
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* a file that is not JSON, or a plain answer */ }
  return { res, raw, body };
}
const range = (tinId: string, extra: Record<string, string> = {}) => ({ tinId, from: '2026-10-01', to: '2026-10-03', ...extra });

describe('the signed file', () => {
  it('is a JSON attachment that verifies, with the headers of a download that is never cached or sniffed', async () => {
    const tin = await seed();
    const { res, raw, body } = await get(range(tin.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-agent-ledger-2026-10-01-to-2026-10-03-[0-9a-f]{8}-proof\.json"$/);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(body.manifest).toMatchObject({ record_type: 'agent_ledger', tin_id: tin.id, tin_label: 'Treasury agent', from_day: '2026-10-01', to_day: '2026-10-03', leaf_count: 2, counts: { checked: 1, transaction: 1 } });
    expect(verifyBundle(body as ProofBundle, [{ key_id: body.signature.key_id, public_key_hex: pubHex }])).toMatchObject({ verdict: 'verified', code: 'ok' });
    expect(raw).not.toContain('203.0.113.9'); // the caller's address is not in the file
    expect(raw).not.toContain(A.tenantId);
  });

  it('is a signed bundle when the format is asked for by name', async () => {
    const tin = await seed();
    const { res, body } = await get(range(tin.id, { format: 'json' }));
    expect(res.status).toBe(200);
    expect(body.manifest.record_type).toBe('agent_ledger');
  });

  it('names its file by the range, so two ranges never overwrite one another in a downloads folder', async () => {
    const tin = await seed();
    const one = (await get(range(tin.id, { from: '2026-10-01', to: '2026-10-02' }))).res.headers.get('Content-Disposition');
    const two = (await get(range(tin.id, { from: '2026-10-02', to: '2026-10-03' }))).res.headers.get('Content-Disposition');
    expect(one).toContain('2026-10-01-to-2026-10-02');
    expect(two).toContain('2026-10-02-to-2026-10-03');
    expect(one).not.toBe(two);
  });
});

describe('the CSV copy', () => {
  it('is a text attachment whose first line says it is not signed and names the signed file it copies', async () => {
    const tin = await seed();
    const { res, raw } = await get(range(tin.id, { format: 'csv' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-agent-ledger-2026-10-01-to-2026-10-03-[0-9a-f]{8}\.csv"$/);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const lines = raw.split('\r\n');
    expect(lines[0]).toMatch(/^"UNSIGNED copy of an Almstins agent ledger export\. Match it to the signed file by bundle_id=[0-9a-f-]{36} merkle_root=[0-9a-f]{64} /);
    expect(lines[1]).toMatch(/^time_utc,kind,direction,address,/);
    expect(lines).toHaveLength(2 + 2 + 1); // notice, columns, two events, and the final line break
    expect(raw).not.toMatch(/signature_hex|Ed25519/);
  });

  it('matches the signed file made from the same ledger: the bundle id and the Merkle root in its first line are the ones in the file', async () => {
    const tin = await seed();
    const signed = (await get(range(tin.id))).body;
    vi.setSystemTime(new Date('2026-10-18T12:00:30.000Z')); // a later moment: another file, the same ledger
    const csv = (await get(range(tin.id, { format: 'csv' }))).raw;
    expect(csv).toContain(`bundle_id=${signed.manifest.record_id} `);
    expect(csv).toContain(`merkle_root=${signed.manifest.merkle_root} `);
    // And once the ledger has changed, the two no longer match: it is not a copy of that file.
    await events.insertCheckedEvent(A.tenantId, { tinId: tin.id, address: addr(7), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', keyId: 'k', sourceIp: null, detail: { basis: 'not_in_registry' }, at: at(2, 11) });
    vi.setSystemTime(new Date('2026-10-18T12:02:00.000Z'));
    const later = (await get(range(tin.id, { format: 'csv' }))).raw;
    expect(later).not.toContain(`bundle_id=${signed.manifest.record_id} `);
    expect(later).not.toContain(`merkle_root=${signed.manifest.merkle_root} `);
  });
});

describe('what is refused, as a code and no file', () => {
  const refused = (r: { res: Response; body: any }, status: number, error: string) => {
    expect(r.res.status).toBe(status);
    expect(r.body).toMatchObject({ ok: false, error });
    expect(r.res.headers.get('Content-Disposition')).toBeNull();
    expect(r.res.headers.get('Content-Type')).toBe('application/json');
    expect(r.res.headers.get('Cache-Control')).toBe('private, no-store');
  };

  it('a range that is malformed, backwards or in the future is 400 invalid_period', async () => {
    const tin = await seed();
    const queries: Array<Record<string, string>> = [
      range(tin.id, { from: 'nope' }), range(tin.id, { to: '2026-02-30' }), range(tin.id, { from: '2026-10-03', to: '2026-10-01' }), range(tin.id, { to: '2026-10-19' }),
      { tinId: tin.id }, { tinId: tin.id, from: '2026-10-01' }, { tinId: tin.id, to: '2026-10-01' },
    ];
    for (const q of queries) {
      vi.setSystemTime(new Date(Date.now() + 61_000)); // a fresh minute for each: the budget is six
      refused(await get(q), 400, 'invalid_period');
    }
  });

  it('a range of more than 366 days is 413 export_too_large, and says the most', async () => {
    const tin = await seed();
    const r = await get(range(tin.id, { from: '2025-10-17', to: '2026-10-17' }));
    expect(r.res.status).toBe(200); // 366 days exactly
    const over = await get(range(tin.id, { from: '2025-10-16', to: '2026-10-17' }));
    refused(over, 413, 'export_too_large');
    expect(over.body.max).toBe(366);
  });

  it('a format that is not json or csv is 400 invalid_format, whatever its case', async () => {
    const tin = await seed();
    for (const format of ['xml', 'CSV', 'Json', '', 'csv ', 'pdf']) {
      vi.setSystemTime(new Date(Date.now() + 61_000));
      refused(await get(range(tin.id, { format })), 400, 'invalid_format');
    }
  });

  it('an agent that is not the account\'s is 404 tin_not_found, exactly like one that does not exist', async () => {
    const mine = await seed(A.tenantId, 'Mine');
    const theirs = await seed(B.tenantId, 'Theirs');
    const foreign = await get(range(theirs.id));
    const missing = await get(range('00000000-0000-4000-8000-000000000000'));
    refused(foreign, 404, 'tin_not_found');
    refused(missing, 404, 'tin_not_found');
    expect(foreign.body).toEqual(missing.body);
    refused(await get({ ...range(''), tinId: '' }), 400, 'invalid_id');
    expect((await get(range(mine.id))).res.status).toBe(200);
  });

  it('with no signing key it is 503 signing_unavailable for both formats, and never an unsigned file', async () => {
    const tin = await seed();
    const real = process.env.ALMSTINS_SIGNING_KEY;
    delete process.env.ALMSTINS_SIGNING_KEY;
    try {
      refused(await get(range(tin.id)), 503, 'signing_unavailable');
      refused(await get(range(tin.id, { format: 'csv' })), 503, 'signing_unavailable');
    } finally {
      process.env.ALMSTINS_SIGNING_KEY = real;
    }
  });

  it('answers a code and never raw error text when something fails inside', async () => {
    const tin = await seed();
    fake.options.failDml = (sql) => /FROM agent_events/.test(sql);
    const r = await get(range(tin.id));
    expect(r.res.status).toBe(500);
    expect(r.body).toEqual({ ok: false, error: 'server_error' });
    expect(r.raw).not.toMatch(/fake db|relation|statement/i);
  });
});

describe('the account comes from the session', () => {
  it('and never from the request: a tenant in the query changes nothing, and another account\'s agent is not reachable by naming it', async () => {
    const theirs = await seed(B.tenantId, 'Theirs');
    mem.session = A;
    const r = await get({ ...range(theirs.id), tenantId: B.tenantId, tenant: B.tenantId, tenant_id: B.tenantId });
    expect(r.res.status).toBe(404);
    expect(r.raw).not.toContain('Theirs');
    mem.session = B;
    expect((await get(range(theirs.id))).res.status).toBe(200);
  });

  it('every statement the export sends names the account of the session', async () => {
    const tin = await seed();
    fake.log.length = 0;
    await get(range(tin.id));
    const sql = fake.log.filter((s) => /\bagent_(tins|events)\b/.test(s.sql) && !/^(CREATE|ALTER) /i.test(s.sql));
    expect(sql.length).toBeGreaterThan(2);
    for (const s of sql) {
      expect(s.sql, s.sql).toMatch(/\btenant_id = \?/);
      expect(s.args, s.sql).toContain(A.tenantId);
    }
  });
});

describe('the budget', () => {
  it('is six exports a minute for the account: the seventh is 429 with the seconds to wait, and a minute later it is open again', async () => {
    const tin = await seed();
    for (let i = 0; i < 6; i += 1) expect((await get(range(tin.id))).res.status, `request ${i + 1}`).toBe(200);
    const over = await get(range(tin.id));
    expect(over.res.status).toBe(429);
    expect(over.body).toEqual({ ok: false, error: 'rate_limited' });
    expect(over.res.headers.get('Retry-After')).toBe('60');
    expect(over.res.headers.get('Content-Disposition')).toBeNull();
    vi.setSystemTime(new Date('2026-10-18T12:01:01.000Z'));
    expect((await get(range(tin.id))).res.status).toBe(200);
  });

  it('is spent even by a request that is refused, so a script cannot probe for free', async () => {
    const tin = await seed();
    for (let i = 0; i < 3; i += 1) expect((await get({ tinId: tin.id, from: 'bad', to: 'bad' })).res.status).toBe(400);
    for (let i = 0; i < 3; i += 1) expect((await get(range(tin.id, { format: 'zip' }))).res.status).toBe(400);
    expect((await get(range(tin.id))).res.status).toBe(429);
  });

  it('is for each account: one account\'s exports do not use up another\'s', async () => {
    const mine = await seed(A.tenantId, 'Mine');
    const theirs = await seed(B.tenantId, 'Theirs');
    for (let i = 0; i < 7; i += 1) await get(range(mine.id));
    expect((await get(range(mine.id))).res.status).toBe(429);
    mem.session = B;
    expect((await get(range(theirs.id))).res.status).toBe(200);
  });

  it('is its own: the exports have a budget that making a report does not spend, and the reverse', () => {
    const source = readFileSync(path.join(ROOT, 'src/pages/api/agentics/export.ts'), 'utf8');
    expect(source).toMatch(/createExportRequestLimiter\(\)/);
    expect(source).not.toMatch(/createReportRequestLimiter/);
    const reports = readFileSync(path.join(ROOT, 'src/pages/api/agentics/reports.ts'), 'utf8');
    expect(reports).not.toMatch(/createExportRequestLimiter/);
  });
});

describe('the endpoint\'s own code', () => {
  const source = readFileSync(path.join(ROOT, 'src/pages/api/agentics/export.ts'), 'utf8');

  it('exports a GET and nothing else that answers, and is wrapped in the owner check', () => {
    expect([...source.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]).sort()).toEqual(['GET', 'prerender']);
    expect(source).toMatch(/^export const GET = vaultRoute\(/m);
    expect(source).toMatch(/export const prerender = false;/);
  });

  it('reads only an agent, two days and a format from the URL: never an address, never an account', () => {
    expect([...source.matchAll(/searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]).sort()).toEqual(['format', 'from', 'tinId', 'to']);
  });
});
