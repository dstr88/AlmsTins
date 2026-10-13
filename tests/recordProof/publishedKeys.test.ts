import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

ed.hashes.sha512 = sha512;

/**
 * getPublishedKeys(): the keys a stored Almstins signature may verify under, current first, then
 * any listed in ALMSTINS_SIGNING_RETIRED_PUBKEYS (optional; unset is the normal case) as
 * `key_id:public_key_hex` pairs, each bound to its own key ID so a pasted seed is never published.
 * And the seed key-ID fix: what signs names the seed's key, never the ALMSTINS_SIGNING_PUBKEY
 * override. Keys are generated in-test; nothing here reads a real secret.
 */

const newKey = () => {
	const seed = ed.utils.randomSecretKey();
	return { seedHex: bytesToHex(seed), pub: bytesToHex(ed.getPublicKey(seed)) };
};

type Signing = typeof import('@/lib/recordProof/signing');
let signing: Signing;
let A: ReturnType<typeof newKey>, B: ReturnType<typeof newKey>, C: ReturnType<typeof newKey>;

beforeEach(async () => {
	vi.resetModules();
	A = newKey(); B = newKey(); C = newKey();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', A.seedHex);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	signing = await import('@/lib/recordProof/signing');
});
afterEach(() => { vi.unstubAllEnvs(); });

const entry = (pub: string) => ({ key_id: signing.deriveKeyId(pub), alg: 'Ed25519', public_key_hex: pub });
/** One ALMSTINS_SIGNING_RETIRED_PUBKEYS entry, as copied from the old well-known document. */
const retired = (pub: string) => `${signing.deriveKeyId(pub)}:${pub}`;
/** A 32-byte value that also decodes as a curve point: the dangerous kind of pasted seed. */
const seedThatLooksLikeAKey = () => {
	for (let i = 0; i < 256; i++) {
		const k = newKey();
		try { ed.Point.fromHex(k.seedHex); return k; } catch { /* try another */ }
	}
	throw new Error('no on-curve seed found');
};

describe('getPublishedKeys', () => {
	it('unset retired keys: exactly the current key, as the well-known document always published it', () => {
		expect(signing.getPublishedKeys()).toEqual([entry(A.pub)]);
		delete process.env.ALMSTINS_SIGNING_RETIRED_PUBKEYS;
		expect(signing.getPublishedKeys()).toEqual([entry(A.pub)]);
	});

	it('nothing configured: an empty list', () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		expect(signing.getPublishedKeys()).toEqual([]);
	});

	it('retired keys follow the current one, normalized and de-duplicated, separated by commas or whitespace', () => {
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', ` ${retired(B.pub).toUpperCase()},${retired(C.pub)}\n${retired(B.pub)}  ${retired(A.pub)} `);
		expect(signing.getRetiredPublicKeys()).toEqual([B.pub, C.pub, A.pub]);
		expect(signing.getPublishedKeys()).toEqual([entry(A.pub), entry(B.pub), entry(C.pub)]);
	});

	it('ignores anything that is not a key_id:public_key_hex pair bound to its own key, and never publishes the current seed', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const notAPoint = (() => {
			for (let i = 0; i < 256; i++) {
				const h = bytesToHex(ed.utils.randomSecretKey());
				try { ed.Point.fromHex(h); } catch { return h; }
			}
			throw new Error('no off-curve value found');
		})();
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', [
			'xyz', 'ab'.repeat(31), `0x${B.pub}`,
			B.pub, // a bare public key: no key ID to bind it to
			`${signing.deriveKeyId(notAPoint)}:${notAPoint}`, // not a curve point
			`${signing.deriveKeyId(A.pub)}:${A.seedHex}`, // the current seed
			`${signing.deriveKeyId(B.pub)}:${C.pub}`, // a key under another key's ID
			retired(C.pub),
		].join(','));
		expect(signing.getRetiredPublicKeys()).toEqual([C.pub]);
		expect(JSON.stringify(signing.getPublishedKeys())).not.toContain(A.seedHex);
		warn.mockRestore();
	});

	it('a pasted OLD seed is never published, bare or next to the old key ID (the likely rotation mistake)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		for (let trial = 0; trial < 20; trial++) {
			// Rotation: the old seed D is replaced by A; D's seed is pasted where its public key belongs.
			const D = seedThatLooksLikeAKey();
			vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', `${D.seedHex},${signing.deriveKeyId(D.pub)}:${D.seedHex}`);
			expect(signing.getRetiredPublicKeys()).toEqual([]);
			const published = JSON.stringify(signing.getPublishedKeys());
			expect(published).not.toContain(D.seedHex);
			expect(signing.getPublishedKeys()).toEqual([entry(A.pub)]);
		}
		warn.mockRestore();
	});

	it('logs a skipped entry once, by count, never by value', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const D = seedThatLooksLikeAKey();
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', `${retired(B.pub)},${D.seedHex}`);
		expect(signing.getRetiredPublicKeys()).toEqual([B.pub]);
		signing.getPublishedKeys();
		expect(warn).toHaveBeenCalledTimes(1);
		const logged = String(warn.mock.calls[0][0]);
		expect(logged).toMatch(/skipped 1 entry/);
		expect(logged).not.toContain(D.seedHex);
		expect(logged).not.toContain(B.pub);
		warn.mockRestore();
	});

	it('an override that names a different key publishes it first, then the seed key that signs now', () => {
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', B.pub);
		expect(signing.getPublishedKeys()).toEqual([entry(B.pub), entry(A.pub)]);
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', A.pub);
		expect(signing.getPublishedKeys()).toEqual([entry(A.pub)]);
	});
});

