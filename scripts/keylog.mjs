// The Almstins key log: a public, append-only, hash-chained list of every record signing key
// Almstins has used, when each started, when it was retired, and when it stopped being trusted.
// It lives in a public repository Almstins does not serve (github.com/dstr88/almstins-keys) and
// its chain head is Bitcoin-anchored after every append, so the record of which keys were
// genuine, and when, survives almstins.com and cannot be quietly rewritten.
//
// TWO KEYS, KEPT APART. Records are signed by the online key (the seed in the Render env). Log
// entries are signed by an OFFLINE root key that only the owner holds and that never touches
// Render, GitHub or this repo. A stolen online seed can sign records but cannot add a key or undo
// a revocation; a compromised GitHub account can edit the file but cannot forge a root signature.
//
// STANDALONE. Imports only @noble and canonicalize, reads no env and makes no network call, so a
// stranger can copy this file with scripts/verify-record.mjs and check a record with nothing
// from Almstins. The owner's tool (scripts/key-log.mjs) and the verifier both use this one copy.
//
// One entry per line of log.jsonl, each line the JCS canonical JSON of:
//   { log, v, seq, prev, type, recorded_at, at, key_id, alg, public_key_hex, reason?, root_sig }
//   log          'almstins-key-log' (domain separation: the root key signs these and nothing else)
//   seq          0, 1, 2, ... with no gaps
//   prev         sha256 of the previous line's canonical bytes; 64 zeros for seq 0
//   type         'root'          seq 0 only: publishes the root public key (self-signed)
//                'root-rotated'  a new root public key; signed by the current root, later
//                                entries are signed by the new one
//                'key-added'     a record signing key; `at` = valid_from
//                'key-retired'   ordinary rotation; `at` = retired_at, the seed is destroyed
//                'key-revoked'   `at` = compromised_since, the EARLIEST moment the key may have
//                                been exposed (may be before recorded_at). Final, never undone
//   recorded_at  when the entry was appended; never decreases along the log
//   root_sig     Ed25519 signature by the current root over the entry's canonical bytes
//                without root_sig
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

ed.hashes.sha512 = sha512;

export const LOG_DOMAIN = 'almstins-key-log';
export const LOG_VERSION = 1;
export const GENESIS_PREV = '0'.repeat(64);
export const ENTRY_TYPES = ['root', 'root-rotated', 'key-added', 'key-retired', 'key-revoked'];

/** A retired key's signatures are accepted when proven up to this long after retired_at: the
 *  anchor cron runs hourly and a stamp can take a few hours to confirm. */
export const RETIRE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** A Bitcoin block's timestamp may run up to about two hours from real time, so a proof only
 *  counts as before a revocation when its block time is at least this much earlier. */
export const BLOCK_TIME_MARGIN_MS = 2 * 60 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const jcs = (obj) => {
  const s = canonicalize(obj);
  if (s === undefined) throw new Error('keylog: canonicalize returned undefined');
  return s;
};
const sha256Hex = (bytes) => bytesToHex(sha256(bytes));

/** Record signing key id, the same derivation as src/lib/recordProof/isoSign.ts deriveKeyId. */
export const deriveKeyId = (publicKeyHex) => 'almstins-' + sha256Hex(hexToBytes(publicKeyHex)).slice(0, 16);
/** Root key id: a different prefix, so a root key can never be mistaken for a record key. */
export const deriveRootId = (publicKeyHex) => 'almstins-root-' + sha256Hex(hexToBytes(publicKeyHex)).slice(0, 16);
/** The full root fingerprint the owner posts publicly: sha256 of the root public key. */
export const rootFingerprint = (publicKeyHex) => sha256Hex(hexToBytes(publicKeyHex));

/** The canonical line for an entry (what log.jsonl stores and what `prev` hashes). */
export const entryLine = (entry) => jcs(entry);
/** sha256 of an entry's canonical line: the next entry's `prev`, and the head after it. */
export const entryHash = (entry) => sha256Hex(utf8ToBytes(entryLine(entry)));
/** The bytes the root key signs: the entry without root_sig. */
export function entrySigningBytes(entry) {
  const { root_sig: _s, ...unsigned } = entry;
  return utf8ToBytes(jcs(unsigned));
}

/** True when `hex` decodes as an Ed25519 public key. */
export function isPublicKey(hex) {
  if (typeof hex !== 'string' || !HEX64.test(hex)) return false;
  try { ed.Point.fromHex(hex); return true; } catch { return false; }
}

/** Parse log.jsonl text into entries. Throws on a line that is not JSON. Blank lines are skipped. */
export function parseLog(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`keylog: line ${i + 1} is not JSON`); }
  });
}

