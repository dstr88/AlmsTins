// Ed25519 signing for record proofs. Almstins signs with ITS OWN key — it never
// holds, requests, or manages a user's key. The private seed lives ONLY in the
// env var ALMSTINS_SIGNING_KEY (the repo is public); fail-closed when unset, so
// an unconfigured deploy ships UNSIGNED exports rather than crashing.
//
// @noble/ed25519 v3 exposes a synchronous API once a SHA-512 implementation is
// wired (ed.hashes.sha512). The same library runs in the browser + the offline
// verifier, which is why we use it instead of node:crypto (no in-browser Ed25519).

import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

// Enable the synchronous sign/verify/getPublicKey API (v3 requirement).
ed.hashes.sha512 = sha512;

export const SIGNING_ALG = 'Ed25519' as const;

// Secrets come from the runtime env — Render injects them into process.env.
// (import.meta.env is avoided: Vite forbids dynamic access and inlines it statically.)
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** Decode a 32-byte Ed25519 seed from hex (64 chars) or base64. */
function decodeSeed(raw: string): Uint8Array | null {
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return hexToBytes(s.toLowerCase());
  try {
    const buf = Buffer.from(s, 'base64');
    if (buf.length === 32) return new Uint8Array(buf);
  } catch {
    /* fall through */
  }
  return null;
}

/** The active signing key, or null when ALMSTINS_SIGNING_KEY is unset/invalid. */
export function getSigningKey(): { keyId: string; secretKey: Uint8Array; publicKeyHex: string } | null {
  const raw = readEnv('ALMSTINS_SIGNING_KEY');
  if (!raw) return null;
  const seed = decodeSeed(raw);
  if (!seed) return null;
  const publicKeyHex = bytesToHex(ed.getPublicKey(seed));
  return { keyId: deriveKeyId(publicKeyHex), secretKey: seed, publicKeyHex };
}

/**
 * Public key to publish. Prefers an explicit ALMSTINS_SIGNING_PUBKEY override
 * (lets a host publish/verify a key it cannot sign with — useful during rotation),
 * else derives it from the private seed. Null when nothing is configured.
 */
export function getPublicKeyHex(): string | null {
  const override = readEnv('ALMSTINS_SIGNING_PUBKEY');
  if (override && /^[0-9a-fA-F]{64}$/.test(override.trim())) return override.trim().toLowerCase();
  return getSigningKey()?.publicKeyHex ?? null;
}

/** Content-derived key id (stable across processes, rotation-friendly). */
export function deriveKeyId(publicKeyHex: string): string {
  return 'almstins-' + bytesToHex(sha256(hexToBytes(publicKeyHex))).slice(0, 16);
}

export function getSigningKeyId(): string | null {
  const pub = getPublicKeyHex();
  return pub ? deriveKeyId(pub) : null;
}

/** Canonical bytes of the signed manifest (RFC-8785 JCS → UTF-8). Signing input. */
export function canonicalManifestBytes(signedManifest: object): Uint8Array {
  const json = canonicalize(signedManifest);
  if (json === undefined) throw new Error('signing: canonicalize manifest returned undefined');
  return utf8ToBytes(json);
}

/** Sign the canonical manifest bytes. Null when no key is configured (unsigned export). */
export function signManifest(
  signedManifestBytes: Uint8Array,
): { keyId: string; alg: typeof SIGNING_ALG; signatureHex: string } | null {
  const key = getSigningKey();
  if (!key) return null;
  return { keyId: key.keyId, alg: SIGNING_ALG, signatureHex: bytesToHex(ed.sign(signedManifestBytes, key.secretKey)) };
}

/** Verify an Ed25519 signature over the canonical manifest bytes. */
export function verifyManifestSignature(
  signedManifestBytes: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    return ed.verify(hexToBytes(signatureHex), signedManifestBytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
