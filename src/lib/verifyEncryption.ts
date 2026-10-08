/**
 * Roster-document encryption (Verify domain anchoring, encrypted-list variant).
 *
 * A merchant with several addresses publishes ONE file on their own domain, same as
 * the plain `.well-known` proof file, except its contents are opaque to anyone but
 * Almstins: RSA-OAEP wraps a random AES-256 key, AES-GCM encrypts the actual address
 * list. Anyone can fetch the file; only Almstins, holding the private key, can read
 * it. The merchant's own hosting does zero auth checking — the file is exactly as
 * public as any other static asset, the content is just noise without the key.
 *
 * Mirrors recordProof/signing.ts's security posture exactly: the private key lives
 * ONLY in an env var (repo is public), fail-closed when unset — an unconfigured
 * deploy simply can't decrypt roster documents rather than crashing. Almstins never
 * asks a merchant for a key; the merchant never sees ours except its public half.
 *
 * Uses the standard Web Crypto API (globalThis.crypto.subtle), not a JS crypto
 * library: unlike Ed25519 (see signing.ts), RSA-OAEP and AES-GCM are long-stable,
 * broadly-supported WebCrypto primitives in every current browser AND in Node
 * (crypto.webcrypto is exposed as the global `crypto` since Node 19). One isomorphic
 * module, no bundler branching: the merchant's browser encrypts with the exact same
 * function this file uses to decrypt server-side.
 */
export const ENCRYPTION_ALG = 'RSA-OAEP-4096+A256GCM' as const;
const RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;
const AES_PARAMS = { name: 'AES-GCM' } as const;
const IV_BYTES = 12;

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function subtle(): SubtleCrypto {
  const c = (globalThis as any).crypto;
  if (!c?.subtle) throw new Error('verifyEncryption: Web Crypto API unavailable in this runtime');
  return c.subtle;
}

/**
 * Stable content-derived id from the public JWK's modulus (rotation-friendly, mirrors
 * signing.ts). Async — SubtleCrypto's digest has no synchronous form, and this must
 * stay pure Web Crypto to run unmodified in the merchant's browser.
 */
export async function deriveKeyId(publicJwk: JsonWebKey): Promise<string> {
  const n = publicJwk.n ?? '';
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(n));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'almstins-enc-' + hex.slice(0, 16);
}

function parseJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw) return null;
  try {
    const jwk = JSON.parse(raw);
    return jwk && typeof jwk === 'object' ? jwk : null;
  } catch {
    return null;
  }
}

/** The active private key, or null when ALMSTINS_VERIFY_ENCRYPTION_KEY is unset/invalid. */
async function getPrivateKey(): Promise<{ keyId: string; key: CryptoKey; publicJwk: JsonWebKey } | null> {
  const jwk = parseJwk(readEnv('ALMSTINS_VERIFY_ENCRYPTION_KEY'));
  if (!jwk) return null;
  try {
    const key = await subtle().importKey('jwk', jwk, RSA_PARAMS, false, ['decrypt']);
    // Public half lives alongside the private fields in an RSA JWK (n, e) — strip
    // the private-only fields (d, p, q, dp, dq, qi) rather than requiring a second env var.
    const { d, p, q, dp, dq, qi, ...publicJwk } = jwk as any;
    return { keyId: await deriveKeyId(publicJwk), key, publicJwk };
  } catch {
    return null;
  }
}

/**
 * Public key to publish. Prefers an explicit ALMSTINS_VERIFY_ENCRYPTION_PUBKEY
 * override (lets a host publish a key it cannot decrypt with — useful mid-rotation),
 * else derives it from the private key. Null when nothing is configured.
 */
export async function getPublicKeyJwk(): Promise<JsonWebKey | null> {
  const override = parseJwk(readEnv('ALMSTINS_VERIFY_ENCRYPTION_PUBKEY'));
  if (override) return override;
  const priv = await getPrivateKey();
  return priv?.publicJwk ?? null;
}

