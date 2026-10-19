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
  // The bytes as sent: `text()` drops a leading byte-order mark, so a test that asks about one reads these.
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  const raw = await res.text();
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* a file that is not JSON, or a plain answer */ }
  return { res, raw, body, bytes };
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
  const lastColumn = (line: string) => line.slice(line.lastIndexOf(',') + 1);

  it('is a text attachment named as an unsigned copy, with the column names on its first line and the signed file named in its last column', async () => {
    const tin = await seed();
    const { res, raw, bytes } = await get(range(tin.id, { format: 'csv' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-agent-ledger-2026-10-01-to-2026-10-03-[0-9a-f]{8}-unsigned-copy\.csv"$/);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // A byte-order mark (so a spreadsheet reads it as UTF-8), then the header: no line of prose in front of it.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.startsWith('time_utc,kind,direction,address,')).toBe(true);
    const lines = raw.split('\r\n');
    expect(lines).toHaveLength(1 + 2 + 1); // the column names, two events, and the final line break
    expect(lines[0]).toMatch(/,unsigned_copy_of_bundle_id$/);
    for (const line of lines.slice(1, 3)) expect(lastColumn(line)).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw).not.toMatch(/UNSIGNED copy of|signature_hex|Ed25519/);
    expect(raw).not.toMatch(/basis_or_reason/);
  });

  it('matches the signed file made from the same ledger: the last column of every line is the id of the file', async () => {
    const tin = await seed();
    const signed = (await get(range(tin.id))).body;
    vi.setSystemTime(new Date('2026-10-18T12:00:30.000Z')); // a later moment: another file, the same ledger
    const csv = (await get(range(tin.id, { format: 'csv' }))).raw;
    const ids = (text: string) => new Set(text.split('\r\n').slice(1).filter(Boolean).map(lastColumn));
    expect(ids(csv)).toEqual(new Set([signed.manifest.record_id]));
    // And once the ledger has changed, the two no longer match: it is not a copy of that file.
    await events.insertCheckedEvent(A.tenantId, { tinId: tin.id, address: addr(7), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', keyId: 'k', sourceIp: null, detail: { basis: 'not_in_registry' }, at: at(2, 11) });
    vi.setSystemTime(new Date('2026-10-18T12:02:00.000Z'));
    const later = (await get(range(tin.id, { format: 'csv' }))).raw;
    expect(ids(later).has(signed.manifest.record_id)).toBe(false);
    expect(ids(later).size).toBe(1);
  });
});

describe('part of a day', () => {
  it('takes a UTC minute at either end: the file covers exactly that, and the manifest says so', async () => {
    const tin = await seed(); // a check at 09:00 on 2 October and a transfer at 10:00
    const r = await get(range(tin.id, { from: '2026-10-02T09:00', to: '2026-10-02T09:59' }));
    expect(r.res.status).toBe(200);
    expect(r.body.manifest).toMatchObject({ period: '2026-10-02 09:00 to 2026-10-02 09:59 UTC', period_start: '2026-10-02T09:00:00.000Z', period_end: '2026-10-02T10:00:00.000Z', leaf_count: 1 });
    expect(r.res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-agent-ledger-2026-10-02-to-2026-10-02-[0-9a-f]{8}-proof\.json"$/);
    const next = await get(range(tin.id, { from: '2026-10-02T10:00', to: '2026-10-02T10:59' }));
    expect(next.body.manifest.leaf_count).toBe(1);
    expect(next.body.leaves[0].kind).toBe('transaction');
    // And the CSV copy of a part is a copy of that part.
    const csv = await get(range(tin.id, { from: '2026-10-02T09:00', to: '2026-10-02T09:59', format: 'csv' }));
    expect(csv.res.status).toBe(200);
    expect(csv.raw.split('\r\n')).toHaveLength(1 + 1 + 1);
  });

  it('refuses a minute that is not a real one and a start at or after the end, as invalid_period', async () => {
    const tin = await seed();
    for (const q of [
      range(tin.id, { from: '2026-10-02T24:00' }), range(tin.id, { from: '2026-10-02T09:00:00' }), range(tin.id, { to: '2026-10-02T9:5' }),
      range(tin.id, { from: '2026-10-02T10:00', to: '2026-10-02T09:59' }),
    ]) {
      vi.setSystemTime(new Date(Date.now() + 61_000)); // a fresh minute for each: the budget is six
      const r = await get(q);
      expect(r.res.status, JSON.stringify(q)).toBe(400);
      expect(r.body).toEqual({ ok: false, error: 'invalid_period' });
    }
  });

  it('refuses a minute that has not begun yet, by the clock the server keeps', async () => {
    const tin = await seed(); // it is 12:00:00 on 18 October
    for (const to of ['2026-10-18T12:01', '2026-10-19T00:00']) {
      const r = await get(range(tin.id, { from: '2026-10-18T06:00', to }));
      expect(r.res.status, to).toBe(400);
      expect(r.body).toEqual({ ok: false, error: 'invalid_period' });
    }
  });

  it('refuses a range that starts ahead of the clock, even when it ends on a whole day that has begun', async () => {
    const tin = await seed();
    const r = await get(range(tin.id, { from: '2026-10-18T23:00', to: '2026-10-18' }));
    expect(r.res.status).toBe(400);
    expect(r.body).toEqual({ ok: false, error: 'invalid_period' });
  });

  it('allows the minute that has begun: at 12:00 the last minute can be 12:00, and the file says it was made before it ended', async () => {
    const tin = await seed();
    const r = await get(range(tin.id, { from: '2026-10-18T06:00', to: '2026-10-18T12:00' }));
    expect(r.res.status).toBe(200);
    expect(r.body.manifest).toMatchObject({ partial: true, period_end: '2026-10-18T12:01:00.000Z' });
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

describe('one export at a time', () => {
  /** Holds the first count of events mid-request, so an export is "being made" until the test lets it go. */
  function holdFirstExport() {
    const real = holder.db;
    let letGo!: () => void;
    const hold = new Promise<void>((resolve) => { letGo = resolve; });
    let reached!: () => void;
    const started = new Promise<void>((resolve) => { reached = resolve; });
    let held = false;
    holder.db = {
      execute: async (s: any) => {
        const sql = typeof s === 'string' ? s : s.sql;
        if (!held && /SELECT COUNT\(\*\)/.test(sql) && /agent_events/.test(sql)) {
          held = true;
          reached();
          await hold;
        }
        return real.execute(s);
      },
      batch: (s: any, m?: any) => real.batch(s, m),
    };
    return { started, letGo, restore: () => { holder.db = real; } };
  }

  it('turns away a second export while one is being made, for the same account and for another, and is open again when it is done', async () => {
    const mine = await seed(A.tenantId, 'Mine');
    const theirs = await seed(B.tenantId, 'Theirs');
    const held = holdFirstExport();
    mem.session = A;
    const first = get(range(mine.id));
    await held.started;
    const again = await get(range(mine.id));
    expect(again.res.status).toBe(429);
    expect(again.body).toEqual({ ok: false, error: 'export_busy' });
    expect(again.res.headers.get('Retry-After')).toBe('10'); // seconds, not the minute of the budget
    expect(again.res.headers.get('Content-Disposition')).toBeNull();
    expect(again.res.headers.get('Cache-Control')).toBe('private, no-store');
    mem.session = B;
    const other = await get(range(theirs.id)); // the server makes one at a time, whoever asks
    expect(other.res.status).toBe(429);
    expect(other.body).toEqual({ ok: false, error: 'export_busy' });
    held.letGo();
    expect((await first).res.status).toBe(200);
    held.restore();
    mem.session = B;
    expect((await get(range(theirs.id))).res.status).toBe(200);
    mem.session = A;
    expect((await get(range(mine.id))).res.status).toBe(200);
  });

  it('gives its place back when the export is refused or fails, so one bad request does not close the door', async () => {
    const tin = await seed();
    expect((await get(range('00000000-0000-4000-8000-000000000000'))).res.status).toBe(404); // refused after the place was taken
    expect((await get(range(tin.id))).res.status).toBe(200);
    const real = holder.db;
    let broke = false;
    holder.db = {
      execute: async (s: any) => {
        const sql = typeof s === 'string' ? s : s.sql;
        if (!broke && /SELECT COUNT\(\*\)/.test(sql) && /agent_events/.test(sql)) { broke = true; throw new Error('the database went away'); }
        return real.execute(s);
      },
      batch: (s: any, m?: any) => real.batch(s, m),
    };
    expect((await get(range(tin.id))).res.status).toBe(500); // a failure in the middle of it
    holder.db = real;
    expect((await get(range(tin.id))).res.status).toBe(200);
  });

  it('is counted after the budget, so a turned-away request has spent a request of the minute', async () => {
    const tin = await seed();
    const held = holdFirstExport();
    const first = get(range(tin.id));
    await held.started;
    for (let i = 0; i < 5; i += 1) expect((await get(range(tin.id))).body.error, `request ${i + 2}`).toBe('export_busy');
    expect((await get(range(tin.id))).body.error).toBe('rate_limited'); // the seventh, whatever the answer would have been
    held.letGo();
    await first;
    held.restore();
  });
});

describe('the endpoint\'s own code', () => {
  const source = readFileSync(path.join(ROOT, 'src/pages/api/agentics/export.ts'), 'utf8');

  it('exports a GET and nothing else that answers, and is wrapped in the owner check', () => {
    expect([...source.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]).sort()).toEqual(['GET', 'prerender']);
    expect(source).toMatch(/^export const GET = vaultRoute\(/m);
    // The place for an export is taken before anything is read and given back in a finally, however the export ends.
    expect(source).toMatch(/const gate = createExportGate\(\);/);
    expect(source).toMatch(/const release = gate\.enter\(tenantId\);[\s\S]*try \{[\s\S]*\} finally \{\s*release\(\);\s*\}/);
    expect(source).toMatch(/export const prerender = false;/);
  });

  it('reads only an agent, two days and a format from the URL: never an address, never an account', () => {
    expect([...source.matchAll(/searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]).sort()).toEqual(['format', 'from', 'tinId', 'to']);
  });
});
