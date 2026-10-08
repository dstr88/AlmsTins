import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  encryptRosterPayload, decryptRosterDocument, getPublicKeyJwk, getEncryptionKeyId, deriveKeyId,
} from '@/lib/verifyEncryption';
import { looksLikePointerUrl } from '@/lib/verifyProof';

/**
 * Roster document encryption: RSA-OAEP wraps a random AES key, AES-GCM encrypts the
 * actual address list. The merchant's browser calls encryptRosterPayload with OUR
 * public key; only decryptRosterDocument, holding the private key, can read it back.
 * Mirrors recordProof/signing.test.ts's fail-closed + round-trip + tamper pattern.
 */

async function genKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  ); // 2048 here only to keep the test suite fast — production uses 4096 (see generateVerifyEncryptionKey.mjs)
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { privateJwk, publicJwk };
}

describe('verifyEncryption — no key configured (fail-closed)', () => {
  it('getPublicKeyJwk and decryptRosterDocument both fail closed', async () => {
    delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
    delete process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
    expect(await getPublicKeyJwk()).toBeNull();
    expect(await getEncryptionKeyId()).toBeNull();
    const result = await decryptRosterDocument('{"v":1,"iv":"x","wrappedKey":"x","ciphertext":"x"}');
    expect(result).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('verifyEncryption — key configured', () => {
  let privateJwk: JsonWebKey;
  let publicJwk: JsonWebKey;

  beforeAll(async () => {
    ({ privateJwk, publicJwk } = await genKeyPair());
    process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = JSON.stringify(privateJwk);
  });
  afterAll(() => { delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY; });

  it('publishes the public key derived from the private one', async () => {
    const pub = await getPublicKeyJwk();
    expect(pub?.n).toBe(publicJwk.n);
    expect(pub).not.toHaveProperty('d'); // private-only fields must never leak into the published key
  });

  it('encrypt → decrypt round trip returns the exact plaintext', async () => {
    const plaintext = JSON.stringify({
      almstins: { version: 1, challenge: 'almstins-verify-abc123', addresses: [{ address: '0xabc', label: 'Main' }] },
    });
    const envelope = await encryptRosterPayload(plaintext, publicJwk);
    const result = await decryptRosterDocument(JSON.stringify(envelope));
    expect(result).toEqual({ ok: true, plaintext });
  });

  it('a tampered ciphertext fails to decrypt rather than returning garbage', async () => {
    const envelope = await encryptRosterPayload('{"almstins":{"challenge":"x","addresses":[]}}', publicJwk);
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
    const result = await decryptRosterDocument(JSON.stringify(tampered));
    expect(result).toEqual({ ok: false, code: 'decrypt_failed' });
  });

  it('a document encrypted to a DIFFERENT key is rejected before attempting to decrypt', async () => {
    const other = await genKeyPair();
    const envelope = await encryptRosterPayload('{"almstins":{"challenge":"x","addresses":[]}}', other.publicJwk);
    const result = await decryptRosterDocument(JSON.stringify(envelope));
    expect(result).toEqual({ ok: false, code: 'unknown_key' });
  });

  it('a malformed envelope is rejected without throwing', async () => {
    expect(await decryptRosterDocument('not json')).toEqual({ ok: false, code: 'malformed' });
    expect(await decryptRosterDocument('{"v":1}')).toEqual({ ok: false, code: 'malformed' });
  });

  it('deriveKeyId is deterministic and stable across re-derivation from the same public key', async () => {
    const pub = await getPublicKeyJwk();
    expect(await deriveKeyId(pub!)).toBe(await deriveKeyId(pub!));
    expect(await deriveKeyId(pub!)).toMatch(/^almstins-enc-[0-9a-f]{16}$/);
  });
});

describe('looksLikePointerUrl — telling a document pointer apart from a bare challenge token', () => {
  it('an https URL is a pointer', () => {
    expect(looksLikePointerUrl('https://joescoffee.com/addresses.enc.json')).toBe(true);
  });
  it('a bare challenge token is not', () => {
    expect(looksLikePointerUrl('almstins-verify-ab12cd34ef56')).toBe(false);
  });
  it('an http (non-https) URL is not accepted as a pointer', () => {
    expect(looksLikePointerUrl('http://joescoffee.com/addresses.json')).toBe(false);
  });
  it('unrelated TXT records (SPF/DKIM) are not mistaken for a pointer', () => {
    expect(looksLikePointerUrl('v=spf1 include:_spf.google.com ~all')).toBe(false);
  });
});
