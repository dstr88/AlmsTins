import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalBytes, sha256Hex, digestOf, verifyEd25519, deriveKeyId } from '@/lib/recordProof/isoSign';
import * as signing from '@/lib/recordProof/signing';
import * as recordSet from '@/lib/rwaProof/recordSet';
import * as proof from '@/lib/rwaProof/proof';

ed.hashes.sha512 = sha512;

/**
 * recordProof/isoSign.ts: the one copy of canonical bytes, SHA-256, Ed25519 verification and the
 * key ID, shared by the signer, the verifier and the scoped-proof builder. And
 * rwaProof/recordSet.ts: the record-set Merkle helpers, moved out of the server-only proof.ts.
 * Both must stay isomorphic (safe in a page script and an offline verifier).
 */

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const importsOf = (src: string) => [...src.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

describe('isoSign primitives', () => {
	it('canonical bytes are RFC-8785: key order does not matter, and undefined is refused', () => {
		expect(canonicalBytes({ b: 1, a: [2, { d: 1, c: 0 }] })).toEqual(canonicalBytes({ a: [2, { c: 0, d: 1 }], b: 1 }));
		expect(new TextDecoder().decode(canonicalBytes({ b: 1, a: 'x' }))).toBe('{"a":"x","b":1}');
		expect(() => canonicalBytes(undefined)).toThrow(/canonicalize/);
	});

	it('sha256Hex matches the standard test vector, and digestOf hashes the canonical bytes', () => {
		expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(digestOf({ b: 2, a: 1 })).toBe(sha256Hex(new TextEncoder().encode('{"a":1,"b":2}')));
	});

	it('verifyEd25519 accepts a real signature and rejects tampering, a wrong key and garbage', () => {
		const seed = ed.utils.randomSecretKey();
		const pub = bytesToHex(ed.getPublicKey(seed));
		const other = bytesToHex(ed.getPublicKey(ed.utils.randomSecretKey()));
		const bytes = canonicalBytes({ kind: 'test', n: 1 });
		const sig = bytesToHex(ed.sign(bytes, seed));
		expect(verifyEd25519(bytes, sig, pub)).toBe(true);
		expect(verifyEd25519(canonicalBytes({ kind: 'test', n: 2 }), sig, pub)).toBe(false);
		expect(verifyEd25519(bytes, sig, other)).toBe(false);
		expect(verifyEd25519(bytes, 'not-hex', pub)).toBe(false);
		expect(verifyEd25519(bytes, sig, 'abcd')).toBe(false);
	});

	it('deriveKeyId keeps the production key-ID format', () => {
		expect(deriveKeyId('e6affd1a7c9d0f4d874d4883c67b9252313af956180eab8458c05bc72f0b8455')).toBe('almstins-9a753ae29c493b1c');
		expect(deriveKeyId(bytesToHex(ed.getPublicKey(ed.utils.randomSecretKey())))).toMatch(/^almstins-[0-9a-f]{16}$/);
	});
});

describe('one copy: signing.ts and proof.ts delegate to the shared modules', () => {
	it('signing.ts re-exports deriveKeyId and uses the shared canonical bytes and verifier', () => {
		expect(signing.deriveKeyId).toBe(deriveKeyId);
		const obj = { z: [1, 2], a: { y: null } };
		expect(signing.canonicalManifestBytes(obj)).toEqual(canonicalBytes(obj));
		const seed = ed.utils.randomSecretKey();
		const bytes = canonicalBytes(obj);
		const sig = bytesToHex(ed.sign(bytes, seed));
		const pub = bytesToHex(ed.getPublicKey(seed));
		expect(signing.verifyManifestSignature(bytes, sig, pub)).toBe(verifyEd25519(bytes, sig, pub));
	});

	it('proof.ts re-exports the record-set helpers from recordSet.ts', () => {
		expect(proof.recordSetRoot).toBe(recordSet.recordSetRoot);
		expect(proof.proveRecordInclusion).toBe(recordSet.proveRecordInclusion);
		expect(proof.verifyRecordInclusion).toBe(recordSet.verifyRecordInclusion);
	});

	it('the private copies are gone', () => {
		const verify = read('src/lib/recordProof/verify.ts');
		expect(verify).not.toMatch(/function (canonicalBytes|verifySig)\b/);
		expect(verify).not.toMatch(/from 'canonicalize'|from '@noble\/ed25519'/);
		const sign = read('src/lib/recordProof/signing.ts');
		expect(sign).not.toMatch(/function deriveKeyId\b/);
		expect(sign).not.toMatch(/from 'canonicalize'/);
		expect(read('src/lib/rwaProof/proof.ts')).not.toMatch(/function leafHashOf\b/);
	});
});

describe('isoSign.ts and recordSet.ts stay isomorphic', () => {
	for (const f of ['src/lib/recordProof/isoSign.ts', 'src/lib/rwaProof/recordSet.ts']) {
		it(`${f} imports only @noble, canonicalize and isomorphic recordProof modules`, () => {
			const src = read(f);
			for (const i of importsOf(src)) {
				expect(
					/^@noble\//.test(i) || i === 'canonicalize' || i === '@/lib/recordProof/merkle' || i === '@/lib/recordProof/isoSign',
					`${f} imports ${i}`,
				).toBe(true);
			}
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
			expect(code).not.toMatch(/process\.env|\bBuffer\b|from 'node:|from 'crypto'/);
		});
	}
});
