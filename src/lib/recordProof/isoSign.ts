// Isomorphic signing primitives: canonical bytes, SHA-256, Ed25519 verification and the
// content-derived key ID. One copy, shared by the server signer (signing.ts), the browser and
// API verifier (verify.ts) and the scoped-proof builder (rwaProof/proof.ts).
//
// FULLY ISOMORPHIC: imports only @noble + canonicalize. No node:crypto, Buffer or process.env,
// so a page script can import it. Signing itself stays in signing.ts, the only module that reads
// the private seed.

import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

// @noble/ed25519 v3 needs a SHA-512 implementation for its synchronous API.
ed.hashes.sha512 = sha512;

/** RFC-8785 (JCS) canonical JSON of `obj`, as UTF-8 bytes. The input to every signature and digest. */
export function canonicalBytes(obj: unknown): Uint8Array {
  const json = canonicalize(obj as object);
  if (json === undefined) throw new Error('isoSign: canonicalize returned undefined');
  return utf8ToBytes(json);
}

/** Lowercase hex SHA-256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Lowercase hex SHA-256 of the canonical bytes of `obj`: a record's digest. */
export function digestOf(obj: unknown): string {
  return sha256Hex(canonicalBytes(obj));
}

/** True only when `signatureHex` is a valid Ed25519 signature of `bytes` under `publicKeyHex`.
 *  Malformed hex or a wrong-length key reads as false, never a throw. */
export function verifyEd25519(bytes: Uint8Array, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed.verify(hexToBytes(signatureHex), bytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** Content-derived key ID ("almstins-" + 16 hex of the public key's SHA-256): stable across
 *  processes, and a rotated key gets a new ID without anyone assigning one. */
export function deriveKeyId(publicKeyHex: string): string {
  return 'almstins-' + bytesToHex(sha256(hexToBytes(publicKeyHex))).slice(0, 16);
}
