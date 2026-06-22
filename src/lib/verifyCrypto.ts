/**
 * Almstins Verify — symmetric encryption for third-party secrets we must REPLAY.
 *
 * A Verified Entity (exchange) gives us an API key that we send back to their own
 * endpoint on every pull. Unlike a password we only ever check, this key must be
 * recoverable — so it is ENCRYPTED at rest (AES-256-GCM), never hashed.
 *
 * Blast radius is deliberately tiny: the key only reads a list of addresses the
 * entity already publishes. It cannot move funds or read anything private
 * (read-only, no custody) — but we still encrypt it and support rotation.
 *
 * The master key comes from env VERIFY_ENTITY_SECRET (32 bytes, hex or base64).
 * Fail-closed: with no key, encrypt/decrypt return null and the caller refuses to
 * store/use an endpoint key rather than persisting a secret in the clear.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function getKey(): Buffer | null {
  const raw = (process.env.VERIFY_ENTITY_SECRET ?? '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

/** True when a valid 32-byte master key is configured. */
export function encryptionAvailable(): boolean {
  return getKey() !== null;
}

/** Encrypt a secret → "v1:iv:tag:ciphertext" (all base64), or null if unavailable. */
export function encryptSecret(plain: string): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt a blob produced by encryptSecret. Returns null on any mismatch/tamper. */
export function decryptSecret(blob: string): string | null {
  const key = getKey();
  if (!key) return null;
  const [version, ivb, tagb, encb] = String(blob).split(':');
  if (version !== VERSION || !ivb || !tagb || !encb) return null;
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivb, 'base64'));
    decipher.setAuthTag(Buffer.from(tagb, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encb, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key, tampered ciphertext, or corrupt blob
  }
}
