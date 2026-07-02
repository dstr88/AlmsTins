import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;

import { buildRecordProof, signedManifestView } from '@/lib/recordProof/buildProof';
import { verifyManifestSignature, getPublicKeyHex, canonicalManifestBytes } from '@/lib/recordProof/signing';
import { hashLeaf, buildMerkleRoot, toHex } from '@/lib/recordProof/merkle';
import { serializeLeaf } from '@/lib/recordProof/leaf';
import type { AnnualBreakdown } from '@/lib/annualBreakdown';

const seedB64 = Buffer.from(ed.utils.randomSecretKey()).toString('base64');
const GEN = '2024-07-01T00:00:00.000Z';

const bd = (): AnnualBreakdown => ({
  year: 2024, availableYears: [2024],
  needsAttention: [
    { asset: 'XRP', amount: 100, sellDate: '2024-04-01', proceedsUsd: 50, sourceId: 's1', groupId: 'g1', txHash: '0xfeed', transactionClass: 'other', sourceType: 'Venmo' },
  ],
  stillHolding: [{ asset: 'SOL', amount: 10, acquiredDate: '2024-01-01', costUsd: 1000, daysHeld: 200 }],
  shortTerm: [{ asset: 'ETH', amount: 1.5, buyDate: '2023-12-01', sellDate: '2024-03-01', costUsd: 1800, proceedsUsd: 3000, gainLossUsd: 1200, daysHeld: 91, basisSource: 'recorded' }],
  longTerm: [{ asset: 'BTC', amount: 0.2, buyDate: '2022-01-01', sellDate: '2024-06-01', costUsd: 5000, proceedsUsd: 12000, gainLossUsd: 7000, daysHeld: 882, basisSource: 'estimated' }],
  income: [{ asset: 'ETH', amount: 0.1, usdValue: 300, date: '2024-05-01', kind: 'Staking Income', description: 'reward sent to bob@example.com from 0x1111111111111111111111111111111111111111', priceSource: null, priceAsof: null }],
  cardRebates: [],
  transactionCosts: [], gasByChain: [], feeCoverage: { withFee: 0, total: 0 },
  nftHoldings: [],
  totals: { unsettledProceeds: 50, shortTermGain: 1200, longTermGain: 7000, totalIncome: 300, heldCostBasis: 1000, transactionCostsUsd: 0 },
  dataSource: 'lifecycle', method: 'fifo',
});

describe('buildRecordProof', () => {
  it('deterministic root, correct manifest shape + counts', () => {
    const p1 = buildRecordProof('tenant-1', 2024, bd(), null, GEN);
    const p2 = buildRecordProof('tenant-1', 2024, bd(), null, GEN);
    expect(p1.manifest.merkle_root).toBe(p2.manifest.merkle_root);
    expect(p1.manifest.merkle_root).toMatch(/^[0-9a-f]{64}$/);
    expect(p1.manifest.leaf_count).toBe(5);
    expect(p1.manifest.counts).toEqual({ short_term: 1, long_term: 1, income: 1, held: 1, unsettled: 1 });
    expect(p1.leaves.length).toBe(5);
    expect(p1.leaf_hashes.length).toBe(5);
    // the published root recomputes from the bundle's ordered leaves
    expect(toHex(buildMerkleRoot(p1.leaves.map((l) => hashLeaf(serializeLeaf(l)))))).toBe(p1.manifest.merkle_root);
  });

  it('signs + verifies with a key; null signature without one', () => {
    delete process.env.ALMSTINS_SIGNING_KEY;
    expect(buildRecordProof('t', 2024, bd(), null, GEN).signature).toBeNull();

    process.env.ALMSTINS_SIGNING_KEY = seedB64;
    const p = buildRecordProof('t', 2024, bd(), null, GEN);
    expect(p.signature).not.toBeNull();
    const bytes = canonicalManifestBytes(signedManifestView(p.manifest));
    expect(verifyManifestSignature(bytes, p.signature!.signature_hex, getPublicKeyHex()!)).toBe(true);
    // tampering the root breaks the signature
    const tampered = canonicalManifestBytes({ ...signedManifestView(p.manifest), merkle_root: 'f'.repeat(64) });
    expect(verifyManifestSignature(tampered, p.signature!.signature_hex, getPublicKeyHex()!)).toBe(false);
    delete process.env.ALMSTINS_SIGNING_KEY;
  });

  it('BOUNDARY: manifest carries no PII; keys are the fixed allow-list', () => {
    const p = buildRecordProof('tenant-secret-123', 2024, bd(), null, GEN);
    const json = JSON.stringify(p.manifest);
    expect(json).not.toMatch(/0x[a-fA-F0-9]{40}/);   // no EVM address
    expect(json).not.toMatch(/@/);                    // no email
    expect(json).not.toContain('tenant-secret-123');  // tenant_id never travels
    expect(json).not.toContain('bob@example.com');
    const allow = new Set([
      'v', 'record_id', 'tenant_scope_tag', 'record_type', 'period', 'data_source', 'merkle_root',
      'leaf_count', 'leaf_schema_version', 'tree_algo', 'counts', 'prev_root', 'generated_at',
      'signing_key_id', 'schema_version', 'verify_url', 'disclaimer',
    ]);
    for (const k of Object.keys(p.manifest)) expect(allow.has(k)).toBe(true);
    expect(p.manifest.tenant_scope_tag).toMatch(/^tst-[0-9a-f]{24}$/);
    expect(p.manifest.tenant_scope_tag).not.toContain('tenant-secret-123');
  });

  it('BOUNDARY: leaves exclude free-text descriptions (no address/email leakage)', () => {
    const p = buildRecordProof('t', 2024, bd(), null, GEN);
    const json = JSON.stringify(p.leaves);
    expect(json).not.toContain('bob@example.com');
    expect(json).not.toMatch(/0x[a-fA-F0-9]{40}/); // the description's address never reaches a leaf
    // tx_hash (a public on-chain id) IS allowed in a leaf:
    expect(json).toContain('0xfeed');
  });

  it('prev_root chains', () => {
    const prev = 'deadbeef'.repeat(8);
    expect(buildRecordProof('t', 2024, bd(), prev, GEN).manifest.prev_root).toBe(prev);
  });
});