/**
 * Check a whole log and fold it into the state of every key. Fail-closed: any break (a gap in
 * seq, a wrong prev, a bad root signature, a time going backwards, an entry about an unknown
 * key) makes ok false and the state is not to be used. `expectedRootFingerprint`, when given,
 * must match the genesis root key: that is the value the owner posted publicly, and the only
 * thing a verifier takes on trust.
 *
 * Returns { ok, errors, root: {public_key_hex, root_id}, keys: Map<key_id, KeyState>, head, length }
 * KeyState = { key_id, public_key_hex, valid_from, retired_at, compromised_since, revoke_reason }
 */
export function verifyLog(entries, { expectedRootFingerprint } = {}) {
  const errors = [];
  const keys = new Map();
  let root = null;
  let prev = GENESIS_PREV;
  let lastRecorded = '';
  const fail = (i, msg) => errors.push(`entry ${i}: ${msg}`);

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, errors: ['the log is empty'], root: null, keys, head: null, length: 0 };
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') { fail(i, 'not an object'); break; }
    if (e.log !== LOG_DOMAIN || e.v !== LOG_VERSION) { fail(i, 'not an Almstins key log v1 entry'); break; }
    if (e.seq !== i) { fail(i, `seq is ${e.seq}, expected ${i}`); break; }
    if (e.prev !== prev) { fail(i, 'prev does not match the hash of the entry before it'); break; }
    if (!ENTRY_TYPES.includes(e.type)) { fail(i, `unknown type ${e.type}`); break; }
    if ((e.type === 'root') !== (i === 0)) { fail(i, 'a root entry must be first, and only first'); break; }
    if (!ISO_UTC.test(String(e.recorded_at)) || !ISO_UTC.test(String(e.at))) { fail(i, 'times must be ISO 8601 UTC'); break; }
    if (e.recorded_at < lastRecorded) { fail(i, 'recorded_at goes backwards'); break; }
    if (e.alg !== 'Ed25519' || !isPublicKey(e.public_key_hex)) { fail(i, 'public_key_hex is not an Ed25519 public key'); break; }

    const isRootKey = e.type === 'root' || e.type === 'root-rotated';
    const wantId = isRootKey ? deriveRootId(e.public_key_hex) : deriveKeyId(e.public_key_hex);
    if (e.key_id !== wantId) { fail(i, 'key_id is not the one derived from public_key_hex'); break; }

    // The root entry signs itself; every later entry is signed by the root in force before it.
    const signer = e.type === 'root' ? e.public_key_hex : root.public_key_hex;
    let sigOk = false;
    try { sigOk = typeof e.root_sig === 'string' && ed.verify(hexToBytes(e.root_sig), entrySigningBytes(e), hexToBytes(signer)); } catch { sigOk = false; }
    if (!sigOk) { fail(i, 'root signature does not verify'); break; }

    if (e.type === 'root') {
      if (expectedRootFingerprint && rootFingerprint(e.public_key_hex) !== String(expectedRootFingerprint).toLowerCase()) {
        fail(i, 'the root key is not the one whose fingerprint you were given'); break;
      }
      root = { public_key_hex: e.public_key_hex, root_id: e.key_id };
    } else if (e.type === 'root-rotated') {
      root = { public_key_hex: e.public_key_hex, root_id: e.key_id };
    } else if (e.type === 'key-added') {
      if (keys.has(e.key_id)) { fail(i, `${e.key_id} was already added`); break; }
      keys.set(e.key_id, {
        key_id: e.key_id, public_key_hex: e.public_key_hex, valid_from: e.at,
        retired_at: null, compromised_since: null, revoke_reason: null,
      });
    } else {
      const k = keys.get(e.key_id);
      if (!k || k.public_key_hex !== e.public_key_hex) { fail(i, `${e.key_id} was never added`); break; }
      if (k.compromised_since) { fail(i, `${e.key_id} is already revoked; a revocation is final`); break; }
      if (e.type === 'key-retired') {
        if (k.retired_at) { fail(i, `${e.key_id} is already retired`); break; }
        k.retired_at = e.at;
      } else {
        k.compromised_since = e.at;
        k.revoke_reason = typeof e.reason === 'string' ? e.reason : null;
      }
    }
    lastRecorded = e.recorded_at;
    prev = entryHash(e);
  }

  const ok = errors.length === 0;
  return { ok, errors, root: ok ? root : null, keys: ok ? keys : new Map(), head: ok ? prev : null, length: entries.length };
}

