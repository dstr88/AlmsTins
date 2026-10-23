/**
 * A receivables record's proof file: everything a stranger needs to check the record with no
 * help from almstins.com. The signed manifest, its digest and Almstins signature, the public key
 * that made it, and the Bitcoin timestamp (the OpenTimestamps .ots proof). Plus where the public
 * key log lives, which says whether that key was genuine and still trusted at the time.
 *
 * The record belongs to the person: the parties who can see a record get the evidence for it.
 * Nothing here is new data. It is the stored row, reshaped, and it is handed only to the tenant
 * that owns the row (getRecordProofSource is tenant-scoped). No identity is added, nothing is
 * re-signed, and the manifest is returned exactly as stored, so its canonical bytes still hash
 * to the digest the signature and the anchor cover.
 *
 * Checked by scripts/verify-record.mjs; the recipe is docs/verify-without-almstins.md.
 */
import { createHash } from 'node:crypto';
import { canonicalManifestBytes, getPublishedKeys } from '@/lib/recordProof/signing';
import type { AnchorRecordKind } from '@/lib/receivables/anchorSpec';

export const RECORD_PROOF_FORMAT = 'almstins-signed-record/v1' as const;
/** The public, append-only key log (scripts/keylog.mjs). Almstins does not serve it. */
export const KEY_LOG_URL = 'https://github.com/dstr88/almstins-keys';

export interface RecordProofFile {
  proof_format: typeof RECORD_PROOF_FORMAT;
  product: 'receivables';
  kind: AnchorRecordKind;
  record_id: string;
  /** Exactly what was signed. sha256 of its RFC 8785 (JCS) canonical bytes is `digest`. */
  manifest: unknown;
  digest: string;
  signature: { alg: 'Ed25519'; key_id: string; public_key_hex: string | null; signature_hex: string } | null;
  /** The record's Bitcoin timestamp. It covers the digest (the content), not the signature. */
  anchor: { type: 'opentimestamps'; digest: string; ots_base64: string; bitcoin_time: string | null } | null;
  /** Phase 2: the hourly checkpoint that anchors the signature itself. Null until it ships. */
  signature_checkpoint: null;
  key_log: { url: string; note: string };
  disclaimer: string;
}

const DISCLAIMER =
  'This file shows that Almstins signed this record and when its content existed. It does not ' +
  'show that the facts in it are true, that a debt is owed or paid, or anything about who is ' +
  'behind any party named in it.';

const KEY_LOG_NOTE =
  'Check that signature.key_id is listed in this public log, signed by the Almstins root key, ' +
  'and was not revoked before this record is shown to exist. Steps: docs/verify-without-almstins.md ' +
  'in github.com/dstr88/AlmsTins.';

const sha256hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const parse = (s: string | null): any => {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
};

/**
 * Build the proof file for one stored record, or null when the stored manifest is unreadable or
 * does not hash to the stored digest (a file that would fail its own check is never handed out).
 */
export function buildRecordProofFile(
  kind: AnchorRecordKind,
  recordId: string,
  src: { manifestJson: string; signatureJson: string | null; digest: string; anchorJson: string | null },
): RecordProofFile | null {
  const manifest = parse(src.manifestJson);
  if (manifest == null || typeof manifest !== 'object') return null;
  const digest = String(src.digest).toLowerCase();
  if (sha256hex(canonicalManifestBytes(manifest)) !== digest) return null;

  const sig = parse(src.signatureJson);
  let signature: RecordProofFile['signature'] = null;
  if (sig && typeof sig.keyId === 'string' && typeof sig.signatureHex === 'string') {
    // Rows signed before the public key was stored beside the signature name only the key id;
    // the published list supplies the key for those, and null says it was not found.
    const pub = typeof sig.publicKeyHex === 'string' ? sig.publicKeyHex.toLowerCase()
      : getPublishedKeys().find((k) => k.key_id === sig.keyId)?.public_key_hex ?? null;
    signature = { alg: 'Ed25519', key_id: sig.keyId, public_key_hex: pub, signature_hex: sig.signatureHex.toLowerCase() };
  }

  const receipt = parse(src.anchorJson);
  const anchor: RecordProofFile['anchor'] =
    receipt && receipt.type === 'opentimestamps' && typeof receipt.receipt === 'string'
      && String(receipt.digest).toLowerCase() === digest
      ? { type: 'opentimestamps', digest, ots_base64: receipt.receipt, bitcoin_time: receipt.anchoredAt ?? null }
      : null;

  return {
    proof_format: RECORD_PROOF_FORMAT,
    product: 'receivables',
    kind,
    record_id: recordId,
    manifest,
    digest,
    signature,
    anchor,
    signature_checkpoint: null,
    key_log: { url: KEY_LOG_URL, note: KEY_LOG_NOTE },
    disclaimer: DISCLAIMER,
  };
}
