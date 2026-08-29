// Phase 1 of the RWA / institutional verification layer (see claudeRWA.md).
//
// A ScopedProof is deliberately narrow: it states EXACTLY what was checked (the
// claim), WHO checked it (issuer), and WHEN (provenAt), signs that, and pins the
// signed digest to an independent Anchor so the date cannot be backdated. The
// point is to make "verifying the unverifiable" impossible: a proof can never be
// read as asserting more than its own `claim.statement`.

import type { Hex } from '@/lib/recordProof/merkle';

/** Precisely what a proof asserts — and, by omission, what it does NOT assert. */
export interface ProofClaim {
  /** Machine tag for the kind of check: e.g. 'control' | 'destination' | 'record-integrity'. */
  kind: string;
  /** The specific subject checked: an address, a domain, a record-set id. */
  subject: string;
  /** Plain-English exact scope of what was verified. This is what the UI must show — never a blanket "Verified". */
  statement: string;
  /** Optional structured detail (kept small; it is part of the signed commitment). */
  detail?: Record<string, unknown>;
}

/** An independent existence proof for a digest, from a source Almstins does not control. */
export interface AnchorReceipt {
  /** 'local-merkle' (reference/test) | 'opentimestamps' | 'rfc3161'. */
  type: string;
  /** The manifest digest (hex sha256) that was anchored. */
  digest: Hex;
  /** Opaque receipt, base64 (e.g. an .ots file, or a local anchor pointer). */
  receipt: string;
  /** Existence-by time from the anchor SOURCE (not our clock). Null until the source confirms (e.g. Bitcoin). */
  anchoredAt: string | null;
}

/** The part of a proof that is signed + anchored (everything except the signature and anchor). */
export interface SignedManifest {
  v: 1;
  claim: ProofClaim;
  issuer: { name: string; keyId: string | null; publicKeyHex: string | null };
  /** ISO datetime the assertion was made (bound into both the signature and the anchor). */
  provenAt: string;
  /** Merkle root over the ordered record set this claim covers. */
  merkleRoot: Hex;
  alg: 'Ed25519';
}

/** A complete, scope-explicit proof. */
export interface ScopedProof extends SignedManifest {
  anchor: AnchorReceipt | null;
  /** Ed25519 signature over the canonical SignedManifest, or null when no signing key is configured. */
  signatureHex: string | null;
}

export interface VerifyResult {
  /** True only when the signature is valid AND any present anchor validated. Fail-safe otherwise. */
  ok: boolean;
  signature: 'valid' | 'invalid' | 'unsigned' | 'no-pubkey';
  anchor: 'valid' | 'invalid' | 'digest-mismatch' | 'unverified' | 'none';
  /** Independent existence-by time, only when an anchor validated. */
  anchoredAt: string | null;
  /** Echoed so no caller can read more into the proof than its stated scope. */
  claim: ProofClaim;
  notes: string[];
}