/**
 * Build and root-sign the next entry for a log. `rootSecretKey` is the 32-byte root seed. Throws
 * if the result would not verify as part of the log (the tool never writes a broken entry).
 */
export function appendEntry(entries, fields, rootSecretKey, recordedAt = new Date().toISOString()) {
  const seq = entries.length;
  const entry = {
    log: LOG_DOMAIN, v: LOG_VERSION, seq,
    prev: seq === 0 ? GENESIS_PREV : entryHash(entries[seq - 1]),
    type: fields.type, recorded_at: recordedAt, at: fields.at ?? recordedAt,
    key_id: fields.key_id, alg: 'Ed25519', public_key_hex: fields.public_key_hex,
    ...(fields.reason ? { reason: String(fields.reason) } : {}),
  };
  entry.root_sig = bytesToHex(ed.sign(entrySigningBytes(entry), rootSecretKey));
  const next = [...entries, entry];
  const check = verifyLog(next);
  if (!check.ok) throw new Error(check.errors.join('; '));
  return entry;
}

/**
 * Whether a record signature under `keyId` counts, given the log state and the independent
 * (Bitcoin) times the record can show:
 *   signatureProvenAt  block time of a proof that covers the SIGNATURE itself (a signature
 *                      checkpoint). The only evidence that counts against a revocation.
 *   contentAnchoredAt  block time of the record's own anchor. It covers the CONTENT only, and
 *                      anyone can anchor any content, so it never rescues a revoked key.
 * Returns { verdict, reason }, verdict one of
 *   'trusted'          the key was in force when the signature is shown to exist
 *   'trusted-undated'  the key is in force (or retired, never revoked) but nothing dates the
 *                      signature; it stops counting if the key is ever revoked
 *   'rejected'         signed by a revoked or retired key and not shown to predate that
 *   'unknown-key'      the key is not in the log, or the public key does not match it
 *
 * @param {{ keys: Map<string, any> } | null} state  the result of verifyLog
 * @param {{ keyId: string, publicKeyHex?: string | null, signatureProvenAt?: string | null, contentAnchoredAt?: string | null }} record
 * @returns {{ verdict: 'trusted' | 'trusted-undated' | 'rejected' | 'unknown-key', reason: string }}
 */
export function judgeSignature(state, { keyId, publicKeyHex, signatureProvenAt = null, contentAnchoredAt = null }) {
  const k = state?.keys?.get(keyId);
  if (!k) return { verdict: 'unknown-key', reason: `${keyId} is not in the Almstins key log.` };
  if (publicKeyHex && String(publicKeyHex).toLowerCase() !== k.public_key_hex) {
    return { verdict: 'unknown-key', reason: `The record names ${keyId} but carries a different public key.` };
  }
  const ms = (iso) => (iso ? Date.parse(iso) : NaN);

  if (k.compromised_since) {
    const sig = ms(signatureProvenAt);
    if (Number.isFinite(sig) && sig + BLOCK_TIME_MARGIN_MS < ms(k.compromised_since)) {
      return { verdict: 'trusted', reason: `${keyId} was revoked from ${k.compromised_since}, but this signature is anchored in Bitcoin by ${signatureProvenAt}, before that.` };
    }
    return {
      verdict: 'rejected',
      reason: `${keyId} was revoked: it may have been exposed from ${k.compromised_since}. ` +
        (Number.isFinite(sig)
          ? `This signature is only shown to exist by ${signatureProvenAt}, which is not before then.`
          : 'Nothing anchors this signature in Bitcoin before then' +
            (contentAnchoredAt ? ` (the record's anchor dates its content, not its signature).` : '.')),
    };
  }

  const proven = [signatureProvenAt, contentAnchoredAt].map(ms).filter(Number.isFinite);
  const earliest = proven.length ? Math.min(...proven) : NaN;
  if (k.retired_at) {
    if (!Number.isFinite(earliest)) {
      return { verdict: 'trusted-undated', reason: `${keyId} is retired (not revoked) since ${k.retired_at}; nothing dates this signature.` };
    }
    if (earliest <= ms(k.retired_at) + RETIRE_GRACE_MS) {
      return { verdict: 'trusted', reason: `${keyId} was in force (retired ${k.retired_at}) when this record is shown to exist.` };
    }
    return { verdict: 'rejected', reason: `${keyId} was retired on ${k.retired_at}; this record is first shown to exist after that.` };
  }
  return Number.isFinite(earliest)
    ? { verdict: 'trusted', reason: `${keyId} is in force and has not been revoked.` }
    : { verdict: 'trusted-undated', reason: `${keyId} is in force and has not been revoked; nothing dates this signature.` };
}
