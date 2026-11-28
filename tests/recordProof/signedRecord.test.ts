import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalManifestBytes, signManifestWithKey } from '@/lib/recordProof/signing';
import { buildRecordProofFile } from '@/lib/receivables/server/proofFile';
import { verifySignedRecord, isSignedRecordFile, SIGNED_RECORD_FORMAT, type SignedRecordCode } from '@/lib/recordProof/signedRecord';
import type { PublishedKey } from '@/lib/recordProof/verify';

ed.hashes.sha512 = sha512;

/**
 * The public checker reads a receivables proof file (proof_format 'almstins-signed-record/v1'),
 * the file /api/verify/receivables/proof-file hands out. Every verdict is checked on a real file
 * built by the same code as the download, and the in-app check must agree with
 * scripts/verify-record.mjs on each one. All values are invented.
 */

let keys: PublishedKey[];
let pub: string;
let dir: string;

function makeFile(withAnchor = true) {
  const manifest = { v: 1, kind: 'receivable', receivable: { supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-001', face: 1234.5, currency: 'USD' } };
  const bytes = canonicalManifestBytes(manifest);
  const sig = signManifestWithKey(bytes)!;
  const digest = createHash('sha256').update(bytes).digest('hex');
  return buildRecordProofFile('receivable', digest, {
    manifestJson: JSON.stringify(manifest),
    signatureJson: JSON.stringify({ keyId: sig.keyId, alg: sig.alg, signatureHex: sig.signatureHex, publicKeyHex: sig.publicKeyHex }),
    digest,
    anchorJson: withAnchor
      ? JSON.stringify({ type: 'opentimestamps', digest, receipt: Buffer.from('test-ots-bytes').toString('base64'), anchoredAt: '2026-03-01T10:00:00.000Z' })
      : null,
  })! as any;
}

beforeAll(() => {
  process.env.ALMSTINS_SIGNING_KEY = bytesToHex(ed.utils.randomSecretKey());
  const f = makeFile();
  pub = f.signature.public_key_hex;
  keys = [{ key_id: f.signature.key_id, public_key_hex: pub }];
  dir = mkdtempSync(join(tmpdir(), 'almstins-signed-record-'));
});
afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

const otherKey = () => bytesToHex(ed.getPublicKey(ed.utils.randomSecretKey()));

/** Each case: a change to a genuine file, and the verdict and code it must get. */
const CASES: Array<{ name: string; change: (f: any) => void; verdict: string; code: SignedRecordCode }> = [
  { name: 'a genuine file', change: () => {}, verdict: 'verified', code: 'ok' },
  { name: 'a changed manifest', change: (f) => { f.manifest.receivable.face = 99999; }, verdict: 'tampered', code: 'digest_mismatch' },
  { name: 'a changed digest', change: (f) => { f.digest = 'a'.repeat(64); }, verdict: 'tampered', code: 'digest_mismatch' },
  { name: 'a Bitcoin proof for another digest', change: (f) => { f.anchor.digest = 'b'.repeat(64); }, verdict: 'tampered', code: 'anchor_mismatch' },
  { name: 'a swapped public key', change: (f) => { f.signature.public_key_hex = otherKey(); }, verdict: 'tampered', code: 'key_mismatch' },
  { name: 'a broken signature', change: (f) => { f.signature.signature_hex = 'c'.repeat(128); }, verdict: 'tampered', code: 'bad_signature' },
  { name: 'no signature', change: (f) => { f.signature = null; }, verdict: 'unverifiable', code: 'unsigned' },
  { name: 'a key id nobody published', change: (f) => { f.signature.key_id = 'almstins-0000000000000000'; }, verdict: 'unverifiable', code: 'unknown_key' },
];

describe('verifySignedRecord', () => {
  it.each(CASES)('$name: $verdict ($code)', ({ change, verdict, code }) => {
    const f = makeFile();
    change(f);
    const outcome = verifySignedRecord(f, keys);
    expect(outcome.verdict).toBe(verdict);
    expect(outcome.code).toBe(code);
  });

  it('a file with no Bitcoin proof still verifies, and says the proof is absent', () => {
    const outcome = verifySignedRecord(makeFile(false), keys);
    expect(outcome.verdict).toBe('verified');
    expect(outcome.checks.anchor_present).toBe(false);
  });

  it('anything that is not a signed record file is malformed, never a throw', () => {
    for (const x of [null, 'x', {}, { proof_format: SIGNED_RECORD_FORMAT }, { proof_format: SIGNED_RECORD_FORMAT, manifest: 'x', digest: 'y' }]) {
      expect(verifySignedRecord(x, keys).code).toBe('malformed');
    }
  });

  it('tells a record file from a Year Summary bundle by its format name', () => {
    expect(isSignedRecordFile(makeFile())).toBe(true);
    expect(isSignedRecordFile({ manifest: {}, leaves: [] })).toBe(false);
  });
});

describe('agrees with scripts/verify-record.mjs', () => {
  it.each(CASES.filter((c) => c.code !== 'unknown_key'))('$name', ({ name, change, verdict }) => {
    const f = makeFile();
    change(f);
    const path = join(dir, `${name.replace(/\W+/g, '-')}.proof.json`);
    writeFileSync(path, JSON.stringify(f));
    const r = spawnSync('node', ['scripts/verify-record.mjs', path, '--pubkey', pub], { encoding: 'utf8' });
    const text = (r.stdout ?? '') + (r.stderr ?? '');
    if (verdict === 'verified') {
      expect(r.status).toBe(0);
      expect(text).toContain('VERIFIED');
    } else {
      expect(r.status).toBe(1);
      expect(text).toContain(verdict === 'tampered' ? 'TAMPERED' : 'UNVERIFIABLE');
    }
  });
});

describe('POST /api/verify-record', () => {
  const post = async (body: unknown) => {
    const mod: any = await import('../../src/pages/api/verify-record.ts');
    const res: Response = await mod.POST({ request: new Request('https://almstins.com/api/verify-record', { method: 'POST', body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };

  it('checks a receivables proof file against the published keys', async () => {
    const r = await post(makeFile());
    expect(r.status).toBe(200);
    expect(r.body.outcome.verdict).toBe('verified');
  });

  it('reports a changed file as tampered', async () => {
    const f = makeFile();
    f.manifest.receivable.invoiceNo = 'TEST-002';
    const r = await post(f);
    expect(r.body.outcome.code).toBe('digest_mismatch');
  });
});

describe('the result on /verify-record', () => {
  let RecordResult: typeof import('../../src/components/recordProof/VerifyRecord').RecordResult;
  beforeAll(async () => {
    (globalThis as { React?: typeof React }).React = React;
    RecordResult = (await import('../../src/components/recordProof/VerifyRecord')).RecordResult;
  });

  it('names the record, its fingerprint and the Bitcoin proof, and says what it does not check', () => {
    const f = makeFile();
    const html = renderToStaticMarkup(React.createElement(RecordResult, { file: f, outcome: verifySignedRecord(f, keys), keySource: 'published key (almstins.com/.well-known)' }));
    expect(html).toContain('Genuine, unaltered Almstins record');
    expect(html).toContain('Receivable');
    expect(html).toContain(f.digest);
    expect(html).toContain('The file says Bitcoin confirmed it at 2026-03-01T10:00:00.000Z');
    expect(html).toContain('Not checked here');
    expect(html).toContain('verify-without-almstins.md');
  });
});
