import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk } from '../helpers/agentVault';
import { getPublicKeyHex } from '../../src/lib/recordProof/signing';
import { verifyBundle } from '../../src/lib/recordProof/verify';
import type { ProofBundle } from '../../src/lib/recordProof/buildProof';
import { proveRecordInclusion, verifyRecordInclusion } from '../../src/lib/rwaProof/recordSet';
import type { LedgerEvent } from '../../src/lib/agentVault/events';

/**
 * The signed export of one agent's ledger, end to end: the canonical record of each event, the range
 * rules, the signed bundle that every verifier reads (the in-app one, the public API's and the
 * offline script), the proof that any one event is in the file, every way of tampering with it, and
 * the CSV copy that is not signed. Over the in-memory stand-in for the database. Every address, key,
 * tenant and amount is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const ROOT = path.resolve(__dirname, '../..');
const A = 'tenant-a';
const B = 'tenant-b';
const NOW = new Date('2026-10-18T12:00:00.000Z');
const HASH = (n: number) => `0x${String(n).padStart(2, '0').repeat(32)}`.slice(0, 66);
const at = (day: number, h = 0, m = 0, s = 0, ms = 0) => new Date(Date.UTC(2026, 9, day, h, m, s, ms)).toISOString();

let fake: ReceivablesDbFake;
let vault: typeof import('../../src/lib/agentVault/vault');
let events: typeof import('../../src/lib/agentVault/events');
let ex: typeof import('../../src/lib/agentVault/ledgerExport');
let pubHex: string;

beforeAll(() => {
  process.env.ALMSTINS_SIGNING_KEY = randomBytes(32).toString('hex');
  pubHex = getPublicKeyHex() as string;
});
afterAll(() => {
  delete process.env.ALMSTINS_SIGNING_KEY;
  delete process.env.ALMSTINS_SIGNING_PUBKEY;
});

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  process.env.ALMSTINS_SIGNING_KEY ||= randomBytes(32).toString('hex');
  delete process.env.ALMSTINS_SIGNING_PUBKEY;
  vault = await import('../../src/lib/agentVault/vault');
  events = await import('../../src/lib/agentVault/events');
  ex = await import('../../src/lib/agentVault/ledgerExport');
});

const deps = (now = NOW, id = '00000000-0000-4000-8000-0000000000ee') => ({ now: () => now, newId: () => id });
const newTin = async (tenant = A, label = 'Treasury agent') => expectOk(await vault.createTin(tenant, { label })).tin;
const check = (tenant: string, tinId: string, n: number, when: string, answer: 'proven' | 'unknown' | 'flagged' = 'unknown', basis = 'not_in_registry', registry: 'trusted' | 'flagged' | 'pending' | 'none' = 'none') =>
  events.insertCheckedEvent(tenant, { tinId, address: addr(n), chain: registry === 'none' ? null : 'ethereum', answer, registry, status: 'unknown', keyId: 'k1', sourceIp: '203.0.113.9', detail: { basis, cleared: false, domain: 'ops.example.test' }, at: when });
const transfer = (tenant: string, tinId: string, n: number, when: string, direction: 'in' | 'out', usd: number | null, extra: Partial<{ asset: string; amount: string; detail: Record<string, unknown>; answer: 'proven' | 'unknown' }> = {}) =>
  events.insertTransactionEvent(tenant, {
    tinId, address: addr(n), chain: 'ethereum', leg: `native:${n}`, answer: extra.answer ?? 'unknown', status: null,
    tx: { hash: HASH(n), direction, wallet: addr(900), amount: extra.amount ?? '1.5', asset: extra.asset ?? 'ETH', assetContract: null, usd, blockNumber: 100 + n },
    detail: extra.detail ?? { reason: 'no_preceding_check', leg: `native:${n}`, walletId: 'w', destinationId: 'd' }, at: when,
  });

/** A small ledger on three days: checks, transfers, one unpriced, one flagged. */
async function seed() {
  const tin = await newTin();
  await check(A, tin.id, 1, at(1, 8), 'proven', 'domain_proof', 'trusted');
  await check(A, tin.id, 2, at(1, 9), 'flagged', 'registry_flagged', 'flagged');
  await check(A, tin.id, 3, at(2, 10), 'unknown', 'not_in_registry');
  await transfer(A, tin.id, 1, at(2, 11), 'in', 1270.559871, { answer: 'proven', detail: { leg: 'native:1', link: { eventId: '11111111-1111-4111-8111-111111111111', at: at(1, 8), gapMs: 5, keyId: 'k1' } } });
  await transfer(A, tin.id, 4, at(3, 12), 'out', null, { asset: 'ODD', amount: '1000' });
  await transfer(A, tin.id, 5, at(3, 13), 'out', 0, { detail: { reason: 'ambiguous_checks', leg: 'native:5' } });
  return tin;
}
const exportOf = async (tin: { id: string }, from = '2026-10-01', to = '2026-10-03', d: { now: () => Date; newId?: () => string } = deps()) =>
  expectOk(await ex.exportLedger(A, tin.id, from, to, d)).bundle;

describe('the canonical record of an event', () => {
  const base: LedgerEvent = {
    id: '00000000-0000-4000-8000-000000000001', tinId: 'tin-1', kind: 'checked', at: at(1, 8, 0, 0, 123), address: addr(1), chain: 'ethereum', answer: 'flagged', registry: 'flagged',
    status: 'mismatch', keyId: 'k1', sourceIp: '203.0.113.9', tx: null, detail: { basis: 'registry_flagged', cleared: false, domain: 'ops.example.test' },
  };
  const move = (over: Partial<LedgerEvent> = {}): LedgerEvent => ({
    ...base, id: '00000000-0000-4000-8000-000000000002', kind: 'transaction', answer: 'unknown', registry: 'trusted', status: null, keyId: null, sourceIp: null,
    tx: { hash: HASH(7), direction: 'out', wallet: addr(900), amount: '12.5', asset: 'POL', assetContract: '0xdac17f958d2ee523a2206206994597c13d831ec7', usd: 9.75, blockNumber: 5 },
    detail: { reason: 'no_preceding_check', leg: 'native:0' }, ...over,
  });

  it('a check is one fixed-field record with only the values a reader needs', () => {
    expect(ex.leafOf(base)).toEqual({
      v: 1, kind: 'checked', date: at(1, 8, 0, 0, 123), event_id: base.id, address: addr(1), chain: 'ethereum', answer: 'flagged', registry: 'flagged', basis: 'registry_flagged', key_id: 'k1',
    });
  });

  it('leaves out the caller\'s address, the public status and the free text of what was answered, and files an unknown reason as `other`', () => {
    const leaf = JSON.stringify(ex.leafOf(base));
    expect(leaf).not.toMatch(/203\.0\.113\.9|sourceIp|status|ops\.example\.test|cleared|mismatch/);
    expect(ex.leafOf({ ...base, detail: { basis: '<img src=x onerror=alert(1)>' } })).toMatchObject({ basis: 'other' });
    expect(ex.leafOf({ ...base, detail: null })).toMatchObject({ basis: 'other' });
  });

  it('a transfer is one fixed-field record: the exact amount, the USD to the micro-dollar as a string, the block and the check it took its status from', () => {
    const linked = '11111111-1111-4111-8111-111111111111';
    expect(ex.leafOf(move({ detail: { link: { eventId: linked }, leg: 'x' } }))).toEqual({
      v: 1, kind: 'transaction', date: base.at, event_id: '00000000-0000-4000-8000-000000000002', address: addr(1), chain: 'ethereum', answer: 'unknown', registry: 'trusted',
      reason: null, linked_check: linked, tx_hash: HASH(7), direction: 'out', wallet: addr(900), amount: '12.5', asset: 'POL',
      asset_contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', usd: '9.75', block_number: 5,
    });
  });

  it('writes a price as a decimal string, never as a float, and an unpriced transfer as null, never as zero', () => {
    const usd = (value: number | null) => (ex.leafOf(move({ tx: { ...move().tx!, usd: value } })) as { usd: string | null }).usd;
    expect(usd(1270.559871)).toBe('1270.559871');
    expect(usd(1270.5598714)).toBe('1270.559871');
    expect(usd(0.1 + 0.2)).toBe('0.3');
    expect(usd(31250.5)).toBe('31250.5');
    expect(usd(0)).toBe('0');
    expect(usd(null)).toBeNull();
    expect(usd(Number.NaN)).toBeNull();
  });

  it('knows two reasons for having no check behind a transfer, and a link only when it names an event', () => {
    const leaf = (detail: Record<string, unknown> | null) => ex.leafOf(move({ detail })) as { reason: string | null; linked_check: string | null };
    expect(leaf({ reason: 'ambiguous_checks' }).reason).toBe('ambiguous_checks');
    expect(leaf({ reason: 'no_preceding_check' }).reason).toBe('no_preceding_check');
    for (const odd of ['because', 7, null, 'constructor', '<b>']) expect(leaf({ reason: odd }).reason, String(odd)).toBeNull();
    for (const odd of ['not-an-id', 7, null, '11111111-1111-4111-8111-11111111111G', '../../etc']) expect(leaf({ link: { eventId: odd } }).linked_check, String(odd)).toBeNull();
    expect(leaf({ link: 'x' }).linked_check).toBeNull();
    expect(leaf(null)).toMatchObject({ reason: null, linked_check: null });
  });

  it('carries the chain\'s own text as it came (the symbol is escaped by the JSON, not rewritten)', () => {
    const leaf = ex.leafOf(move({ tx: { ...move().tx!, asset: '"><script>alert(1)</script>' } })) as { asset: string };
    expect(leaf.asset).toBe('"><script>alert(1)</script>');
  });

  it('is nothing for a transfer without its facts and for a kind it does not carry', () => {
    expect(ex.leafOf(move({ tx: null }))).toBeNull();
    expect(ex.leafOf({ ...base, kind: 'other' as never })).toBeNull();
  });
});

