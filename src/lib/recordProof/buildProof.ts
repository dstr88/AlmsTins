// Assemble a signed, verifiable record proof from a Year-Summary breakdown:
//   breakdown → ordered canonical leaves → Merkle root → PII-free manifest →
//   Ed25519 signature over the canonical signed-manifest → bundle.
//
// The bundle ships the full ordered leaves (so it verifies fully OFFLINE) plus
// the ordered leaf hashes (the commitments shown on verification surfaces).
// The MANIFEST — the signed, travelling part — carries NO PII: an opaque
// record_id + an opaque tenant tag + the root + counts. No addresses/emails/names.

import { randomUUID } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { AnnualBreakdown } from '@/lib/annualBreakdown';
import { leavesFromBreakdown } from './leavesFromBreakdown';
import { orderLeaves, serializeLeaf, type CanonicalLeaf, LEAF_SCHEMA_VERSION } from './leaf';
import { hashLeaf, buildMerkleRoot, toHex, type Hex } from './merkle';
import { signManifest, getSigningKeyId, canonicalManifestBytes } from './signing';

export const PROOF_FORMAT = 'almstins-merkle-v1';
export const TREE_ALGO = 'sha256-merkle-v1';
export const DISCLAIMER =
  "This proof attests INTEGRITY (these report lines are unaltered), ORIGIN (signed by Almstins' " +
  'published key), and reproducibility (the figures re-compute from the same inputs under the published ' +
  'method). It does NOT attest tax CORRECTNESS, completeness of your records, or fitness for filing.';

const APP_BASE = process.env.APP_URL ?? 'https://almstins.com';

export interface ProofManifest {
  v: number;
  record_id: string;
  tenant_scope_tag: string;
  record_type: 'year_summary';
  period: string;
  data_source: 'lifecycle' | 'pipeline';
  merkle_root: Hex;
  leaf_count: number;
  leaf_schema_version: number;
  tree_algo: string;
  counts: { short_term: number; long_term: number; income: number; held: number; unsettled: number };
  prev_root: Hex | null;
  generated_at: string;
  signing_key_id: string | null;
  schema_version: string;
  verify_url: string;
  disclaimer: string;
}

export interface ProofBundle {
  manifest: ProofManifest;
  signature: { alg: 'Ed25519'; key_id: string; signature_hex: string } | null;
  leaves: CanonicalLeaf[]; // ordered — the frozen snapshot, for offline verification
  leaf_hashes: Hex[];      // ordered leaf hashes — the displayed commitments
  proof_format: string;
}

/** Opaque, non-reversible tenant correlation tag (NOT the tenant_id, NOT PII). */
export function tenantScopeTag(tenantId: string): string {
  return 'tst-' + bytesToHex(sha256(utf8ToBytes('almstins-record-tenant-tag:' + tenantId))).slice(0, 24);
}

/** The signed surface: the manifest minus purely presentational fields. */
export function signedManifestView(m: ProofManifest): Omit<ProofManifest, 'verify_url' | 'disclaimer'> {
  const { verify_url: _v, disclaimer: _d, ...signed } = m;
  return signed;
}

export function buildRecordProof(
  tenantId: string,
  year: number,
  bd: AnnualBreakdown,
  prevRoot: Hex | null,
  generatedAt: string,
): ProofBundle {
  const leaves = orderLeaves(leavesFromBreakdown(bd));
  const leafHashes = leaves.map((l) => hashLeaf(serializeLeaf(l)));
  const root = toHex(buildMerkleRoot(leafHashes));

  const manifest: ProofManifest = {
    v: 1,
    record_id: randomUUID(),
    tenant_scope_tag: tenantScopeTag(tenantId),
    record_type: 'year_summary',
    period: String(year),
    data_source: bd.dataSource,
    merkle_root: root,
    leaf_count: leaves.length,
    leaf_schema_version: LEAF_SCHEMA_VERSION,
    tree_algo: TREE_ALGO,
    counts: {
      short_term: bd.shortTerm.length,
      long_term: bd.longTerm.length,
      income: bd.income.length + bd.cardRebates.length,
      held: bd.stillHolding.length,
      unsettled: bd.needsAttention.length,
    },
    prev_root: prevRoot,
    generated_at: generatedAt,
    signing_key_id: getSigningKeyId(),
    schema_version: '1',
    verify_url: `${APP_BASE}/verify-record`,
    disclaimer: DISCLAIMER,
  };

  const sig = signManifest(canonicalManifestBytes(signedManifestView(manifest)));
  const signature = sig ? { alg: sig.alg, key_id: sig.keyId, signature_hex: sig.signatureHex } : null;

  return { manifest, signature, leaves, leaf_hashes: leaves.map((_, i) => toHex(leafHashes[i])), proof_format: PROOF_FORMAT };
}
