// Re-verify a stored record from the FROZEN snapshot — never from live tables.
// This is what guarantees a report generated in year N still verifies in year N+5,
// independent of how the live dataset changed in between. Tenant-scoped.
//
// (Server-only: imports the DB store + signing. The browser/offline paths use
// verify.ts + the bundle directly.)

import { getStoredRecord } from './store';
import { verifyBundle, type VerifyOutcome, type PublishedKey } from './verify';
import { getPublicKeyHex, getSigningKeyId } from './signing';
import { PROOF_FORMAT, type ProofBundle, type ProofManifest } from './buildProof';

export interface StoredVerification {
  outcome: VerifyOutcome;
  manifest: ProofManifest; // PII-free
}

/** Currently-published Almstins keys (for verifying the stored signature). */
function localPublishedKeys(): PublishedKey[] {
  const pub = getPublicKeyHex();
  const kid = getSigningKeyId();
  return pub && kid ? [{ key_id: kid, public_key_hex: pub }] : [];
}

export async function verifyStoredRecord(tenantId: string, recordId: string): Promise<StoredVerification | null> {
  const rec = await getStoredRecord(tenantId, recordId);
  if (!rec) return null;
  const bundle: ProofBundle = {
    manifest: rec.manifest,
    signature: rec.signatureHex
      ? { alg: 'Ed25519', key_id: rec.manifest.signing_key_id ?? '', signature_hex: rec.signatureHex }
      : null,
    leaves: rec.leaves,
    leaf_hashes: rec.leafHashes,
    proof_format: PROOF_FORMAT,
  };
  return { outcome: verifyBundle(bundle, localPublishedKeys()), manifest: rec.manifest };
}