describe('the range', () => {
  const today = '2026-10-18';
  const range = (from: unknown, to: unknown) => ex.parseExportRange(from, to, today);

  it('takes one day, a month and a year, both ends counted', () => {
    expect(range('2026-10-18', '2026-10-18')).toEqual({ ok: true, from: '2026-10-18', to: '2026-10-18', days: 1 });
    expect(range('2026-10-01', '2026-10-18')).toMatchObject({ ok: true, days: 18 });
    expect(range('2025-10-18', '2026-10-17')).toMatchObject({ ok: true, days: 365 });
  });

  it('allows 366 days and refuses 367, through a leap year too', () => {
    expect(ex.MAX_EXPORT_DAYS).toBe(366);
    expect(ex.parseExportRange('2027-01-01', '2028-01-01', '2028-06-01')).toMatchObject({ ok: true, days: 366 });
    expect(ex.parseExportRange('2027-01-01', '2028-01-02', '2028-06-01')).toEqual({ ok: false, error: 'export_too_large', max: 366 });
    expect(ex.parseExportRange('2028-01-01', '2028-12-31', '2029-01-01')).toMatchObject({ ok: true, days: 366 });
    expect(ex.parseExportRange('2027-01-01', '2027-12-31', '2028-01-01')).toMatchObject({ ok: true, days: 365 });
    expect(range('2025-10-17', '2026-10-17')).toMatchObject({ ok: true, days: 366 });
    expect(range('2025-10-16', '2026-10-17')).toEqual({ ok: false, error: 'export_too_large', max: 366 });
  });

  it('refuses a day that is not a real date, a start after the end, and an end that has not begun', () => {
    for (const [from, to] of [
      ['2026-02-30', '2026-03-01'], ['2026-10-01', '2026-13-01'], ['2026-1-1', '2026-10-01'], ['', '2026-10-01'], [null, '2026-10-01'], [undefined, undefined], [7, 8],
      ['2026-10-01T00:00:00Z', '2026-10-02'], ['2026-10-02', '2026-10-01'], ['2026-10-18', '2026-10-19'], ['2026-10-19', '2026-10-19'], ['  2026-10-01', '2026-10-02'], ['2026-10-01', '2026-10-02 '],
    ] as const) {
      expect(range(from, to), `${String(from)} ${String(to)}`).toEqual({ ok: false, error: 'invalid_period' });
    }
  });

  it('caps the events a file holds at 50,000', () => {
    expect(ex.MAX_EXPORT_EVENTS).toBe(50_000);
  });
});

