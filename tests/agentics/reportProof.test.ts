import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';
import { buildReport, dayBounds, type ReportContent } from '../../src/lib/agentVault/report';
import {
  AGENT_REPORT_DISCLAIMER,
  buildReportBundle,
  bundleFromStored,
  contentHashOf,
  leavesOf,
  rootOf,
  verifyReportBundle,
  type AgentReportBundle,
} from '../../src/lib/agentVault/reportProof';
import { getPublicKeyHex, getSigningKey } from '../../src/lib/recordProof/signing';
import { verifyBundle } from '../../src/lib/recordProof/verify';
import type { ProofBundle } from '../../src/lib/recordProof/buildProof';
import type { LedgerEvent } from '../../src/lib/agentVault/events';

/**
 * The signature on a report: built from the Year Summary's own parts, so the three checkers that
 * read a Year Summary proof (the public verifier, POST /api/verify-record and the offline script)
 * read a report's bundle without any change, and a change of one byte anywhere is caught. The signing
 * key is a seed generated for each test and signs nothing outside it. Every address, label and
 * tenant is invented.
 */
const TENANT = 'tenant-proof-1';
const { start: START, end: END } = dayBounds('2026-10-17');
const GENERATED = '2026-10-18T09:10:00.000Z';
const RECORD_ID = '00000000-0000-4000-8000-0000000000aa';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 17, h, m)).toISOString();

let n = 0;
const check = (address: string, basis: string, answer: LedgerEvent['answer'], when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'checked', at: when, address, chain: 'ethereum', answer,
  registry: 'trusted', status: 'unknown', keyId: 'k', sourceIp: null, tx: null, detail: { basis },
});
const move = (direction: 'in' | 'out', usd: number | null, when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'transaction', at: when, address: addr(2), chain: 'ethereum',
  answer: 'unknown', registry: 'trusted', status: null, keyId: null, sourceIp: null,
  tx: { hash: txHash(n), direction, wallet: addr(1), amount: '1.5', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
  detail: { reason: 'no_preceding_check' },
});

const content = (): ReportContent =>
  buildReport(
    [
      check(addr(1), 'registry_flagged', 'flagged', at(8)),
      check(addr(3), 'not_in_registry', 'unknown', at(9)),
      check(addr(4), 'registered_first_check', 'unknown', at(10)),
      check(addr(5), 'domain_proof', 'proven', at(11)),
      move('in', 1270.56, at(12)),
      move('out', null, at(13)),
    ],
    {
      tin: { id: 'tin-1', label: 'Treasury <agent>' },
      period: { start: START, end: END, partial: false },
      labels: new Map([[addr(1), 'Ops wallet'], [addr(3), '"quoted" & <b>label</b>']]),
    },
  );

const build = (over: Partial<Parameters<typeof buildReportBundle>[0]> = {}): AgentReportBundle =>
  buildReportBundle({ tenantId: TENANT, reportId: RECORD_ID, version: 1, generatedAt: GENERATED, content: content(), prevRoot: null, ...over });

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

