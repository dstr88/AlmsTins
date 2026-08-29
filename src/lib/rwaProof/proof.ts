// Build + verify scope-explicit proofs (Phase 1, see claudeRWA.md).
//
// Reuses the shipped record-proof engine: the domain-separated SHA-256 Merkle
// tree (merkle.ts) and Ed25519 signing over RFC-8785 canonical JSON (signing.ts).
// Almstins signs with its OWN key and never touches a user key.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import {
  hashLeaf,
  buildMerkleRoot,
  buildInclusionProof,
  verifyInclusionProof,
  toHex,
  type Hex,
  type InclusionProof,
} from '@/lib/recordProof/merkle';
import {
  canonicalManifestBytes,
  signManifest,
  verifyManifestSignature,
  getPublicKeyHex,
  getSigningKeyId,
} from '@/lib/recordProof/signing';
import type { Anchor } from './anchor';
import type { ProofClaim, SignedManifest, ScopedProof, VerifyResult, AnchorReceipt } from './types';

const ISSUER_DEFAULT = 'Almstins';

/** Canonical bytes of a record → domain-separated Merkle leaf hash. */
function leafHashOf(record: unknown): Uint8Array {
  const json = canonicalize(record as object);
  if (json === undefined) throw new Error('rwaProof: record did not canonicalize');
  return hashLeaf(utf8ToBytes(json));
}

/** Merkle root (hex) over an ordered record set. The order is part of the commitment. */
export function recordSetRoot(records: unknown[]): Hex {
  return toHex(buildMerkleRoot(records.map(leafHashOf)));
}

/** Inclusion proof that `records[index]` is committed under the set's root. */
export function proveRecordInclusion(records: unknown[], index: number): InclusionProof {
  return buildInclusionProof(records.map(leafHashOf), index);
}

/** Verify one record is in the set committed by `merkleRoot`. Any changed field breaks this. */
export function verifyRecordInclusion(record: unknown, proof: InclusionProof, merkleRoot: Hex): boolean {
  return verifyInclusionProof(leafHashOf(record), proof, merkleRoot);
}

/** sha256 hex of the canonical signed manifest — the value an Anchor pins. */
export function manifestDigest(manifest: SignedManifest): Hex {
  return bytesToHex(sha256(canonicalManifestBytes(manifest)));
}

export interface BuildOpts {
  claim: ProofClaim;
  records: unknown[];
  /** Defaults to now. Bound into both the signature and the anchor. */
  provenAt?: string;
  /** When provided, the manifest digest is anchored to independent time. */
  anchor?: Anchor;
  issuerName?: string;
}

/**
 * Build a scope-explicit, signed, optionally anchored proof over a record set.
 * The signature covers claim + issuer + provenAt + merkleRoot; the anchor pins the
 * digest of that exact manifest, so provenAt cannot be backdated without breaking both.
 * Returns an unsigned proof (signatureHex: null) when no signing key is configured — fail-open on availability, never on trust.
 */
export async function buildScopedProof(opts: BuildOpts): Promise<ScopedProof> {
  const manifest: SignedManifest = {
    v: 1,
    claim: opts.claim,
    issuer: { name: opts.issuerName ?? ISSUER_DEFAULT, keyId: getSigningKeyId(), publicKeyHex: getPublicKeyHex() },
    provenAt: opts.provenAt ?? new Date().toISOString(),
    merkleRoot: recordSetRoot(opts.records),
    alg: 'Ed25519',
  };
  const sig = signManifest(canonicalManifestBytes(manifest));
  let anchor: AnchorReceipt | null = null;
  if (opts.anchor) anchor = await opts.anchor.stamp(manifestDigest(manifest));
  return { ...manifest, anchor, signatureHex: sig ? sig.signatureHex : null };
}

export interface VerifyOpts {
  /** Override public key; else use the one embedded in the proof, then the env key. */
  publicKeyHex?: string;
  /** Required to validate an anchor receipt. Without it, a present anchor is reported 'unverified' (→ not ok). */
  anchor?: Anchor;
}

/**
 * Verify a scoped proof. Fail-safe: `ok` is true only when the signature is valid
 * AND any anchor present validated. A proof carrying an anchor you cannot check is
 * NOT ok — you never silently drop an unverified trust claim.
 */
export async function verifyScopedProof(proof: ScopedProof, opts: VerifyOpts = {}): Promise<VerifyResult> {
  const notes: string[] = [];
  const { anchor: anchorReceipt, signatureHex, ...manifestRest } = proof;
  const manifest = manifestRest as SignedManifest;
  const bytes = canonicalManifestBytes(manifest);

  // signature
  const pub = opts.publicKeyHex ?? proof.issuer.publicKeyHex ?? getPublicKeyHex() ?? null;
  let signature: VerifyResult['signature'];
  if (!signatureHex) {
    signature = 'unsigned';
    notes.push('proof is unsigned (no signing key was configured when it was built)');
  } else if (!pub) {
    signature = 'no-pubkey';
    notes.push('no public key available to verify the signature');
  } else {
    signature = verifyManifestSignature(bytes, signatureHex, pub) ? 'valid' : 'invalid';
    if (signature === 'invalid') notes.push('signature does not match manifest (tampered or wrong key)');
  }

  // anchor
  let anchor: VerifyResult['anchor'] = 'none';
  let anchoredAt: string | null = null;
  if (anchorReceipt) {
    const digest = manifestDigest(manifest);
    if (anchorReceipt.digest.toLowerCase() !== digest.toLowerCase()) {
      anchor = 'digest-mismatch';
      notes.push('anchor digest does not match the manifest — provenAt or contents were changed after anchoring');
    } else if (!opts.anchor) {
      anchor = 'unverified';
      notes.push('anchor present but no verifier Anchor supplied — cannot confirm independent timestamp');
    } else {
      const r = await opts.anchor.verify(digest, anchorReceipt);
      anchor = r.ok ? 'valid' : 'invalid';
      anchoredAt = r.anchoredAt;
      if (!r.ok) notes.push('anchor receipt failed independent verification');
    }
  }

  const ok = signature === 'valid' && (anchor === 'valid' || anchor === 'none');
  return { ok, signature, anchor, anchoredAt, claim: proof.claim, notes };
}