describe('the signed bundle', () => {
  it('has a manifest with the agent, the range, the counts, the time, the root and the key, and no address', async () => {
    const tin = await seed();
    const b = await exportOf(tin);
    const m = b.manifest;
    expect(m).toMatchObject({
      v: 1, record_id: '00000000-0000-4000-8000-0000000000ee', record_type: 'agent_ledger', period: '2026-10-01 to 2026-10-03', from_day: '2026-10-01', to_day: '2026-10-03',
      period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-10-04T00:00:00.000Z', partial: false, tin_id: tin.id, tin_label: 'Treasury agent', data_source: 'ledger',
      leaf_count: 6, counts: { checked: 3, transaction: 3 }, prev_root: null, generated_at: '2026-10-18T12:00:00.000Z', schema_version: '1', tree_algo: 'sha256-merkle-v1',
    });
    expect(m.signing_key_id).toBe(b.signature?.key_id);
    expect(m.merkle_root).toMatch(/^[0-9a-f]{64}$/);
    expect(m.tenant_scope_tag).toMatch(/^tst-[0-9a-f]{24}$/);
    const text = JSON.stringify(m);
    expect(text).not.toContain(A);
    expect(text).not.toMatch(/0xc0ffee/);
    expect(b.proof_format).toBe('almstins-merkle-v1');
    expect(b.leaf_hashes).toHaveLength(6);
  });

  it('verifies with the in-app verifier, the way the public page and API check it', async () => {
    const b = await exportOf(await seed());
    const outcome = ex.verifyLedgerBundle(b);
    expect(outcome).toMatchObject({ verdict: 'verified', code: 'ok' });
    expect(outcome.checks).toEqual({ root_recomputed: true, leaf_count_match: true, signature_valid: true, key_published: true });
    expect(verifyBundle(b as unknown as ProofBundle, [{ key_id: b.signature!.key_id, public_key_hex: pubHex }])).toMatchObject({ verdict: 'verified' });
  });

  it('verifies with the public API (POST /api/verify-record), which reads the bundle and never echoes its leaves', async () => {
    const b = await exportOf(await seed());
    const { POST } = await import('../../src/pages/api/verify-record');
    const res = (await (POST as any)({ request: new Request('https://almstins.com/api/verify-record', { method: 'POST', body: JSON.stringify(b) }) })) as Response;
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.outcome).toMatchObject({ verdict: 'verified', code: 'ok' });
    expect(body.manifest.record_type).toBe('agent_ledger');
    expect(JSON.stringify(body)).not.toContain(addr(1));
  });

  it('verifies with the offline script, which needs no network and no account: VERIFIED, and it names the kind and the range', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'almstins-ledger-'));
    const b = await exportOf(await seed());
    const file = join(dir, 'good.json');
    writeFileSync(file, ex.serializeBundle(b));
    const out = execFileSync('node', ['scripts/verify-record.mjs', file, '--pubkey', pubHex], { encoding: 'utf8', cwd: ROOT });
    expect(out).toContain('VERIFIED');
    expect(out).toContain('2026-10-01 to 2026-10-03 agent_ledger');
    expect(out).toContain('6 entries');
    expect(out).toContain(b.manifest.merkle_root);
  });

  it('the offline script says TAMPERED, and exits with 1, for a changed amount, a changed address and a removed event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'almstins-ledger-'));
    const b = await exportOf(await seed());
    const run = (bundle: unknown, name: string) => {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(bundle));
      try {
        execFileSync('node', ['scripts/verify-record.mjs', file, '--pubkey', pubHex], { encoding: 'utf8', cwd: ROOT, stdio: 'pipe' });
        return { code: 0, text: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status, text: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    };
    const i = b.leaves.findIndex((l) => l.kind === 'transaction');
    const changedAmount = { ...b, leaves: b.leaves.map((l, k) => (k === i ? { ...l, amount: '999' } : l)) };
    const changedAddress = { ...b, leaves: b.leaves.map((l, k) => (k === 0 ? { ...l, address: addr(77) } : l)) };
    const removed = { ...b, leaves: b.leaves.slice(1) };
    for (const [name, bundle] of [['amount', changedAmount], ['address', changedAddress], ['removed', removed]] as const) {
      const r = run(bundle, name);
      expect(r.code, name).toBe(1);
      expect(r.text, name).toContain('TAMPERED');
    }
  });

  it('is permutation-stable: events given in any order make the same root and the same file', async () => {
    const tin = await seed();
    const b = await exportOf(tin);
    const input = b.leaves.slice().reverse();
    for (const order of [input, input.slice(2).concat(input.slice(0, 2)), b.leaves]) {
      const again = ex.buildLedgerBundle({ tenantId: A, tin: { id: tin.id, label: 'Treasury agent' }, range: { from: '2026-10-01', to: '2026-10-03' }, partial: false, generatedAt: '2026-10-18T12:00:00.000Z', recordId: b.manifest.record_id, leaves: order });
      expect(again.manifest.merkle_root).toBe(b.manifest.merkle_root);
      expect(again.leaf_hashes).toEqual(b.leaf_hashes);
      expect(again.leaves).toEqual(b.leaves);
    }
  });

  it('lists the events in time order, with checks before transfers that share a moment', async () => {
    const tin = await newTin();
    await transfer(A, tin.id, 1, at(1, 8), 'in', 1);
    await check(A, tin.id, 2, at(1, 8));
    await check(A, tin.id, 3, at(1, 7));
    const b = await exportOf(tin, '2026-10-01', '2026-10-01');
    expect(b.leaves.map((l) => [l.date.slice(11, 13), l.kind])).toEqual([['07', 'checked'], ['08', 'checked'], ['08', 'transaction']]);
  });

  it('an export of a quiet range is a signed statement that nothing was recorded: no events, a root that still verifies', async () => {
    const tin = await newTin();
    const b = await exportOf(tin, '2026-10-01', '2026-10-03');
    expect(b.leaves).toEqual([]);
    expect(b.manifest).toMatchObject({ leaf_count: 0, counts: { checked: 0, transaction: 0 } });
    expect(ex.verifyLedgerBundle(b)).toMatchObject({ verdict: 'verified' });
    const dir = mkdtempSync(join(tmpdir(), 'almstins-ledger-'));
    const file = join(dir, 'empty.json');
    writeFileSync(file, ex.serializeBundle(b));
    expect(execFileSync('node', ['scripts/verify-record.mjs', file, '--pubkey', pubHex], { encoding: 'utf8', cwd: ROOT })).toContain('VERIFIED');
  });

  it('a large ledger builds and verifies: 5,000 events', () => {
    const leaves = Array.from({ length: 5_000 }, (_, i) =>
      ex.leafOf({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tinId: 't', kind: 'checked', at: new Date(Date.UTC(2026, 9, 1, 0, 0, 0, i)).toISOString(), address: addr(i), chain: null, answer: 'unknown',
        registry: 'none', status: null, keyId: 'k', sourceIp: null, tx: null, detail: { basis: 'not_in_registry' },
      })!,
    );
    const started = Date.now();
    const b = ex.buildLedgerBundle({ tenantId: A, tin: { id: 't', label: 'x' }, range: { from: '2026-10-01', to: '2026-10-01' }, partial: false, generatedAt: '2026-10-18T12:00:00.000Z', recordId: '00000000-0000-4000-8000-0000000000ee', leaves });
    expect(ex.verifyLedgerBundle(b).verdict).toBe('verified');
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(ex.serializeBundle(b)).not.toMatch(/\n {2}"/); // compact once large
  });
});

describe('any single event is individually provable', () => {
  it('each event\'s inclusion proves against the signed root, with an odd and an even number of events, and a changed event does not', async () => {
    for (const n of [1, 2, 3, 5, 6, 8]) {
      const tenant = `tenant-proof-${n}`; // a tenant for each size: the free plan covers three agents
      const tin = await newTin(tenant, `Agent ${n}`);
      for (let i = 0; i < n; i += 1) await check(tenant, tin.id, 100 + i, at(1, 8, i));
      const b = expectOk(await ex.exportLedger(tenant, tin.id, '2026-10-01', '2026-10-01', deps())).bundle;
      expect(b.leaves).toHaveLength(n);
      for (let i = 0; i < n; i += 1) {
        const proof = proveRecordInclusion(b.leaves, i);
        expect(verifyRecordInclusion(b.leaves[i], proof, b.manifest.merkle_root), `n=${n} i=${i}`).toBe(true);
        expect(verifyRecordInclusion({ ...b.leaves[i], address: addr(999) }, proof, b.manifest.merkle_root), `n=${n} i=${i} changed`).toBe(false);
        // A proof for one event does not prove another.
        if (n > 1) expect(verifyRecordInclusion(b.leaves[(i + 1) % n], proof, b.manifest.merkle_root)).toBe(false);
      }
    }
  });
});

