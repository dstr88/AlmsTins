import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

import { buildRecordProof } from '@/lib/recordProof/buildProof';
import { getPublicKeyHex, getSigningKeyId } from '@/lib/recordProof/signing';
import { verifyBundle, verifyInclusion, verifyChainLink, type PublishedKey } from '@/lib/recordProof/verify';
import { sampleBreakdown } from './_fixture';

const seedB64 = Buffer.from(ed.utils.randomSecretKey()).toString('base64');
const GEN = '2024-07-01T00:00:00.000Z';
const mkProof = (prev: string | null = null) => buildRecordProof('tenant-x', 2024, sampleBreakdown(), prev, GEN);

describe('verifyBundle', () => {
  let keys: PublishedKey[];
  beforeAll(() => {
    process.env.ALMSTINS_SIGNING_KEY = seedB64;
    keys = [{ key_id: getSigningKeyId()!, public_key_hex: getPublicKeyHex()! }];
  });
  afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

  it('a genuine bundle → verified', () => {
    const o = verifyBundle(mkProof(), keys);
    expect(o.verdict).toBe('verified');
    expect(o.code).toBe('ok');
    expect(o.checks).toMatchObject({ root_recomputed: true, leaf_count_match: true, signature_valid: true, key_published: true });
  });

  it('leaves reordered in the file → still verified (defensive re-order)', () => {
    const p = mkProof();
    p.leaves.reverse();
    expect(verifyBundle(p, keys).verdict).toBe('verified');
  });

  it('a tampered leaf → tampered / root_mismatch', () => {
    const p = mkProof();
    p.leaves[0] = { ...p.leaves[0], gain_usd: '999999' };
    const o = verifyBundle(p, keys);
    expect(o.verdict).toBe('tampered');
    expect(o.code).toBe('root_mismatch');
  });

  it('unsigned bundle → unverifiable / unsigned', () => {
    const p = mkProof();
    p.signature = null;
    expect(verifyBundle(p, keys).code).toBe('unsigned');
  });

  it('signed but no published key → unverifiable / unknown_key', () => {
    expect(verifyBundle(mkProof(), []).code).toBe('unknown_key');
  });

  it('manifest changed without re-signing (root intact) → tampered / bad_signature', () => {
    const p = mkProof();
    p.manifest = { ...p.manifest, period: '2099' };
    const o = verifyBundle(p, keys);
    expect(o.verdict).toBe('tampered');
    expect(o.code).toBe('bad_signature');
  });

  it('a non-bundle → unverifiable / malformed', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(verifyBundle({} as any, keys).code).toBe('malformed');
  });
});

describe('verifyInclusion + verifyChainLink', () => {
  beforeAll(() => { process.env.ALMSTINS_SIGNING_KEY = seedB64; });
  afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

  it('every leaf proves inclusion; a tampered leaf does not', () => {
    const p = mkProof();
    for (let i = 0; i < p.leaves.length; i++) expect(verifyInclusion(p, i)).toBe(true);
    p.leaves[0] = { ...p.leaves[0], asset: 'EVIL' };
    expect(verifyInclusion(p, 0)).toBe(false);
  });

  it('chain link matches prev_root', () => {
    const prev = 'a'.repeat(64);
    expect(verifyChainLink(prev, mkProof(prev).manifest)).toBe(true);
    expect(verifyChainLink('b'.repeat(64), mkProof(prev).manifest)).toBe(false);
    expect(verifyChainLink(null, mkProof(null).manifest)).toBe(true);
  });
});