beforeEach(() => {
  vi.stubEnv('ALMSTINS_SIGNING_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
  vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a genuine report bundle', () => {
  it('verifies, with the public verifier\'s own function and the keys Almstins publishes', () => {
    const outcome = verifyReportBundle(build());
    expect(outcome).toMatchObject({ verdict: 'verified', code: 'ok', checks: { root_recomputed: true, leaf_count_match: true, signature_valid: true, key_published: true } });
    const keys = [{ key_id: build().signature!.key_id, public_key_hex: getPublicKeyHex()! }];
    expect(verifyBundle(build() as unknown as ProofBundle, keys).verdict).toBe('verified');
  });

  it('is a record of its own kind, for the day, with the bucket counts, and links to nothing before it for the first version', () => {
    const { manifest } = build();
    expect(manifest).toMatchObject({
      v: 1, record_id: RECORD_ID, record_type: 'agent_report', period: '2026-10-17', period_start: START, period_end: END, partial: false,
      version: 1, data_source: 'ledger', prev_root: null, generated_at: GENERATED, counts: { issues: 1, not_confirmed: 1, new: 1, no_issues: 1 },
      schema_version: '1', tree_algo: 'sha256-merkle-v1',
    });
    expect(manifest.leaf_count).toBe(4); // the summary, and one for each listed address
    expect(manifest.signing_key_id).toBe(build().signature!.key_id);
    expect(manifest.verify_url).toMatch(/\/verify-record$/);
    expect(manifest.disclaimer).toBe(AGENT_REPORT_DISCLAIMER);
  });

  it('a later version names the root of the one it supersedes', () => {
    const v1 = build();
    const v2 = build({ version: 2, reportId: '00000000-0000-4000-8000-0000000000bb', prevRoot: v1.manifest.merkle_root });
    expect(v2.manifest).toMatchObject({ version: 2, prev_root: v1.manifest.merkle_root });
    expect(verifyReportBundle(v2).verdict).toBe('verified');
  });

  it('commits to every line of the report: one summary leaf and one leaf for each listed address, with the strip and the counts in the summary', () => {
    const leaves = build().leaves;
    expect(leaves.map((l) => l.kind).sort()).toEqual(['address', 'address', 'address', 'summary']);
    const summary = leaves.find((l) => l.kind === 'summary') as any;
    expect(summary).toMatchObject({
      issues_addresses: 1, not_confirmed_addresses: 1, new_addresses: 1, no_issues_addresses: 1, no_issues_checks: 1, events_checked: 4, events_transaction: 2,
      bought_count: 1, bought_usd: '1270.56', sold_count: 1, sold_unpriced: 1, sold_usd: '0', transfers_no_preceding_check: 2, tin_label: 'Treasury <agent>',
    });
    const withLabel = (leaves as any[]).find((l) => l.address === addr(3));
    expect(withLabel).toMatchObject({ bucket: 'not_confirmed', label: '"quoted" & <b>label</b>', reasons: ['not_in_registry'], first_at: at(9) });
  });

  it('does not depend on how the listed addresses were ordered', () => {
    const c = content();
    const shuffled = clone(c);
    shuffled.buckets.issues.listed.reverse();
    shuffled.buckets.not_confirmed.listed.reverse();
    expect(rootOf(shuffled)).toBe(rootOf(c));
    const reversedLeaves = leavesOf(c).reverse();
    expect(reversedLeaves).toHaveLength(leavesOf(c).length);
  });

  it('the hash of its content tells a changed report from an unchanged one', () => {
    const c = content();
    expect(contentHashOf(c)).toBe(contentHashOf(clone(c)));
    const changed = clone(c);
    changed.buckets.no_issues.checks += 1;
    expect(contentHashOf(changed)).not.toBe(contentHashOf(c));
    expect(contentHashOf(c)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the manifest, the part that travels with the signature, names no one', () => {
  it('carries no address, label, tin name or account id', () => {
    const text = JSON.stringify(build().manifest);
    for (const secret of [addr(1), addr(3), addr(4), addr(5), 'Ops wallet', 'quoted', 'Treasury', TENANT, 'tin-1']) expect(text, secret).not.toContain(secret);
    expect(build().manifest.tenant_scope_tag).toMatch(/^tst-[0-9a-f]{24}$/);
  });

  it('the same account always gets the same tag, and another account another one', () => {
    expect(build().manifest.tenant_scope_tag).toBe(build().manifest.tenant_scope_tag);
    expect(build({ tenantId: 'tenant-proof-2' }).manifest.tenant_scope_tag).not.toBe(build().manifest.tenant_scope_tag);
  });
});

describe('a change of one byte anywhere is caught', () => {
  const verdict = (b: unknown) => verifyReportBundle(b as AgentReportBundle);

  it.each([
    ['an address in a listed line', (b: any) => { b.leaves.find((l: any) => l.address === addr(1)).address = addr(9); }],
    ['a label', (b: any) => { b.leaves.find((l: any) => l.address === addr(1)).label = 'Evil wallet'; }],
    ['a check count on a listed address', (b: any) => { b.leaves.find((l: any) => l.address === addr(3)).checks += 1; }],
    ['a reason', (b: any) => { b.leaves.find((l: any) => l.address === addr(3)).reasons = ['domain_proof']; }],
    ['the bucket a line is under', (b: any) => { b.leaves.find((l: any) => l.address === addr(1)).bucket = 'new'; }],
    ['a count in the summary', (b: any) => { b.leaves.find((l: any) => l.kind === 'summary').issues_addresses = 0; }],
    ['the bought total in the summary', (b: any) => { b.leaves.find((l: any) => l.kind === 'summary').bought_usd = '1.00'; }],
    ['the tin name in the summary', (b: any) => { b.leaves.find((l: any) => l.kind === 'summary').tin_label = 'Other'; }],
    ['a time', (b: any) => { b.leaves.find((l: any) => l.address === addr(1)).last_at = at(23); }],
    ['a line removed', (b: any) => { b.leaves = b.leaves.filter((l: any) => l.address !== addr(1)); }],
    ['a line added', (b: any) => { b.leaves.push({ ...b.leaves.find((l: any) => l.address === addr(1)), address: addr(7) }); }],
  ])('%s: tampered, the root no longer matches', (_name, mutate) => {
    const b = clone(build());
    mutate(b);
    const o = verdict(b);
    expect(o.verdict).toBe('tampered');
    expect(['root_mismatch', 'leaf_count_mismatch']).toContain(o.code);
  });

  it.each([
    ['the day', (m: any) => { m.period = '2026-10-18'; }],
    ['the version', (m: any) => { m.version = 2; }],
    ['the record id', (m: any) => { m.record_id = '00000000-0000-4000-8000-0000000000cc'; }],
    ['the time it was made', (m: any) => { m.generated_at = '2026-10-18T09:10:00.001Z'; }],
    ['the counts', (m: any) => { m.counts.issues = 0; }],
    ['the chain to the version before', (m: any) => { m.prev_root = 'a'.repeat(64); }],
    ['whether it is partial', (m: any) => { m.partial = true; }],
    ['the key it names', (m: any) => { m.signing_key_id = 'almstins-0000000000000000'; }],
  ])('%s in the manifest: tampered, the signature no longer matches', (_name, mutate) => {
    const b = clone(build());
    mutate(b.manifest);
    expect(verdict(b)).toMatchObject({ verdict: 'tampered', code: 'bad_signature' });
  });

  it('the signature changed by a single hex digit', () => {
    const b = clone(build());
    const sig = b.signature!.signature_hex;
    b.signature!.signature_hex = `${sig[0] === 'a' ? 'b' : 'a'}${sig.slice(1)}`;
    expect(verdict(b)).toMatchObject({ verdict: 'tampered', code: 'bad_signature' });
  });

  it('a signature from another key, under the name of a key that is published', () => {
    const genuine = clone(build());
    const genuineKey = getSigningKey()!;
    vi.stubEnv('ALMSTINS_SIGNING_KEY', randomBytes(32).toString('hex'));
    const stranger = build();
    // The genuine key is now retired but still published; the stranger signs and claims to be it.
    vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', `${genuineKey.keyId}:${genuineKey.publicKeyHex}`);
    expect(verdict(genuine).verdict).toBe('verified');
    const forged = { ...genuine, signature: { ...stranger.signature!, key_id: genuineKey.keyId } };
    expect(verdict(forged)).toMatchObject({ verdict: 'tampered', code: 'bad_signature' });
  });

  it('only the presentational lines are outside the signature: the disclaimer and the link can change', () => {
    const b = clone(build());
    b.manifest.disclaimer = 'something else';
    b.manifest.verify_url = 'https://example.test/verify-record';
    expect(verdict(b).verdict).toBe('verified');
  });

  it('leaves listed in another order are fine: every verifier orders them itself', () => {
    const b = clone(build());
    b.leaves.reverse();
    expect(verdict(b).verdict).toBe('verified');
  });
});

describe('with no signing key', () => {
  beforeEach(() => vi.stubEnv('ALMSTINS_SIGNING_KEY', ''));

  it('the bundle is unsigned and says so: no signature, no key id, and it reads as intact but unverifiable', () => {
    const b = build();
    expect(b.signature).toBeNull();
    expect(b.manifest.signing_key_id).toBeNull();
    expect(verifyReportBundle(b)).toMatchObject({ verdict: 'unverifiable', code: 'unsigned' });
  });

  it('a signed bundle cannot be verified without a published key: unverifiable, never verified', () => {
    vi.stubEnv('ALMSTINS_SIGNING_KEY', randomBytes(32).toString('hex'));
    const b = build();
    vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
    expect(verifyReportBundle(b)).toMatchObject({ verdict: 'unverifiable', code: 'unknown_key' });
  });
});

describe('a stored report\'s bundle is rebuilt from what was stored', () => {
  it('gives the same leaves, hashes and root as the bundle that was signed', () => {
    const c = content();
    const original = build({ content: c });
    const rebuilt = bundleFromStored(c, { manifest: original.manifest, signature: { keyId: original.signature!.key_id, signatureHex: original.signature!.signature_hex } })!;
    expect(rebuilt.leaves).toEqual(original.leaves);
    expect(rebuilt.leaf_hashes).toEqual(original.leaf_hashes);
    expect(rebuilt.manifest.merkle_root).toBe(original.manifest.merkle_root);
    expect(verifyReportBundle(rebuilt).verdict).toBe('verified');
  });

  it('is nothing at all when the report was stored without a manifest', () => {
    expect(bundleFromStored(content(), { manifest: null, signature: null })).toBeNull();
  });
});

describe('the checkers that read a Year Summary proof read this one', () => {
  it('POST /api/verify-record, the public verifier, says verified for a genuine bundle and tampered for an altered one', async () => {
    const { POST } = await import('../../src/pages/api/verify-record');
    const ask = async (body: unknown) => {
      const res = (await POST({ request: new Request('https://almstins.test/api/verify-record', { method: 'POST', body: JSON.stringify(body) }) } as never)) as Response;
      return res.json();
    };
    const good = await ask(build());
    expect(good.outcome.verdict).toBe('verified');
    expect(good.manifest.record_type).toBe('agent_report');
    const bad = clone(build());
    (bad.leaves.find((l: any) => l.kind === 'address') as any).address = addr(8);
    expect((await ask(bad)).outcome.verdict).toBe('tampered');
  });

  it('the offline script verifies a genuine bundle (exit 0) and rejects an altered one (exit 1), with no network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'almstins-report-'));
    try {
      const pub = getPublicKeyHex()!;
      const run = (file: string) => execFileSync('node', ['scripts/verify-record.mjs', file, '--pubkey', pub], { encoding: 'utf8' });
      const good = join(dir, 'good.json');
      writeFileSync(good, JSON.stringify(build()));
      expect(run(good)).toContain('VERIFIED');
      expect(run(good)).toContain('agent_report');

      const altered = clone(build());
      (altered.leaves.find((l: any) => l.kind === 'summary') as any).issues_addresses = 0;
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, JSON.stringify(altered));
      let failed = false;
      try {
        run(bad);
      } catch (e) {
        failed = true;
        const err = e as { stdout?: string; stderr?: string };
        expect(`${err.stdout ?? ''}${err.stderr ?? ''}`).toContain('TAMPERED');
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
