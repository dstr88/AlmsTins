import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

ed.hashes.sha512 = sha512;

import {
  getSigningKey, getPublicKeyHex, signManifest, verifyManifestSignature,
  canonicalManifestBytes, deriveKeyId,
} from '@/lib/recordProof/signing';

const seed = ed.utils.randomSecretKey();
const seedB64 = Buffer.from(seed).toString('base64');

describe('signing — no key configured (fail-closed)', () => {
  it('getSigningKey + signManifest return null', () => {
    delete process.env.ALMSTINS_SIGNING_KEY;
    delete process.env.ALMSTINS_SIGNING_PUBKEY;
    expect(getSigningKey()).toBeNull();
    expect(signManifest(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(getPublicKeyHex()).toBeNull();
  });
});

describe('signing — key configured', () => {
  beforeAll(() => { process.env.ALMSTINS_SIGNING_KEY = seedB64; });
  afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

  it('sign → verify round trip', () => {
    const bytes = canonicalManifestBytes({ b: 'x', a: 1 });
    const sig = signManifest(bytes);
    expect(sig).not.toBeNull();
    expect(sig!.alg).toBe('Ed25519');
    expect(verifyManifestSignature(bytes, sig!.signatureHex, getPublicKeyHex()!)).toBe(true);
  });

  it('a 1-byte manifest change fails verification', () => {
    const sig = signManifest(canonicalManifestBytes({ a: 1 }))!;
    const tampered = canonicalManifestBytes({ a: 2 });
    expect(verifyManifestSignature(tampered, sig.signatureHex, getPublicKeyHex()!)).toBe(false);
  });

  it('a wrong public key fails verification', () => {
    const bytes = canonicalManifestBytes({ a: 1 });
    const sig = signManifest(bytes)!;
    const otherPub = bytesToHex(ed.getPublicKey(ed.utils.randomSecretKey()));
    expect(verifyManifestSignature(bytes, sig.signatureHex, otherPub)).toBe(false);
  });

  it('deriveKeyId is deterministic and well-formed', () => {
    const pub = getPublicKeyHex()!;
    expect(deriveKeyId(pub)).toBe(deriveKeyId(pub));
    expect(deriveKeyId(pub)).toMatch(/^almstins-[0-9a-f]{16}$/);
  });

  it('canonical manifest bytes are key-order independent', () => {
    expect(canonicalManifestBytes({ a: 1, b: 2 })).toEqual(canonicalManifestBytes({ b: 2, a: 1 }));
  });
});
