// Verifies a signed record proof file (proof_format 'almstins-signed-record/v1'): the
// receivables download made by src/lib/receivables/server/proofFile.ts. One manifest, its
// digest, Almstins' signature over the manifest's canonical bytes, and an optional Bitcoin
// (OpenTimestamps) proof of the digest.
//
// FULLY ISOMORPHIC, like verify.ts: imports only isoSign, so the /verify-record page runs it in
// the browser. The steps mirror verifyRecordFile in scripts/verify-record.mjs; the offlineScript
// test holds the two to the same verdicts.
//
// What it does not check: the Bitcoin proof itself (that needs `ots verify` against Bitcoin, so
// the file's bitcoin_time is a claim and is only shown), and whether the key was revoked (that
// needs the public key log). Structured verdicts and codes, never prose.

import { canonicalBytes, sha256Hex, verifyEd25519 } from './isoSign';
import type { PublishedKey, Verdict } from './verify';

export const SIGNED_RECORD_FORMAT = 'almstins-signed-record/v1' as const;

export type SignedRecordCode =
  | 'ok' | 'digest_mismatch' | 'anchor_mismatch' | 'key_mismatch' | 'bad_signature'
  | 'unknown_key' | 'unsigned' | 'malformed';

/** The parts of the file the check reads. The full shape is RecordProofFile in proofFile.ts. */
export interface SignedRecordFile {
  proof_format: typeof SIGNED_RECORD_FORMAT;
  product?: string;
  kind?: string;
  record_id?: string;
  manifest: unknown;
  digest: string;
  signature: { alg?: string; key_id: string; public_key_hex: string | null; signature_hex: string } | null;
  anchor: { type?: string; digest: string; ots_base64?: string; bitcoin_time: string | null } | null;
  disclaimer?: string;
}

export interface SignedRecordOutcome {
  verdict: Verdict;
  code: SignedRecordCode;
  checks: {
    digest_recomputed: boolean;
    signature_valid: boolean | null; // null = not checked (unsigned / unknown key)
    key_published: boolean | null;
    anchor_present: boolean;
  };
  recomputed_digest: string | null;
}

/** True for a file that says it is a signed record proof file. */
export function isSignedRecordFile(x: unknown): x is SignedRecordFile {
  return !!x && typeof x === 'object' && (x as { proof_format?: unknown }).proof_format === SIGNED_RECORD_FORMAT;
}

/**
 * Check a signed record proof file against the published keys. Order, as in the offline script:
 * the manifest must hash to the file's digest; a Bitcoin proof, if present, must be for that same
 * digest; then the signature over the manifest's canonical bytes must verify under the published
 * key with the file's key id. A file that carries its own public key must carry the published one.
 */
export function verifySignedRecord(file: unknown, publishedKeys: PublishedKey[] = []): SignedRecordOutcome {
  const out = (
    verdict: Verdict, code: SignedRecordCode,
    checks: Partial<SignedRecordOutcome['checks']>, digest: string | null,
  ): SignedRecordOutcome => ({
    verdict, code,
    checks: { digest_recomputed: false, signature_valid: null, key_published: null, anchor_present: false, ...checks },
    recomputed_digest: digest,
  });

  if (!isSignedRecordFile(file) || file.manifest == null || typeof file.manifest !== 'object' || typeof file.digest !== 'string') {
    return out('unverifiable', 'malformed', {}, null);
  }

  let bytes: Uint8Array;
  try { bytes = canonicalBytes(file.manifest); } catch { return out('unverifiable', 'malformed', {}, null); }
  const digest = sha256Hex(bytes);
  const anchorPresent = !!file.anchor;

  if (digest !== file.digest.toLowerCase()) {
    return out('tampered', 'digest_mismatch', { anchor_present: anchorPresent }, digest);
  }
  if (file.anchor && String(file.anchor.digest).toLowerCase() !== digest) {
    return out('tampered', 'anchor_mismatch', { digest_recomputed: true, anchor_present: true }, digest);
  }

  const base = { digest_recomputed: true, anchor_present: anchorPresent };
  const sig = file.signature;
  if (!sig || typeof sig.key_id !== 'string' || typeof sig.signature_hex !== 'string') {
    return out('unverifiable', 'unsigned', base, digest);
  }
  const key = publishedKeys.find((k) => k.key_id === sig.key_id);
  if (!key) return out('unverifiable', 'unknown_key', { ...base, key_published: false }, digest);

  const pub = key.public_key_hex.toLowerCase();
  if (sig.public_key_hex && String(sig.public_key_hex).toLowerCase() !== pub) {
    return out('tampered', 'key_mismatch', { ...base, key_published: true }, digest);
  }
  if (!verifyEd25519(bytes, sig.signature_hex, pub)) {
    return out('tampered', 'bad_signature', { ...base, key_published: true, signature_valid: false }, digest);
  }
  return out('verified', 'ok', { ...base, key_published: true, signature_valid: true }, digest);
}
