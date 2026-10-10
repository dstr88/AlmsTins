// Ed25519 signing for record proofs. Almstins signs with ITS OWN key — it never
// holds, requests, or manages a user's key. The private seed lives ONLY in the
// env var ALMSTINS_SIGNING_KEY (the repo is public); fail-closed when unset, so
// an unconfigured deploy ships UNSIGNED exports rather than crashing.
//
// @noble/ed25519 v3 exposes a synchronous API once a SHA-512 implementation is
// wired (ed.hashes.sha512). The same library runs in the browser + the offline
// verifier, which is why we use it instead of node:crypto (no in-browser Ed25519).

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { canonicalBytes, verifyEd25519, deriveKeyId } from './isoSign';

// Enable the synchronous sign/verify/getPublicKey API (v3 requirement).
ed.hashes.sha512 = sha512;

// The isomorphic primitives live in isoSign.ts; re-exported so existing imports keep working.
export { deriveKeyId };

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

export function getSigningKeyId(): string | null {
  const pub = getPublicKeyHex();
  return pub ? deriveKeyId(pub) : null;
}

/** Canonical bytes of the signed manifest (RFC-8785 JCS → UTF-8). Signing input. */
export function canonicalManifestBytes(signedManifest: object): Uint8Array {
  return canonicalBytes(signedManifest);
}

/** Sign the canonical manifest bytes. Null when no key is configured (unsigned export). */
export function signManifest(
  signedManifestBytes: Uint8Array,
): { keyId: string; alg: typeof SIGNING_ALG; signatureHex: string } | null {
  const signed = signManifestWithKey(signedManifestBytes);
  return signed ? { keyId: signed.keyId, alg: signed.alg, signatureHex: signed.signatureHex } : null;
}

/**
 * Sign, and name the signer from the SEED that signed: its key ID and public key. Use this
 * wherever a signature is stored next to the key that made it. getPublicKeyHex() can return the
 * ALMSTINS_SIGNING_PUBKEY override instead, which during a rotation is not the signing key, and
 * a record stored with that key beside it would never verify. Null when no key is configured.
 */
export function signManifestWithKey(
  signedManifestBytes: Uint8Array,
): { keyId: string; alg: typeof SIGNING_ALG; signatureHex: string; publicKeyHex: string } | null {
  const key = getSigningKey();
  if (!key) return null;
  return {
    keyId: key.keyId,
    alg: SIGNING_ALG,
    signatureHex: bytesToHex(ed.sign(signedManifestBytes, key.secretKey)),
    publicKeyHex: key.publicKeyHex,
  };
}

/** Verify an Ed25519 signature over the canonical manifest bytes. */
export function verifyManifestSignature(
  signedManifestBytes: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  return verifyEd25519(signedManifestBytes, signatureHex, publicKeyHex);
}

/** One entry of the published key set, in the /.well-known/almstins-signing-key.json shape. */
export interface PublishedSigningKey {
  key_id: string;
  alg: typeof SIGNING_ALG;
  public_key_hex: string;
}

/** One ALMSTINS_SIGNING_RETIRED_PUBKEYS entry: `<key_id>:<public_key_hex>`. */
const RETIRED_ENTRY = /^(almstins-[0-9a-f]{16}):([0-9a-f]{64})$/;

/** True when `pub` decodes as an Ed25519 public key (a point on the curve). */
function isEd25519PublicKey(pub: string): boolean {
  try {
    ed.Point.fromHex(pub);
    return true;
  } catch {
    return false;
  }
}

/** The raw value last warned about, so a misconfigured variable is logged once, not per request. */
let warnedRetiredRaw: string | null = null;

/**
 * Public keys Almstins signed with before a rotation, from ALMSTINS_SIGNING_RETIRED_PUBKEYS.
 * Optional; unset is the normal case. These keys are PUBLISHED, so the variable must only ever
 * hold public keys, never a seed.
 *
 * Each entry is `<key_id>:<public_key_hex>`, both copied from the retiring key's entry in the
 * live /.well-known/almstins-signing-key.json before the seed is replaced; entries are
 * separated by commas or whitespace. An entry is used only when its key_id is the one derived
 * from its public key. That binding is the guard against the likely rotation mistake, pasting
 * the old ALMSTINS_SIGNING_KEY instead of the old public key: a hex seed also looks like 64 hex
 * and often decodes as a curve point, but it does not hash to the key_id of the public key it
 * belongs to, so it is never published. An entry that is malformed, mismatched, not a curve
 * point or equal to the current seed is skipped (a mistake leaves a key unpublished, never a
 * wrong value published), and the skip is logged once by count, never by value.
 */
export function getRetiredPublicKeys(): string[] {
  const raw = readEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS');
  if (!raw) return [];
  const seed = readEnv('ALMSTINS_SIGNING_KEY');
  const seedBytes = seed ? decodeSeed(seed) : null;
  const seedHex = seedBytes ? bytesToHex(seedBytes) : null;
  const out: string[] = [];
  let skipped = 0;
  for (const part of raw.split(/[\s,]+/)) {
    const entry = part.trim().toLowerCase();
    if (!entry) continue;
    const m = RETIRED_ENTRY.exec(entry);
    const ok = !!m && m[2] !== seedHex && deriveKeyId(m[2]) === m[1] && isEd25519PublicKey(m[2]);
    if (!ok) { skipped++; continue; }
    if (!out.includes(m![2])) out.push(m![2]);
  }
  if (skipped && warnedRetiredRaw !== raw) {
    warnedRetiredRaw = raw;
    console.warn(
      `[signing] ALMSTINS_SIGNING_RETIRED_PUBKEYS: skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'}. ` +
      'Each entry must be key_id:public_key_hex, copied from the old /.well-known/almstins-signing-key.json.',
    );
  }
  return out;
}

/**
 * Every key a stored Almstins signature may verify under, current first:
 *   1. the published current key (getPublicKeyHex(): the override when set, else the seed's), so
 *      the first entry is exactly what the well-known document has always published;
 *   2. the seed's own key, when an override names a different one (the key that signs now);
 *   3. each retired key from ALMSTINS_SIGNING_RETIRED_PUBKEYS (see getRetiredPublicKeys).
 * Duplicates collapse. Empty when nothing is configured. Each entry's key_id is derived from its
 * public key, so nothing here can mislabel a key.
 */
export function getPublishedKeys(): PublishedSigningKey[] {
  const out: PublishedSigningKey[] = [];
  const add = (pub: string | null | undefined) => {
    if (!pub || out.some((k) => k.public_key_hex === pub)) return;
    out.push({ key_id: deriveKeyId(pub), alg: SIGNING_ALG, public_key_hex: pub });
  };
  add(getPublicKeyHex());
  add(getSigningKey()?.publicKeyHex);
  for (const pub of getRetiredPublicKeys()) add(pub);
  return out;
}
