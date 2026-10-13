// Phase 1 RWA verification layer (claudeRWA.md). These tests double as the
// walkthrough demo: a scope-explicit proof, tamper detection on the record set,
// signature tamper detection, and independent-timestamp binding via an Anchor.

import { describe, it, expect, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

import {
  buildScopedProof,
  verifyScopedProof,
  recordSetRoot,
  proveRecordInclusion,
  verifyRecordInclusion,
  LocalAnchor,
  type ScopedProof,
  type ProofClaim,
} from '@/lib/rwaProof';

// Fixed 32-byte Ed25519 seed so the whole suite is deterministic. signing.ts
// reads ALMSTINS_SIGNING_KEY from process.env at call time, so setting it here
// exercises the real production signing path.
const SEED_HEX = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const FIXED_CLOCK = '2026-08-27T00:00:00.000Z';

beforeAll(() => {
  process.env.ALMSTINS_SIGNING_KEY = SEED_HEX;
  delete process.env.ALMSTINS_SIGNING_PUBKEY;
});

const controlClaim: ProofClaim = {
  kind: 'control',
  subject: '0x39a21f6ca442b9f01108b52515b9aa508f3baaa6',
  statement:
    'The holder proved control of this address via a self-send. This attests control only — not legal ownership of any underlying asset, and not that the address is safe.',
};

const records = [
  { event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xaaa', at: '2026-08-20T10:00:00.000Z' },
  { event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xbbb', at: '2026-08-21T10:00:00.000Z' },
  { event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xccc', at: '2026-08-22T10:00:00.000Z' },
];

describe('rwaProof / scoped proof', () => {
  it('builds a signed, scope-explicit proof that verifies', async () => {
    const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK });
    expect(proof.signatureHex).toBeTruthy();
    expect(proof.claim.statement).toContain('not legal ownership');

    const res = await verifyScopedProof(proof);
    expect(res.signature).toBe('valid');
    expect(res.anchor).toBe('none');
    expect(res.ok).toBe(true);
    // the verifier echoes the exact scope so nothing can be read as more than it is
    expect(res.claim.kind).toBe('control');
  });

  it('commits the record set and proves inclusion; any tampered field breaks it', async () => {
    const root = recordSetRoot(records);
    const proof = proveRecordInclusion(records, 1);
    expect(verifyRecordInclusion(records[1], proof, root)).toBe(true);

    // change one field of the record → inclusion must fail
    const tampered = { ...records[1], amount: '2.00' };
    expect(verifyRecordInclusion(tampered, proof, root)).toBe(false);
  });

  it('detects a tampered manifest (provenAt changed after signing)', async () => {
    const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK });
    const forged: ScopedProof = { ...proof, provenAt: '2020-01-01T00:00:00.000Z' };

    const res = await verifyScopedProof(forged);
    expect(res.signature).toBe('invalid');
    expect(res.ok).toBe(false);
  });

  it('anchors the digest to independent time and verifies it', async () => {
    const anchor = new LocalAnchor(() => FIXED_CLOCK);
    const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK, anchor });
    expect(proof.anchor).toBeTruthy();
    expect(proof.anchor!.type).toBe('local-merkle');

    const res = await verifyScopedProof(proof, { anchor });
    expect(res.signature).toBe('valid');
    expect(res.anchor).toBe('valid');
    expect(res.anchoredAt).toBe(FIXED_CLOCK);
    expect(res.ok).toBe(true);
  });

  it('catches backdating: changing provenAt after anchoring breaks the anchor digest', async () => {
    const anchor = new LocalAnchor(() => FIXED_CLOCK);
    const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK, anchor });

    // attacker rewrites provenAt to look older; the anchored digest no longer matches
    const forged: ScopedProof = { ...proof, provenAt: '2020-01-01T00:00:00.000Z' };
    const res = await verifyScopedProof(forged, { anchor });
    expect(res.anchor).toBe('digest-mismatch');
    expect(res.ok).toBe(false);
  });

  it('is fail-safe: a proof with an anchor but no verifier is not ok', async () => {
    const anchor = new LocalAnchor(() => FIXED_CLOCK);
    const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK, anchor });

    const res = await verifyScopedProof(proof); // no anchor supplied to the verifier
    expect(res.signature).toBe('valid');
    expect(res.anchor).toBe('unverified');
    expect(res.ok).toBe(false); // never silently accept an unchecked trust claim
  });

  it('produces an unsigned proof when no key is configured, and reports it', async () => {
    const saved = process.env.ALMSTINS_SIGNING_KEY;
    delete process.env.ALMSTINS_SIGNING_KEY;
    try {
      const proof = await buildScopedProof({ claim: controlClaim, records, provenAt: FIXED_CLOCK });
      expect(proof.signatureHex).toBeNull();

      const res = await verifyScopedProof(proof);
      expect(res.signature).toBe('unsigned');
      expect(res.ok).toBe(false);
    } finally {
      process.env.ALMSTINS_SIGNING_KEY = saved;
    }
  });
});
