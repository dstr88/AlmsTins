// The pure verification core — shared by the browser verify page, the server API,
// and the standalone offline script. FULLY ISOMORPHIC: imports only @noble +
// canonicalize + the (isomorphic) merkle/leaf modules; NO node:crypto, Buffer, or
// process.env, and only TYPE imports from buildProof.ts (so the server-only
// signing/randomUUID code never reaches the browser bundle).
//
// verifyBundle answers, from the bundle ALONE: is the Merkle root genuinely the
// commitment over these leaves, and is the signed manifest authentic against a
// published Almstins key? Structured verdicts/codes, never prose.

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { hashLeaf, buildMerkleRoot, buildInclusionProof, verifyInclusionProof, toHex } from './merkle';
import { orderLeaves, serializeLeaf } from './leaf';
import type { ProofBundle, ProofManifest } from './buildProof';

ed.hashes.sha512 = sha512;

export type Verdict = 'verified' | 'unverifiable' | 'tampered';
export type VerifyCode =
  | 'ok' | 'root_mismatch' | 'leaf_count_mismatch' | 'bad_signature'
  | 'unknown_key' | 'unsigned' | 'malformed';

export interface PublishedKey { key_id: string; public_key_hex: string; }

export interface VerifyOutcome {
  verdict: Verdict;
  code: VerifyCode;
  checks: {
    root_recomputed: boolean;
    leaf_count_match: boolean;
    signature_valid: boolean | null; // null = not checked (unsigned / unknown key)
    key_published: boolean | null;
  };
  recomputed_root: string | null;
  generated_at: string | null;
}

/** The signed surface — the manifest minus purely presentational fields. */
function signedManifestView(m: ProofManifest): Omit<ProofManifest, 'verify_url' | 'disclaimer'> {
  const { verify_url: _v, disclaimer: _d, ...signed } = m;
  return signed;
}

function canonicalBytes(obj: unknown): Uint8Array {
  const json = canonicalize(obj);
  if (json === undefined) throw new Error('verify: canonicalize returned undefined');
  return utf8ToBytes(json);
}

function verifySig(bytes: Uint8Array, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed.verify(hexToBytes(signatureHex), bytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/**
 * Verify a proof bundle end-to-end. Defensively re-orders the leaves (never trusts
 * the file's order), recomputes the root, and checks the Ed25519 signature against
 * a published key. Verdict: root/sig broken → 'tampered'; root ok but unsigned /
 * unknown key → 'unverifiable'; all good → 'verified'.
 */
export function verifyBundle(bundle: ProofBundle, publishedKeys: PublishedKey[] = []): VerifyOutcome {
  const base = (
    verdict: Verdict, code: VerifyCode,
    checks: Partial<VerifyOutcome['checks']>, recomputed: string | null, generatedAt: string | null,
  ): VerifyOutcome => ({
    verdict, code,
    checks: { root_recomputed: false, leaf_count_match: false, signature_valid: null, key_published: null, ...checks },
    recomputed_root: recomputed, generated_at: generatedAt,
  });

  if (!bundle || typeof bundle !== 'object' || !bundle.manifest || !Array.isArray(bundle.leaves)) {
    return base('unverifiable', 'malformed', {}, null, null);
  }
  const m = bundle.manifest;
  const gen = m.generated_at ?? null;

  const leaves = orderLeaves(bundle.leaves);
  let recomputed: string;
  try {
    recomputed = toHex(buildMerkleRoot(leaves.map((l) => hashLeaf(serializeLeaf(l)))));
  } catch {
    return base('unverifiable', 'malformed', {}, null, gen);
  }
  const rootOk = recomputed === String(m.merkle_root).toLowerCase();
  const countOk = leaves.length === m.leaf_count;

  if (!rootOk) return base('tampered', 'root_mismatch', { root_recomputed: false, leaf_count_match: countOk }, recomputed, gen);
  if (!countOk) return base('tampered', 'leaf_count_mismatch', { root_recomputed: true, leaf_count_match: false }, recomputed, gen);

  if (!bundle.signature) {
    return base('unverifiable', 'unsigned', { root_recomputed: true, leaf_count_match: true }, recomputed, gen);
  }
  const key = publishedKeys.find((k) => k.key_id === bundle.signature!.key_id);
  if (!key) {
    return base('unverifiable', 'unknown_key', { root_recomputed: true, leaf_count_match: true, key_published: false }, recomputed, gen);
  }
  const sigOk = verifySig(canonicalBytes(signedManifestView(m)), bundle.signature.signature_hex, key.public_key_hex);
  if (!sigOk) {
    return base('tampered', 'bad_signature', { root_recomputed: true, leaf_count_match: true, signature_valid: false, key_published: true }, recomputed, gen);
  }
  return base('verified', 'ok', { root_recomputed: true, leaf_count_match: true, signature_valid: true, key_published: true }, recomputed, gen);
}

/**
 * Selective disclosure: confirm the leaf at `leafIndex` (ordered) is committed in
 * the signed Merkle root — provable without revealing the other leaves' content.
 */
export function verifyInclusion(bundle: ProofBundle, leafIndex: number): boolean {
  const leaves = orderLeaves(bundle.leaves);
  if (leafIndex < 0 || leafIndex >= leaves.length) return false;
  const hashes = leaves.map((l) => hashLeaf(serializeLeaf(l)));
  const proof = buildInclusionProof(hashes, leafIndex);
  return verifyInclusionProof(hashes[leafIndex], proof, String(bundle.manifest.merkle_root));
}

/** Period chaining: a record's prev_root must equal the prior record's merkle_root. */
export function verifyChainLink(prevRoot: string | null, manifest: ProofManifest): boolean {
  return (manifest.prev_root ?? null) === (prevRoot ?? null);
}