describe('what the signature covers', () => {
  const tamper = (b: any, edit: (c: any) => void) => {
    const c = JSON.parse(JSON.stringify(b));
    edit(c);
    return ex.verifyLedgerBundle(c);
  };

  it('every field of every event: change any one and the root no longer matches', async () => {
    const b = await exportOf(await seed());
    for (const [i, leaf] of b.leaves.entries()) {
      for (const key of Object.keys(leaf)) {
        const outcome = tamper(b, (c) => {
          const v = c.leaves[i][key];
          c.leaves[i][key] = typeof v === 'number' ? v + 1 : v === null ? 'x' : `${v}x`;
        });
        expect(outcome, `leaf ${i} ${key}`).toMatchObject({ verdict: 'tampered', code: 'root_mismatch' });
      }
    }
  });

  it('an event removed, added or replaced', async () => {
    const b = await exportOf(await seed());
    expect(tamper(b, (c) => c.leaves.pop())).toMatchObject({ verdict: 'tampered' });
    expect(tamper(b, (c) => c.leaves.push({ ...c.leaves[0], event_id: '00000000-0000-4000-8000-00000000dead' }))).toMatchObject({ verdict: 'tampered' });
    expect(tamper(b, (c) => (c.leaves[2] = c.leaves[3]))).toMatchObject({ verdict: 'tampered' });
  });

  it('every signed field of the manifest: the agent, the range, the counts, the time, the root, the key and the count of events', async () => {
    const b = await exportOf(await seed());
    const edits: Array<[string, (m: any) => void]> = [
      ['tin_id', (m) => (m.tin_id = 'other-agent')], ['tin_label', (m) => (m.tin_label = 'Another agent')], ['from_day', (m) => (m.from_day = '2026-09-01')], ['to_day', (m) => (m.to_day = '2026-10-04')],
      ['period', (m) => (m.period = '2026-09-01 to 2026-10-03')], ['period_start', (m) => (m.period_start = '2026-09-01T00:00:00.000Z')], ['period_end', (m) => (m.period_end = '2026-10-05T00:00:00.000Z')],
      ['partial', (m) => (m.partial = true)], ['counts', (m) => (m.counts = { checked: 4, transaction: 2 })], ['generated_at', (m) => (m.generated_at = '2026-10-19T00:00:00.000Z')],
      ['record_id', (m) => (m.record_id = '00000000-0000-4000-8000-0000000000ff')], ['tenant_scope_tag', (m) => (m.tenant_scope_tag = 'tst-000000000000000000000000')],
      ['record_type', (m) => (m.record_type = 'agent_report')], ['prev_root', (m) => (m.prev_root = 'a'.repeat(64))], ['schema_version', (m) => (m.schema_version = '2')],
      ['data_source', (m) => (m.data_source = 'pipeline')], ['tree_algo', (m) => (m.tree_algo = 'other')],
    ];
    for (const [name, edit] of edits) {
      const outcome = tamper(b, (c) => edit(c.manifest));
      expect(outcome.verdict, name).toBe('tampered');
      expect(outcome.code, name).toBe('bad_signature');
    }
    expect(tamper(b, (c) => (c.manifest.merkle_root = 'a'.repeat(64)))).toMatchObject({ verdict: 'tampered', code: 'root_mismatch' });
    expect(tamper(b, (c) => (c.manifest.leaf_count = 5))).toMatchObject({ verdict: 'tampered' });
    expect(tamper(b, (c) => (c.manifest.signing_key_id = 'almstins-0000000000000000'))).toMatchObject({ verdict: 'tampered', code: 'bad_signature' });
  });

  it('not the presentational fields (the page it links to and the disclaimer), which no verifier signs', async () => {
    const b = await exportOf(await seed());
    expect(tamper(b, (c) => (c.manifest.verify_url = 'https://example.test/')).verdict).toBe('verified');
    expect(tamper(b, (c) => (c.manifest.disclaimer = 'changed')).verdict).toBe('verified');
  });

  it('a signature under a key Almstins does not publish is intact but its origin is not confirmed', async () => {
    const b = await exportOf(await seed());
    const outcome = tamper(b, (c) => (c.signature.key_id = 'almstins-0000000000000000'));
    expect(outcome).toMatchObject({ verdict: 'unverifiable', code: 'unknown_key' });
  });

  it('an unsigned file reads as unsigned, never as verified', async () => {
    const tin = await seed();
    const real = process.env.ALMSTINS_SIGNING_KEY;
    delete process.env.ALMSTINS_SIGNING_KEY;
    try {
      const b = ex.buildLedgerBundle({ tenantId: A, tin: { id: tin.id, label: 'x' }, range: { from: '2026-10-01', to: '2026-10-03' }, partial: false, generatedAt: '2026-10-18T12:00:00.000Z', recordId: 'r', leaves: [] });
      expect(b.signature).toBeNull();
      expect(b.manifest.signing_key_id).toBeNull();
      expect(ex.verifyLedgerBundle(b)).toMatchObject({ verdict: 'unverifiable', code: 'unsigned' });
    } finally {
      process.env.ALMSTINS_SIGNING_KEY = real;
    }
  });
});

