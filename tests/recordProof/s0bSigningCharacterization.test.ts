import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Characterization of the signing surfaces the receivables S0b slice touches, written and run
 * green against the ORIGINAL code before any of it moved:
 *   - the record-set Merkle helpers (moving out of rwaProof/proof.ts into rwaProof/recordSet.ts);
 *   - canonical bytes, key IDs and signatures (moving onto recordProof/isoSign.ts);
 *   - buildScopedProof with the normal configuration (the seed alone);
 *   - GET /.well-known/almstins-signing-key.json, whose document must keep its exact shape.
 * Every value here is a golden output of the original code. The refactor must leave each one
 * byte-identical.
 *
 * Fixed test seeds, generated for this suite; they sign nothing outside it.
 */

const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const PUB_A = 'e6affd1a7c9d0f4d874d4883c67b9252313af956180eab8458c05bc72f0b8455';
const KID_A = 'almstins-9a753ae29c493b1c';

const RECORDS = [
	{ event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xaaa', at: '2026-08-20T10:00:00.000Z' },
	{ event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xbbb', at: '2026-08-21T10:00:00.000Z' },
	{ event: 'self-send', asset: 'USDC', amount: '1.00', txHash: '0xccc', at: '2026-08-22T10:00:00.000Z' },
];
const ROOT = 'e0079a74d0ee16dae1711ff7831f1113d90eb956950f8e3c693f7472bb6825a6';

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('record-set Merkle helpers (pinned before recordSet.ts)', () => {
	it('root, inclusion proof and inclusion check are unchanged', async () => {
		const rw = await import('@/lib/rwaProof');
		expect(rw.recordSetRoot(RECORDS)).toBe(ROOT);
		const proof = rw.proveRecordInclusion(RECORDS, 1);
		expect(proof).toEqual({
			index: 1,
			siblings: [
				{ hash: '81bee5cefbf323a9b8b5dbad99979dc7d69b741cc7ec58ae4a6537ab7316b338', side: 'L' },
				{ hash: '4ca89e40331725ca4dcd67ee47b7233c8a869cc65f8fd00e9a223bcecd91af36', side: 'R' },
			],
		});
		expect(rw.verifyRecordInclusion(RECORDS[1], proof, ROOT)).toBe(true);
		expect(rw.verifyRecordInclusion({ ...RECORDS[1], amount: '2.00' }, proof, ROOT)).toBe(false);
	});
});

describe('signing primitives (pinned before isoSign.ts)', () => {
	it('key ID, canonical bytes and a signature are unchanged', async () => {
		const s = await import('@/lib/recordProof/signing');
		expect(s.getPublicKeyHex()).toBe(PUB_A);
		expect(s.getSigningKeyId()).toBe(KID_A);
		expect(s.deriveKeyId(PUB_A)).toBe(KID_A);
		expect(new TextDecoder().decode(s.canonicalManifestBytes({ b: [2, 1], a: { d: null, c: 'é' } })))
			.toBe('{"a":{"c":"é","d":null},"b":[2,1]}');
		const bytes = s.canonicalManifestBytes({ hello: 'world' });
		const sig = s.signManifest(bytes)!;
		expect(sig).toMatchObject({ keyId: KID_A, alg: 'Ed25519' });
		expect(s.verifyManifestSignature(bytes, sig.signatureHex, PUB_A)).toBe(true);
		expect(s.verifyManifestSignature(bytes, 'zz', PUB_A)).toBe(false);
	});
});

describe('buildScopedProof with the seed alone (pinned before the seed key-ID change)', () => {
	it('issuer, root and signature are unchanged, and it verifies', async () => {
		const rw = await import('@/lib/rwaProof');
		const p = await rw.buildScopedProof({
			claim: { kind: 'control', subject: 's', statement: 'x' }, records: RECORDS, provenAt: '2026-08-27T00:00:00.000Z',
		});
		expect(p).toEqual({
			v: 1,
			claim: { kind: 'control', subject: 's', statement: 'x' },
			issuer: { name: 'Almstins', keyId: KID_A, publicKeyHex: PUB_A },
			provenAt: '2026-08-27T00:00:00.000Z',
			merkleRoot: ROOT,
			alg: 'Ed25519',
			anchor: null,
			signatureHex: 'c909738ecb84ec09e6778775bc0a054f4862fbbf817d0ef22215902c89922589cf56a587ecafcdd4521fd08b4929e22db6fef6bfec650451893a43cc5cff4703',
		});
		const { anchor: _a, signatureHex: _s, ...manifest } = p;
		expect(rw.manifestDigest(manifest as any)).toBe('676c887c8a48354fcce5af95df62fcee4ea2b7ddc604b06fc6a1958c5b4f8edc');
		expect((await rw.verifyScopedProof(p)).ok).toBe(true);
	});
});

describe('GET /.well-known/almstins-signing-key.json (shape pinned)', () => {
	const get = async () => {
		const { GET } = await import('../../src/pages/.well-known/almstins-signing-key.json');
		return (GET as any)({}) as Response;
	};

	it('publishes the one configured key, byte for byte', async () => {
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(await res.text()).toBe(JSON.stringify({ keys: [{ key_id: KID_A, alg: 'Ed25519', public_key_hex: PUB_A }] }, null, 2));
	});

	it('publishes an empty list when no key is configured', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		const res = await get();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(JSON.stringify({ keys: [] }, null, 2));
	});

	it('publishes the ALMSTINS_SIGNING_PUBKEY override when it is set', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', PUB_A.toUpperCase());
		const res = await get();
		expect(JSON.parse(await res.text())).toEqual({ keys: [{ key_id: KID_A, alg: 'Ed25519', public_key_hex: PUB_A }] });
	});
});
