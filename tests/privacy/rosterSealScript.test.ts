import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// verifyRegistry imports the database module; nothing here touches it.
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no db in this test'); }, batch: async () => [] } }));
vi.mock('../../src/lib/db', () => ({ db: { execute: async () => { throw new Error('no db in this test'); }, batch: async () => [] } }));
import { webcrypto } from 'node:crypto';
// @ts-expect-error plain .mjs module for hand-run scripts, no type declarations
import { rosterKeyFromEntry, sealRoster, keyIdFor } from '../../src/scripts/rosterSeal.mjs';
import { decryptRosterDocument, deriveKeyId, getEncryptionKeyId, getPublicKeyJwk } from '../../src/lib/verifyEncryption';
import { openRosterCache } from '../../src/lib/verifyRegistry';

/**
 * src/scripts/privacyCleanupV12.mjs re-seals old plain roster caches with
 * src/scripts/rosterSeal.mjs. If its envelope differed from encryptRosterPayload, every
 * re-sealed cache would read as absent and owners' roster editors would come up empty.
 * This seals with the script module and opens with the app's own code.
 */

let saved: string | undefined;
beforeAll(async () => {
	saved = process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
	delete process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
	const pair = await webcrypto.subtle.generateKey(
		{ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true, ['encrypt', 'decrypt'],
	);
	process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.privateKey));
});
afterAll(() => {
	if (saved === undefined) delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
	else process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = saved;
});

async function publishedEntry() {
	const jwk = (await getPublicKeyJwk())!;
	return { key_id: (await getEncryptionKeyId())!, jwk: { ...jwk, key_ops: ['decrypt'] } };
}

describe('the cleanup script\'s roster sealing', () => {
	it('derives the same key id as the app', async () => {
		const jwk = (await getPublicKeyJwk())!;
		expect(await keyIdFor(jwk)).toBe(await deriveKeyId(jwk));
	});

	it('produces an envelope the app decrypts, and a cache the app opens', async () => {
		const entries = [{ address: '0x' + 'ab'.repeat(20), label: 'Till 2' }];
		const key = await rosterKeyFromEntry(await publishedEntry());
		const sealed = JSON.stringify(await sealRoster(JSON.stringify(entries), key));
		expect(sealed).not.toContain('Till 2');
		const opened = await decryptRosterDocument(sealed);
		expect(opened).toEqual({ ok: true, plaintext: JSON.stringify(entries) });
		expect(await openRosterCache(sealed)).toEqual(entries);
	});

	it('refuses a published key whose id does not match it', async () => {
		const entry = await publishedEntry();
		await expect(rosterKeyFromEntry({ ...entry, key_id: 'almstins-enc-0000000000000000' })).rejects.toThrow(/does not match/);
	});
});
