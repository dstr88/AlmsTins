import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { getPublicKeyJwk, getEncryptionKeyId, deriveKeyId } from '../../src/lib/verifyEncryption';

/**
 * The roster editor imports the published public key for 'encrypt'. A private key
 * exported by src/scripts/generateVerifyEncryptionKey.mjs carries key_ops ['decrypt'], and
 * the public half derived from it kept that, so Web Crypto refused the import ("Key
 * operations and usage mismatch") and "Encrypt & download" could not work. The derived
 * public key must carry no key_ops, keep its key id, and import for encrypting.
 */

const subtle = webcrypto.subtle;
let saved: string | undefined;

beforeAll(async () => {
	saved = process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
	delete process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
	const pair = await subtle.generateKey(
		{ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['encrypt', 'decrypt'],
	);
	const priv = await subtle.exportKey('jwk', pair.privateKey);
	expect(priv.key_ops).toEqual(['decrypt']);
	process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = JSON.stringify(priv);
});

afterAll(() => {
	if (saved === undefined) delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
	else process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = saved;
});

describe('the published roster encryption key', () => {
	it('carries no private fields and no decrypt-only key_ops', async () => {
		const jwk = (await getPublicKeyJwk()) as Record<string, unknown>;
		expect(jwk).toBeTruthy();
		for (const k of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'key_ops']) expect(jwk, k).not.toHaveProperty(k);
	});

	it('imports for encrypting, as the roster editor does', async () => {
		const jwk = (await getPublicKeyJwk())!;
		await expect(subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])).resolves.toBeTruthy();
	});

	it('keeps the same key id', async () => {
		const jwk = (await getPublicKeyJwk())!;
		expect(await getEncryptionKeyId()).toBe(await deriveKeyId(jwk));
	});
});