export async function getEncryptionKeyId(): Promise<string | null> {
  const pub = await getPublicKeyJwk();
  return pub ? await deriveKeyId(pub) : null;
}

// btoa/atob, not Buffer — Buffer is a Node global, absent in the browser this same
// module runs in to encrypt. Chunked to stay well under the argument-count ceiling
// String.fromCharCode(...bytes) hits on a large buffer.
function toB64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function fromB64(s: string): ArrayBuffer {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The envelope published as the roster document's actual file contents. */
export interface RosterEnvelope {
  v: 1;
  alg: typeof ENCRYPTION_ALG;
  keyId: string;
  iv: string;         // base64, 12 bytes
  wrappedKey: string;  // base64, RSA-OAEP-wrapped raw AES-256 key
  ciphertext: string;  // base64, AES-GCM ciphertext of the plaintext JSON payload
}

/**
 * Encrypt a plaintext roster payload (the challenge-bound JSON string) to a public
 * key. Runs identically in the merchant's browser and in tests — this is the exact
 * function the dashboard's client-side encrypt tool calls; the plaintext never
 * leaves wherever this function is called.
 */
export async function encryptRosterPayload(plaintext: string, publicJwk: JsonWebKey): Promise<RosterEnvelope> {
  const s = subtle();
  const publicKey = await s.importKey('jwk', publicJwk, RSA_PARAMS, false, ['encrypt']);
  const aesKey = await s.generateKey({ ...AES_PARAMS, length: 256 }, true, ['encrypt', 'decrypt']);
  const rawAesKey = await s.exportKey('raw', aesKey);
  const wrappedKey = await s.encrypt(RSA_PARAMS, publicKey, rawAesKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await s.encrypt({ ...AES_PARAMS, iv }, aesKey, new TextEncoder().encode(plaintext));
  return {
    v: 1,
    alg: ENCRYPTION_ALG,
    keyId: await deriveKeyId(publicJwk),
    iv: toB64(iv.buffer),
    wrappedKey: toB64(wrappedKey),
    ciphertext: toB64(ciphertext),
  };
}

export type DecryptRosterCode = 'not_configured' | 'malformed' | 'unknown_key' | 'decrypt_failed';
export type DecryptRosterResult = { ok: true; plaintext: string } | { ok: false; code: DecryptRosterCode };

/**
 * Decrypt a published roster document's raw file contents back to the plaintext
 * payload. Server-side only in practice (needs the private key), but the function
 * itself has no side effects — pure decrypt, easy to unit test.
 */
export async function decryptRosterDocument(rawFileContents: string): Promise<DecryptRosterResult> {
  const priv = await getPrivateKey();
  if (!priv) return { ok: false, code: 'not_configured' };

  let env: RosterEnvelope;
  try {
    const parsed = JSON.parse(rawFileContents);
    if (
      parsed?.v !== 1 ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.wrappedKey !== 'string' ||
      typeof parsed.ciphertext !== 'string'
    ) {
      return { ok: false, code: 'malformed' };
    }
    env = parsed;
  } catch {
    return { ok: false, code: 'malformed' };
  }

  if (env.keyId !== priv.keyId) return { ok: false, code: 'unknown_key' };

  try {
    const s = subtle();
    const rawAesKey = await s.decrypt(RSA_PARAMS, priv.key, fromB64(env.wrappedKey));
    const aesKey = await s.importKey('raw', rawAesKey, AES_PARAMS, false, ['decrypt']);
    const iv = new Uint8Array(fromB64(env.iv));
    const plainBuf = await s.decrypt({ ...AES_PARAMS, iv }, aesKey, fromB64(env.ciphertext));
    return { ok: true, plaintext: new TextDecoder().decode(plainBuf) };
  } catch {
    return { ok: false, code: 'decrypt_failed' };
  }
}