describe('making an export from the ledger', () => {
  it('holds the events of both end days and nothing outside them: the first moment of the first day is in, the first moment after the last day is out', async () => {
    const tin = await newTin();
    await check(A, tin.id, 1, at(1, 0, 0, 0, 0)); // the first moment of the range
    await check(A, tin.id, 2, at(3, 23, 59, 59, 999)); // the last moment of the range
    await check(A, tin.id, 3, at(4, 0, 0, 0, 0)); // the first moment after it
    await check(A, tin.id, 4, at(0, 23, 59, 59, 999)); // the last moment before it (Sept 30 as day 0 of October)
    const b = await exportOf(tin, '2026-10-01', '2026-10-03');
    expect(b.leaves.map((l) => l.address)).toEqual([addr(1), addr(2)]);
    expect(b.manifest.period_start).toBe('2026-10-01T00:00:00.000Z');
    expect(b.manifest.period_end).toBe('2026-10-04T00:00:00.000Z');
  });

  it('holds this agent\'s events and no other\'s: not another agent of the account, not another account\'s', async () => {
    const mine = await newTin(A, 'Mine');
    const other = await newTin(A, 'Other');
    const theirs = await newTin(B, 'Theirs');
    await check(A, mine.id, 1, at(2, 8));
    await check(A, other.id, 2, at(2, 9));
    await check(B, theirs.id, 3, at(2, 10));
    const b = await exportOf(mine);
    expect(b.leaves.map((l) => l.address)).toEqual([addr(1)]);
    expect(JSON.stringify(b)).not.toContain(addr(2));
    expect(JSON.stringify(b)).not.toContain(addr(3));
  });

  it('an agent that is not this account\'s is exactly an agent that does not exist, and nothing of it is read', async () => {
    const theirs = await newTin(B, 'Theirs');
    await check(B, theirs.id, 3, at(2, 10));
    fake.log.length = 0;
    expect(await ex.exportLedger(A, theirs.id, '2026-10-01', '2026-10-03', deps())).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await ex.exportLedger(A, '00000000-0000-4000-8000-000000000000', '2026-10-01', '2026-10-03', deps())).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await ex.exportLedger(A, '', '2026-10-01', '2026-10-03', deps())).toEqual({ ok: false, error: 'invalid_id' });
    expect(fake.log.some((s) => /FROM agent_events/.test(s.sql))).toBe(false);
  });

  it('every statement it sends names the account, and it writes nothing', async () => {
    const tin = await seed();
    fake.log.length = 0;
    await exportOf(tin);
    const sql = fake.log.filter((s) => /\bagent_(tins|events)\b/.test(s.sql) && !/^(CREATE|ALTER) /i.test(s.sql));
    expect(sql.length).toBeGreaterThan(2);
    for (const s of sql) {
      expect(s.sql, s.sql).toMatch(/^SELECT /);
      expect(s.sql, s.sql).toMatch(/\btenant_id = \?/);
      expect(s.args, s.sql).toContain(A);
      expect(s.sql, s.sql).not.toMatch(/\bJOIN\b/i);
    }
    expect(readFileSync(join(ROOT, 'src/lib/agentVault/ledgerExport.ts'), 'utf8')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('is the ledger as it stood when the file was made: nothing recorded after that moment is in it, and a range that runs to today says it is partial', async () => {
    const tin = await newTin();
    await check(A, tin.id, 1, at(18, 11, 59, 59, 999));
    await check(A, tin.id, 2, at(18, 12, 0, 0, 0));
    await check(A, tin.id, 3, at(18, 12, 0, 0, 1)); // after the moment the file was made
    const b = await exportOf(tin, '2026-10-17', '2026-10-18');
    expect(b.leaves.map((l) => l.address)).toEqual([addr(1), addr(2)]);
    expect(b.manifest).toMatchObject({ partial: true, generated_at: '2026-10-18T12:00:00.000Z', period_end: '2026-10-19T00:00:00.000Z' });
    const finished = await exportOf(tin, '2026-10-17', '2026-10-17');
    expect(finished.manifest.partial).toBe(false);
    const later = await exportOf(tin, '2026-10-17', '2026-10-18', deps(new Date('2026-10-18T12:00:00.002Z')));
    expect(later.leaves.map((l) => l.address)).toEqual([addr(1), addr(2), addr(3)]);
  });

  it('is repeatable: the same ledger makes the same events, the same root and the same id, and a new event makes a new one', async () => {
    const tin = await seed();
    const noId = { now: () => NOW };
    const one = await exportOf(tin, '2026-10-01', '2026-10-03', noId);
    const two = await exportOf(tin, '2026-10-01', '2026-10-03', { now: () => new Date('2026-10-18T13:00:00.000Z') });
    expect(two.manifest.merkle_root).toBe(one.manifest.merkle_root);
    expect(two.leaves).toEqual(one.leaves);
    // Made at different moments, so not the same signed manifest; made from one state of the ledger, so the same id.
    expect(two.manifest.generated_at).not.toBe(one.manifest.generated_at);
    expect(two.manifest.record_id).toBe(one.manifest.record_id);
    expect(one.manifest.record_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await check(A, tin.id, 42, at(2, 20));
    const three = await exportOf(tin, '2026-10-01', '2026-10-03', noId);
    expect(three.manifest.merkle_root).not.toBe(one.manifest.merkle_root);
    expect(three.manifest.record_id).not.toBe(one.manifest.record_id);
    // A test can still fix it.
    expect((await exportOf(tin, '2026-10-01', '2026-10-03', deps(NOW, 'fixed-id'))).manifest.record_id).toBe('fixed-id');
  });

  it('the id depends on the account, the agent, the range and the content, and on nothing else', () => {
    const base = ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-03', 'a'.repeat(64));
    expect(ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-03', 'a'.repeat(64))).toBe(base);
    for (const other of [
      ex.ledgerRecordId('tenant-b', 'tin-1', '2026-10-01', '2026-10-03', 'a'.repeat(64)),
      ex.ledgerRecordId('tenant-a', 'tin-2', '2026-10-01', '2026-10-03', 'a'.repeat(64)),
      ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-02', '2026-10-03', 'a'.repeat(64)),
      ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-04', 'a'.repeat(64)),
      ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-03', 'b'.repeat(64)),
    ]) expect(other).not.toBe(base);
    // The parts cannot be shifted from one field into the next to make the same id.
    expect(ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-03', 'ab')).not.toBe(ex.ledgerRecordId('tenant-a', 'tin-1', '2026-10-01', '2026-10-03a', 'b'));
    expect(base).not.toContain('tenant');
  });

  it('refuses a bad range with its code and reads nothing', async () => {
    const tin = await seed();
    fake.log.length = 0;
    expect(await ex.exportLedger(A, tin.id, '2026-10-03', '2026-10-01', deps())).toEqual({ ok: false, error: 'invalid_period' });
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-19', deps())).toEqual({ ok: false, error: 'invalid_period' });
    expect(await ex.exportLedger(A, tin.id, 'nope', '2026-10-01', deps())).toEqual({ ok: false, error: 'invalid_period' });
    expect(await ex.exportLedger(A, tin.id, '2025-01-01', '2026-10-01', deps())).toEqual({ ok: false, error: 'export_too_large', max: 366 });
    expect(fake.log.some((s) => /FROM agent_events/.test(s.sql))).toBe(false);
  });

  it('refuses when there is no signing key, before anything is read, and never hands over an unsigned file', async () => {
    const tin = await seed();
    const real = process.env.ALMSTINS_SIGNING_KEY;
    delete process.env.ALMSTINS_SIGNING_KEY;
    try {
      fake.log.length = 0;
      expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps())).toEqual({ ok: false, error: 'signing_unavailable' });
      expect(fake.log.some((s) => /FROM agent_events/.test(s.sql))).toBe(false);
    } finally {
      process.env.ALMSTINS_SIGNING_KEY = real;
    }
  });

  it('refuses a range that holds more than 50,000 events, and allows exactly 50,000', async () => {
    const tin = await newTin();
    const seedRows = (n: number) => {
      for (let i = 0; i < n; i += 1) {
        fake.seed('agent_events', {
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tenant_id: A, tin_id: tin.id, kind: 'checked', address: addr(i % 50), chain: null, answer: 'unknown', registry: 'none',
          status: 'unknown', key_id: 'k', source_ip: null, detail_json: '{"basis":"not_in_registry"}', occurred_at: new Date(Date.UTC(2026, 9, 2, 0, 0, 0, i)).toISOString(),
        });
      }
    };
    seedRows(50_000);
    const all = expectOk(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps()));
    expect(all.bundle.leaves).toHaveLength(50_000);
    expect(ex.verifyLedgerBundle(all.bundle).verdict).toBe('verified');
    fake.seed('agent_events', {
      id: '00000000-0000-4000-8000-ffffffffffff', tenant_id: A, tin_id: tin.id, kind: 'checked', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', key_id: 'k',
      source_ip: null, detail_json: '{}', occurred_at: '2026-10-02T12:00:00.000Z',
    });
    fake.log.length = 0;
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps())).toEqual({ ok: false, error: 'export_too_large', max: 50_000 });
    // Refused from the count alone: not one event row was read to find that out.
    expect(fake.log.filter((s) => /FROM agent_events/.test(s.sql) && !/COUNT\(\*\)/.test(s.sql))).toEqual([]);
    expect(fake.log.some((s) => /SELECT COUNT\(\*\) AS n FROM agent_events/.test(s.sql))).toBe(true);
    // Narrowed to a day that holds fewer, it is allowed again.
    expect(expectOk(await ex.exportLedger(A, tin.id, '2026-10-03', '2026-10-03', deps())).bundle.leaves).toHaveLength(0);
  }, 60_000);

  it('shows the agent\'s name as the owner wrote it, escaped by the JSON, in the manifest', async () => {
    const tin = await newTin(A, '"><script>alert(1)</script> & \'q\'');
    const b = await exportOf(tin);
    const parsed = JSON.parse(ex.serializeBundle(b));
    expect(parsed.manifest.tin_label).toBe('"><script>alert(1)</script> & \'q\'');
    expect(ex.verifyLedgerBundle(b).verdict).toBe('verified');
  });
});

