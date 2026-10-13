import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

import { buildRecordProof } from '@/lib/recordProof/buildProof';
import { getPublicKeyHex } from '@/lib/recordProof/signing';
import { sampleBreakdown } from './_fixture';

// Parity check: the standalone offline script must agree with the in-app verifier.
describe('scripts/verify-record.mjs (offline)', () => {
  let pub: string;
  let dir: string;
  beforeAll(() => {
    process.env.ALMSTINS_SIGNING_KEY = Buffer.from(ed.utils.randomSecretKey()).toString('base64');
    pub = getPublicKeyHex()!;
    dir = mkdtempSync(join(tmpdir(), 'almstins-verify-'));
  });
  afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

  const runScript = (file: string) =>
    execFileSync('node', ['scripts/verify-record.mjs', file, '--pubkey', pub], { encoding: 'utf8' });

  it('verifies a genuine bundle (exit 0, "VERIFIED")', () => {
    const p = buildRecordProof('t', 2024, sampleBreakdown(), null, '2024-07-01T00:00:00.000Z');
    const f = join(dir, 'good.json');
    writeFileSync(f, JSON.stringify(p));
    expect(runScript(f)).toContain('VERIFIED');
  });

  it('rejects a tampered bundle (exit 1, "TAMPERED"), makes no network call', () => {
    const p = buildRecordProof('t', 2024, sampleBreakdown(), null, '2024-07-01T00:00:00.000Z');
    p.leaves[0] = { ...p.leaves[0], gain_usd: '0.01' };
    const f = join(dir, 'bad.json');
    writeFileSync(f, JSON.stringify(p));
    let failed = false;
    try { runScript(f); } catch (e: unknown) {
      failed = true;
      const err = e as { stdout?: string; stderr?: string };
      expect(`${err.stdout ?? ''}${err.stderr ?? ''}`).toContain('TAMPERED');
    }
    expect(failed).toBe(true);
  });
});