describe('GET /.well-known/almstins-signing-key.json', () => {
	const get = async () => {
		const { GET } = await import('../../src/pages/.well-known/almstins-signing-key.json');
		return (GET as any)({}) as Response;
	};

	it('with retired keys: the same document shape, current key first', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', retired(B.pub));
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
		const doc = JSON.parse(await res.text());
		expect(Object.keys(doc)).toEqual(['keys']);
		expect(doc.keys).toEqual([entry(A.pub), entry(B.pub)]);
		for (const k of doc.keys) expect(Object.keys(k)).toEqual(['key_id', 'alg', 'public_key_hex']);
	});

	it('never carries a seed, current or old', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const D = seedThatLooksLikeAKey();
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', `${retired(B.pub)},${A.seedHex},${D.seedHex},${signing.deriveKeyId(D.pub)}:${D.seedHex}`);
		const text = await (await get()).text();
		expect(text).not.toContain(A.seedHex);
		expect(text).not.toContain(D.seedHex);
		expect(JSON.parse(text).keys).toEqual([entry(A.pub), entry(B.pub)]);
		warn.mockRestore();
	});
});

describe('what signs names the seed', () => {
	it('signManifestWithKey returns the seed key ID and public key, whatever the override says', () => {
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', B.pub);
		const bytes = signing.canonicalManifestBytes({ a: 1 });
		const sig = signing.signManifestWithKey(bytes)!;
		expect(sig).toMatchObject({ keyId: signing.deriveKeyId(A.pub), alg: 'Ed25519', publicKeyHex: A.pub });
		expect(signing.verifyManifestSignature(bytes, sig.signatureHex, sig.publicKeyHex)).toBe(true);
		expect(signing.signManifest(bytes)).toEqual({ keyId: sig.keyId, alg: 'Ed25519', signatureHex: sig.signatureHex });
	});

	it('buildScopedProof names the seed as issuer during a rotation, so the proof verifies', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', B.pub);
		const rw = await import('@/lib/rwaProof');
		const p = await rw.buildScopedProof({ claim: { kind: 'test', subject: 's', statement: 'x' }, records: [{ a: 1 }], provenAt: '2026-10-10T00:00:00.000Z' });
		expect(p.issuer).toEqual({ name: 'Almstins', keyId: signing.deriveKeyId(A.pub), publicKeyHex: A.pub });
		expect((await rw.verifyScopedProof(p)).signature).toBe('valid');
	});

	it('an unsigned scoped proof (no seed) keeps naming the published key, as before', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', B.pub);
		const rw = await import('@/lib/rwaProof');
		const p = await rw.buildScopedProof({ claim: { kind: 'test', subject: 's', statement: 'x' }, records: [] });
		expect(p.signatureHex).toBeNull();
		expect(p.issuer).toMatchObject({ keyId: signing.deriveKeyId(B.pub), publicKeyHex: B.pub });
	});
});
