// Roster sealing for hand-run scripts (src/scripts/privacyCleanupV12.mjs). The same
// envelope as encryptRosterPayload in src/lib/verifyEncryption.ts, which the app decrypts
// with decryptRosterDocument; tests/privacy/rosterSealScript.test.ts proves the round trip.
import { webcrypto as crypto } from 'node:crypto';

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

/** sha-256 of the modulus, as deriveKeyId in verifyEncryption.ts. */
export async function keyIdFor(jwk) {
	const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwk.n ?? ''))).toString('hex');
	return 'almstins-enc-' + digest.slice(0, 16);
}

/** An entry of the published key document ({ key_id, jwk }) as a key to seal to. */
export async function rosterKeyFromEntry(entry) {
	if (!entry?.jwk?.n) throw new Error('no published roster key');
	const { key_ops: _ops, ...jwk } = entry.jwk;
	const keyId = await keyIdFor(jwk);
	if (entry.key_id !== keyId) throw new Error('published key id does not match the key');
	const publicKey = await crypto.subtle.importKey('jwk', jwk, RSA, false, ['encrypt']);
	return { publicKey, keyId };
}

/** The published roster key, fetched and checked against its key id. */
export async function publishedRosterKey(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(`key fetch HTTP ${res.status}`);
	return rosterKeyFromEntry((await res.json())?.keys?.[0]);
}

/** Seal plaintext to the key: RSA-OAEP wraps a fresh AES-256 key, AES-GCM encrypts. */
export async function sealRoster(plaintext, { publicKey, keyId }) {
	const s = crypto.subtle;
	const aesKey = await s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
	const wrappedKey = await s.encrypt(RSA, publicKey, await s.exportKey('raw', aesKey));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await s.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
	const b64 = (buf) => Buffer.from(buf).toString('base64');
	return { v: 1, alg: 'RSA-OAEP-4096+A256GCM', keyId, iv: b64(iv), wrappedKey: b64(wrappedKey), ciphertext: b64(ciphertext) };
}