describe('the files that go out', () => {
  it('names the signed file and the CSV by the range and the first of the file\'s id', () => {
    const m = { from_day: '2026-10-01', to_day: '2026-10-18', record_id: '12345678-aaaa-4bbb-8ccc-0123456789ab' };
    expect(ex.ledgerFileName(m, 'json')).toBe('almstins-agent-ledger-2026-10-01-to-2026-10-18-12345678-proof.json');
    // The CSV says in its name that it is a copy and not signed, so it cannot be mistaken for the signed file in a folder of downloads.
    expect(ex.ledgerFileName(m, 'csv')).toBe('almstins-agent-ledger-2026-10-01-to-2026-10-18-12345678-unsigned-copy.csv');
    expect(ex.ledgerFileName(m, 'json')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(ex.ledgerFileName(m, 'csv')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('serializes the bundle so it reads back as the same bundle, indented while it is small', async () => {
    const b = await exportOf(await seed());
    const text = ex.serializeBundle(b);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(b)));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toMatch(/\n {2}"manifest"/);
  });
});

/** A minimal RFC 4180 reader, for reading the CSV back the way a spreadsheet would. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The CSV text a spreadsheet sees: without the byte-order mark that tells it the file is UTF-8. */
const withoutBom = (csv: string): string => csv.replace(/^\uFEFF/, '');

describe('the CSV copy', () => {
  it('starts with the column names, with no line of prose in front of them, and says in its last column which signed file it copies', async () => {
    const b = await exportOf(await seed());
    const csv = ex.ledgerCsv(b);
    // A byte-order mark first (a spreadsheet reads the file as UTF-8, and a token symbol can be any text), then the header.
    expect(csv.startsWith('\uFEFFtime_utc,kind,direction,')).toBe(true);
    const rows = parseCsv(withoutBom(csv));
    expect(rows[0]).toEqual([...ex.CSV_COLUMNS]);
    expect(rows[0][rows[0].length - 1]).toBe('unsigned_copy_of_bundle_id');
    const idColumn = ex.CSV_COLUMNS.indexOf('unsigned_copy_of_bundle_id');
    for (const r of rows.slice(1)) expect(r[idColumn], r.join('|')).toBe(b.manifest.record_id);
    expect(csv).not.toMatch(/UNSIGNED copy|merkle_root|signature_hex|"alg"|Ed25519/);
    expect(csv).not.toMatch(/basis_or_reason/);
  });

  it('has one line for each event after the column names, in the order of the signed file, and uses CRLF', async () => {
    const b = await exportOf(await seed());
    const csv = ex.ledgerCsv(b);
    const rows = parseCsv(withoutBom(csv));
    expect(rows[0]).toEqual([...ex.CSV_COLUMNS]);
    expect(rows.length).toBe(1 + b.leaves.length);
    expect(rows.slice(1).map((r) => r[ex.CSV_COLUMNS.indexOf('event_id')])).toEqual(b.leaves.map((l) => l.event_id));
    expect(rows.slice(1).map((r) => r[0])).toEqual(b.leaves.map((l) => l.date));
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').length).toBe(rows.length + 1);
    for (const r of rows) expect(r, r.join('|')).toHaveLength(ex.CSV_COLUMNS.length);
  });

  it('writes a check and a transfer in the columns that belong to them, and leaves the rest empty', async () => {
    const b = await exportOf(await seed());
    const rows = parseCsv(withoutBom(ex.ledgerCsv(b))).slice(1);
    const col = (r: string[], name: (typeof ex.CSV_COLUMNS)[number]) => r[ex.CSV_COLUMNS.indexOf(name)];
    const checkRow = rows.find((r) => col(r, 'kind') === 'checked' && col(r, 'reason') === 'domain_proof')!;
    expect(col(checkRow, 'answer')).toBe('proven');
    expect(col(checkRow, 'registry')).toBe('trusted');
    expect(col(checkRow, 'key_id')).toBe('k1');
    for (const name of ['direction', 'wallet', 'amount', 'asset', 'usd', 'tx_hash', 'block_number', 'linked_check'] as const) expect(col(checkRow, name), name).toBe('');
    const inRow = rows.find((r) => col(r, 'direction') === 'in')!;
    expect(col(inRow, 'kind')).toBe('transaction');
    expect(col(inRow, 'amount')).toBe('1.5');
    expect(col(inRow, 'asset')).toBe('ETH');
    expect(col(inRow, 'usd')).toBe('1270.559871');
    expect(col(inRow, 'tx_hash')).toBe(HASH(1));
    expect(col(inRow, 'linked_check')).toBe('11111111-1111-4111-8111-111111111111');
    expect(col(inRow, 'key_id')).toBe('');
    const unpriced = rows.find((r) => col(r, 'asset') === 'ODD')!;
    expect(col(unpriced, 'usd')).toBe('');
    expect(col(unpriced, 'reason')).toBe('no_preceding_check');
    const zero = rows.find((r) => col(r, 'reason') === 'ambiguous_checks')!;
    expect(col(zero, 'usd')).toBe('0'); // a priced zero is a zero; unknown is empty
  });

  it('is safe to open in a spreadsheet: a cell that would run as a formula is written as text, and quotes, commas and line breaks are quoted', async () => {
    const tin = await newTin();
    const odd = ['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(1)', '\tcmd', 'a,b', 'say "hi"', 'two\nlines', '  =spaced', ' +1', '\t =1', '   @SUM(1)', ' -2+3'];
    for (const [i, asset] of odd.entries()) await transfer(A, tin.id, 10 + i, at(1, 8, i), 'in', 1, { asset });
    const b = await exportOf(tin, '2026-10-01', '2026-10-01');
    const csv = ex.ledgerCsv(b);
    const rows = parseCsv(withoutBom(csv)).slice(1);
    expect(rows).toHaveLength(odd.length);
    const assets = rows.map((r) => r[ex.CSV_COLUMNS.indexOf('asset')]);
    expect(assets).toEqual([
      "'=HYPERLINK(\"http://evil.example\",\"x\")", "'+1+1", "'-2+3", "'@SUM(1)", "'\tcmd", 'a,b', 'say "hi"', 'two\nlines',
      // Spaces in front do not hide it: some spreadsheets trim them before they look at the first character.
      "'  =spaced", "' +1", "'\t =1", "'   @SUM(1)", "' -2+3",
    ]);
    for (const a of assets) expect(a, a).not.toMatch(/^\s*[=+\-@]/);
    expect(csv).not.toMatch(/\r\n\s*=[A-Z]/);
  });

  it('writes a cell by RFC 4180', () => {
    expect(ex.csvCell(null)).toBe('');
    expect(ex.csvCell(undefined)).toBe('');
    expect(ex.csvCell(7)).toBe('7');
    expect(ex.csvCell('plain')).toBe('plain');
    expect(ex.csvCell('a,b')).toBe('"a,b"');
    expect(ex.csvCell('a"b')).toBe('"a""b"');
    expect(ex.csvCell('a\nb')).toBe('"a\nb"');
    expect(ex.csvCell('a\rb')).toBe('"a\rb"');
    expect(ex.csvCell('=1')).toBe("'=1");
    expect(ex.csvCell('  =1')).toBe("'  =1");
    expect(ex.csvCell(' text with = inside')).toBe(' text with = inside'); // not a formula: the first character that counts is a letter
    expect(ex.csvCell('-')).toBe("'-");
    expect(ex.csvCell('0xc0ffee')).toBe('0xc0ffee');
  });

  it('an export of a quiet range is the column names and nothing else', async () => {
    const b = await exportOf(await newTin());
    const rows = parseCsv(withoutBom(ex.ledgerCsv(b)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...ex.CSV_COLUMNS]);
  });
});

describe('making a large export without stalling the server', () => {
  /** `n` checks as the canonical leaves, without going through the database. */
  const manyLeaves = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      v: 1 as const, kind: 'checked' as const, date: new Date(Date.UTC(2026, 9, 2, 0, 0, 0, i)).toISOString(),
      event_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, address: addr(i % 50), chain: null, answer: 'unknown', registry: 'none', basis: 'not_in_registry', key_id: 'k',
    }));
  const input = (n: number) => ({
    tenantId: A, tin: { id: '00000000-0000-4000-8000-0000000000aa', label: 'Agent' }, range: { from: '2026-10-01', to: '2026-10-03' }, partial: false,
    generatedAt: NOW.toISOString(), recordId: '00000000-0000-4000-8000-0000000000ee', leaves: manyLeaves(n),
  });

  it('builds the same bundle, byte for byte, whether it gives the event loop turns or not', async () => {
    const plain = ex.buildLedgerBundle(input(4_500));
    const yielding = await ex.buildLedgerBundleYielding(input(4_500));
    expect(yielding).toEqual(plain);
    expect(JSON.stringify(yielding)).toBe(JSON.stringify(plain));
    expect(verifyBundle(yielding as unknown as ProofBundle, [{ key_id: yielding.signature!.key_id, public_key_hex: pubHex }]).verdict).toBe('verified');
  });

  it('gives the event loop a turn every HASH_CHUNK leaves, and none for a small file', async () => {
    expect(ex.HASH_CHUNK).toBe(2_000);
    const turns = async (n: number) => {
      const spy = vi.spyOn(globalThis, 'setImmediate');
      try {
        await ex.buildLedgerBundleYielding(input(n));
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    expect(await turns(1_999)).toBe(0);
    expect(await turns(2_000)).toBe(1);
    expect(await turns(4_500)).toBe(2);
  });

  it('lets another callback run while it is still building', async () => {
    let tick = 0;
    let otherRanAt = -1;
    let builtAt = -1;
    setImmediate(() => { otherRanAt = ++tick; });
    await ex.buildLedgerBundleYielding(input(4_500)).then(() => { builtAt = ++tick; });
    expect(otherRanAt).toBeGreaterThan(0);
    expect(otherRanAt).toBeLessThan(builtAt); // it was served before the file was done
  });

  it('checks that the published keys confirm the signature without hashing the events again', async () => {
    const tin = await seed();
    const b = await exportOf(tin);
    expect(ex.signatureIsPublished(b)).toBe(true);
    // The check is on the signature and the manifest it covers: an altered manifest, another key and no signature all fail it.
    expect(ex.signatureIsPublished({ ...b, manifest: { ...b.manifest, leaf_count: b.manifest.leaf_count + 1 } })).toBe(false);
    expect(ex.signatureIsPublished({ ...b, signature: { ...b.signature!, key_id: 'almstins-0000000000000000' } })).toBe(false);
    expect(ex.signatureIsPublished({ ...b, signature: { ...b.signature!, alg: 'RS256' as never } })).toBe(false);
    expect(ex.signatureIsPublished({ ...b, signature: { ...b.signature!, signature_hex: '00'.repeat(64) } })).toBe(false);
    expect(ex.signatureIsPublished({ ...b, signature: null })).toBe(false);
  });
});

describe('one export at a time', () => {
  it('lets an account start one, turns away a second from the same account, and takes the place back when it is over', () => {
    const gate = ex.createExportGate({ perProcess: 5 });
    const release = gate.enter(A);
    expect(release).toBeTypeOf('function');
    expect(gate.enter(A)).toBeNull(); // one per account, whatever the server allows
    expect(gate.enter(B)).toBeTypeOf('function'); // another account has its own place
    release!();
    expect(gate.enter(A)).toBeTypeOf('function');
  });

  it('is one at a time for the whole server, so a full file is in memory once', () => {
    expect(ex.MAX_EXPORTS_IN_FLIGHT).toBe(1);
    const gate = ex.createExportGate();
    const release = gate.enter(A);
    expect(gate.enter(B)).toBeNull();
    release!();
    expect(gate.enter(B)).toBeTypeOf('function');
  });

  it('gives a place back once and only once: releasing twice cannot free another account\'s place', () => {
    const gate = ex.createExportGate({ perProcess: 1 });
    const first = gate.enter(A)!;
    first();
    const second = gate.enter(B)!; // takes the freed place
    first(); // a stale release
    expect(gate.enter(A)).toBeNull(); // B still holds it
    second();
    expect(gate.enter(A)).toBeTypeOf('function');
  });
});

describe('a place in the export gate that is never given back', () => {
  it('is taken back when its lease runs out, so one stuck export cannot close exports until a restart', () => {
    let clock = 1_000;
    const gate = ex.createExportGate({ perProcess: 1, leaseMs: 5_000, now: () => clock });
    const stuck = gate.enter(A)!;
    clock += 4_999;
    expect(gate.enter(B)).toBeNull(); // still held, and the account's own place too
    expect(gate.enter(A)).toBeNull();
    clock += 1; // five seconds: the lease is up
    const next = gate.enter(B);
    expect(next).toBeTypeOf('function');
    // The stuck export finally ends and calls its release: it must not free the place of the export that took over.
    stuck();
    expect(gate.enter(A)).toBeNull();
    next!();
    expect(gate.enter(A)).toBeTypeOf('function');
  });

  it('does not let a stale release free the place of the same account\'s next export', () => {
    let clock = 1_000;
    const gate = ex.createExportGate({ perProcess: 1, leaseMs: 5_000, now: () => clock });
    const stuck = gate.enter(A)!;
    clock += 5_000; // the lease is up
    const again = gate.enter(A); // the same account starts another: its old place was taken back
    expect(again).toBeTypeOf('function');
    stuck(); // the first export finally ends
    expect(gate.enter(A)).toBeNull(); // the second is still running: its place is its own
    expect(gate.enter(B)).toBeNull();
    again!();
    expect(gate.enter(B)).toBeTypeOf('function');
  });

  it('has a lease of two minutes, far longer than a full file takes', () => {
    expect(ex.EXPORT_LEASE_MS).toBe(120_000);
  });
});

describe('when the file says it was made', () => {
  const clock = (...ms: number[]) => {
    let i = 0;
    return () => new Date(ms[Math.min(i++, ms.length - 1)]);
  };

  it('reads the time after the ledger has been read, so nothing recorded after it can be in the file', async () => {
    const tin = await seed(); // six events on 1 to 3 October
    const t0 = NOW.getTime();
    await check(A, tin.id, 9, new Date(t0 + 10).toISOString()); // recorded 10 ms after the export starts
    const b = expectOk(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-18', { now: clock(t0, t0 + 50), newId: () => '00000000-0000-4000-8000-0000000000ee' })).bundle;
    expect(b.manifest.generated_at).toBe(new Date(t0 + 50).toISOString());
    expect(b.manifest.leaf_count).toBe(6); // the one recorded after the start is not in it ...
    expect(b.leaves.map((l) => l.address)).not.toContain(addr(9));
    expect(b.manifest.partial).toBe(true); // ... and a range that runs to today says it was made before the day was over
  });

  it('is never earlier than the moment the export started, even if the clock steps back', async () => {
    const tin = await seed();
    const t0 = NOW.getTime();
    const b = expectOk(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', { now: clock(t0, t0 - 5_000) })).bundle;
    expect(b.manifest.generated_at).toBe(new Date(t0).toISOString());
  });

  it('says in the manifest\'s own words that the agent\'s name is the account holder\'s text and was not checked', async () => {
    const b = await exportOf(await seed());
    expect(b.manifest.disclaimer).toMatch(/agent name \(tin_label\) is text the account holder chose; Almstins did not check it/);
    expect(b.manifest.tin_label).toBe('Treasury agent');
  });
});

describe('part of a day: a range by the minute', () => {
  const today = '2026-10-18';
  const at1200 = Date.UTC(2026, 9, 18, 12, 0, 0);

  it('takes a UTC minute at either end, and mixes it with a day', () => {
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-18T11:59', today)).toEqual({ ok: true, from: '2026-10-18T06:00', to: '2026-10-18T11:59', days: 1 });
    expect(ex.parseExportRange('2026-10-17', '2026-10-18T06:00', today)).toEqual({ ok: true, from: '2026-10-17', to: '2026-10-18T06:00', days: 2 });
    expect(ex.parseExportRange('2026-10-17T22:30', '2026-10-18', today)).toMatchObject({ ok: true, days: 2 });
    // One minute is a range: the last minute is counted through its end.
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-18T06:00', today)).toMatchObject({ ok: true, days: 1 });
  });

  it('refuses a minute that is not a real one, in any spelling but the one form', () => {
    for (const bad of ['2026-10-18T24:00', '2026-10-18T12:60', '2026-10-18T7:00', '2026-10-18t07:00', '2026-10-18T07:00:00', '2026-10-18T07:00Z', ' 2026-10-18T07:00', '2026-10-18T07:00 ', '2026-02-30T07:00', '2026-10-18T07', '2026-10-18 07:00']) {
      expect(ex.parseExportRange(bad, '2026-10-18', today), bad).toEqual({ ok: false, error: 'invalid_period' });
      expect(ex.parseExportRange('2026-10-01', bad, today), bad).toEqual({ ok: false, error: 'invalid_period' });
    }
  });

  it('refuses a start that has not begun, even when the end is a whole day that has', () => {
    // It is 12:00 on the 18th: a range from 23:00 that day to the end of the day is ahead of the clock.
    expect(ex.parseExportRange('2026-10-18T23:00', '2026-10-18', today, at1200)).toEqual({ ok: false, error: 'invalid_period' });
    expect(ex.parseExportRange('2026-10-18T12:01', '2026-10-18T12:05', today, at1200)).toEqual({ ok: false, error: 'invalid_period' });
    expect(ex.parseExportRange('2026-10-18T12:00', '2026-10-18', today, at1200)).toMatchObject({ ok: true }); // begins this very minute
    expect(ex.parseExportRange('2026-10-18T11:59', '2026-10-18', today, at1200)).toMatchObject({ ok: true });
    expect(ex.parseExportRange('2026-10-17T23:00', '2026-10-18', today, at1200)).toMatchObject({ ok: true });
  });

  it('refuses a start at or after the end, and an end that has not begun', () => {
    expect(ex.parseExportRange('2026-10-18T12:00', '2026-10-18T11:59', today)).toEqual({ ok: false, error: 'invalid_period' });
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-17', today)).toEqual({ ok: false, error: 'invalid_period' });
    // With the clock: the minute 12:00 has begun at 12:00:00, the minute 12:01 has not.
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-18T12:00', today, at1200)).toMatchObject({ ok: true });
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-18T12:01', today, at1200)).toEqual({ ok: false, error: 'invalid_period' });
    expect(ex.parseExportRange('2026-10-18T06:00', '2026-10-19T00:00', today, at1200)).toEqual({ ok: false, error: 'invalid_period' });
    expect(ex.parseExportRange('2026-10-19T00:00', '2026-10-19T00:05', today, at1200)).toEqual({ ok: false, error: 'invalid_period' });
  });

  it('still allows 366 days at most, counting a part of a day as a day', () => {
    expect(ex.parseExportRange('2027-01-01T00:00', '2028-01-01T23:59', '2028-06-01')).toMatchObject({ ok: true, days: 366 });
    expect(ex.parseExportRange('2027-01-01T00:00', '2028-01-02T00:00', '2028-06-01')).toEqual({ ok: false, error: 'export_too_large', max: 366 });
  });

  it('knows the first moment of a range and the first moment after it, to the minute', () => {
    expect(ex.rangeBounds('2026-10-01', '2026-10-03')).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-04T00:00:00.000Z' });
    expect(ex.rangeBounds('2026-10-18T06:00', '2026-10-18T11:59')).toEqual({ start: '2026-10-18T06:00:00.000Z', end: '2026-10-18T12:00:00.000Z' });
    expect(ex.rangeBounds('2026-10-17', '2026-10-18T06:00')).toEqual({ start: '2026-10-17T00:00:00.000Z', end: '2026-10-18T06:01:00.000Z' });
    expect(ex.rangeBounds('2026-10-18T23:59', '2026-10-18T23:59')).toEqual({ start: '2026-10-18T23:59:00.000Z', end: '2026-10-19T00:00:00.000Z' });
    expect(ex.rangeBounds('nope', '2026-10-01')).toBeNull();
    expect(ex.rangeBounds('2026-10-01', '2026-10-01T25:00')).toBeNull();
  });

  /** Checks at 08:59:59.999, 09:00:00.000, 09:30, 09:59:59.999 and 10:00:00.000 on 2 October, and one on 3 October. */
  async function seedEdges() {
    const tin = await newTin();
    const when = [at(2, 8, 59, 59, 999), at(2, 9, 0, 0, 0), at(2, 9, 30), at(2, 9, 59, 59, 999), at(2, 10, 0, 0, 0), at(3, 9, 0, 0, 0)];
    for (const [i, w] of when.entries()) await check(A, tin.id, i + 1, w);
    return tin;
  }

  it('holds the events of its first minute and its last, and the first moment after the last minute is out', async () => {
    const tin = await seedEdges();
    const b = await exportOf(tin, '2026-10-02T09:00', '2026-10-02T09:59');
    expect(b.leaves.map((l) => l.address)).toEqual([addr(2), addr(3), addr(4)]);
    expect(b.manifest).toMatchObject({
      period: '2026-10-02 09:00 to 2026-10-02 09:59 UTC', from_day: '2026-10-02', to_day: '2026-10-02',
      period_start: '2026-10-02T09:00:00.000Z', period_end: '2026-10-02T10:00:00.000Z', partial: false,
    });
  });

  it('names a range that crosses midnight by the day it starts in and the day its last moment falls in', async () => {
    const tin = await seedEdges();
    const b = await exportOf(tin, '2026-10-02T09:30', '2026-10-03T09:00');
    expect(b.manifest).toMatchObject({ from_day: '2026-10-02', to_day: '2026-10-03', period: '2026-10-02 09:30 to 2026-10-03 09:00 UTC' });
    expect(b.leaves.map((l) => l.address)).toEqual([addr(3), addr(4), addr(5), addr(6)]);
  });

  it('exports a day in parts that touch: every event is in one part, none in two, and none falls between', async () => {
    const tin = await seedEdges();
    const whole = await exportOf(tin, '2026-10-02', '2026-10-02');
    const parts = [
      await exportOf(tin, '2026-10-02T00:00', '2026-10-02T08:59'),
      await exportOf(tin, '2026-10-02T09:00', '2026-10-02T09:59'),
      await exportOf(tin, '2026-10-02T10:00', '2026-10-02T23:59'),
    ];
    const ids = parts.flatMap((p) => p.leaves.map((l) => l.event_id));
    expect(new Set(ids).size).toBe(ids.length); // no event in two parts
    expect([...ids].sort()).toEqual(whole.leaves.map((l) => l.event_id).sort()); // and none missing
    // The parts are different files from the whole day and from each other (their ids are made from their content), each signed and each verifying on its own.
    const derived = async (from: string, to: string) => expectOk(await ex.exportLedger(A, tin.id, from, to, { now: () => NOW })).bundle;
    const files = [await derived('2026-10-02', '2026-10-02'), await derived('2026-10-02T00:00', '2026-10-02T08:59'), await derived('2026-10-02T09:00', '2026-10-02T09:59'), await derived('2026-10-02T10:00', '2026-10-02T23:59')];
    expect(new Set(files.map((b) => b.manifest.record_id)).size).toBe(4);
    for (const b of [whole, ...parts, ...files]) expect(verifyBundle(b as unknown as ProofBundle, [{ key_id: b.signature!.key_id, public_key_hex: pubHex }]).verdict).toBe('verified');
    // A whole-day range written in minutes is the same events as the day.
    const written = await exportOf(tin, '2026-10-02T00:00', '2026-10-02T23:59');
    expect(written.leaves.map((l) => l.event_id)).toEqual(whole.leaves.map((l) => l.event_id));
    expect(written.manifest.period_end).toBe(whole.manifest.period_end);
  });

  it('says a range that runs to the present was made before it ended, by the minute', async () => {
    const tin = await seedEdges();
    const b = expectOk(await ex.exportLedger(A, tin.id, '2026-10-18T06:00', '2026-10-18T12:00', deps(new Date('2026-10-18T12:00:30.000Z')))).bundle;
    expect(b.manifest.partial).toBe(true); // the last minute, 12:00, is not over
    expect(b.manifest.period_end).toBe('2026-10-18T12:01:00.000Z');
    const over = expectOk(await ex.exportLedger(A, tin.id, '2026-10-18T06:00', '2026-10-18T11:00', deps(new Date('2026-10-18T12:00:30.000Z')))).bundle;
    expect(over.manifest.partial).toBe(false); // 11:00 is over
    // And a minute that has not begun is refused.
    expect(await ex.exportLedger(A, tin.id, '2026-10-18T06:00', '2026-10-18T12:01', deps(new Date('2026-10-18T12:00:30.000Z')))).toEqual({ ok: false, error: 'invalid_period' });
    expect((await ex.exportLedger(A, tin.id, '2026-10-18T06:00', '2026-10-18T12:00', deps(new Date('2026-10-18T12:00:30.000Z')))).ok).toBe(true);
  });

  it('writes a part\'s CSV copy and file names like a day\'s', async () => {
    const tin = await seedEdges();
    const b = await exportOf(tin, '2026-10-02T09:00', '2026-10-02T09:59');
    expect(ex.ledgerFileName(b.manifest, 'json')).toMatch(/^almstins-agent-ledger-2026-10-02-to-2026-10-02-[0-9a-f]{8}-proof\.json$/);
    expect(ex.ledgerFileName(b.manifest, 'csv')).toMatch(/^almstins-agent-ledger-2026-10-02-to-2026-10-02-[0-9a-f]{8}-unsigned-copy\.csv$/);
    expect(parseCsv(withoutBom(ex.ledgerCsv(b)))).toHaveLength(1 + 3);
  });
});
