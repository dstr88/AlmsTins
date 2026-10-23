import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// @ts-ignore: plain ESM shared with the standalone scripts
import * as kl from '../../scripts/keylog.mjs';

ed.hashes.sha512 = sha512;

/**
 * The public key log (scripts/keylog.mjs): its chain and root-signature rules, and the rule that
 * decides whether a record signature counts once a key is retired or revoked. Keys are generated
 * in-test; nothing here reads a real secret.
 */

const newKey = () => {
	const seed = ed.utils.randomSecretKey();
	return { seed, pub: bytesToHex(ed.getPublicKey(seed)) };
};

const T0 = '2026-01-01T00:00:00.000Z';

function buildLog() {
	const root = newKey();
	const A = newKey();
	const entries: any[] = [];
	entries.push(kl.appendEntry(entries, { type: 'root', key_id: kl.deriveRootId(root.pub), public_key_hex: root.pub }, root.seed, T0));
	entries.push(kl.appendEntry(entries, { type: 'key-added', key_id: kl.deriveKeyId(A.pub), public_key_hex: A.pub, at: '2025-06-01T00:00:00Z' }, root.seed, '2026-01-02T00:00:00.000Z'));
	return { root, A, entries };
}

describe('verifyLog', () => {
	it('accepts a well-formed log, folds the key state and checks the posted root fingerprint', () => {
		const { root, A, entries } = buildLog();
		const s = kl.verifyLog(entries, { expectedRootFingerprint: kl.rootFingerprint(root.pub) });
		expect(s.ok).toBe(true);
		expect(s.head).toBe(kl.entryHash(entries[1]));
		expect(s.keys.get(kl.deriveKeyId(A.pub))).toMatchObject({ public_key_hex: A.pub, valid_from: '2025-06-01T00:00:00Z', retired_at: null, compromised_since: null });
		expect(kl.verifyLog(entries, { expectedRootFingerprint: kl.rootFingerprint(newKey().pub) }).ok).toBe(false);
	});

	it('round-trips through log.jsonl lines', () => {
		const { entries } = buildLog();
		const text = entries.map((e: any) => kl.entryLine(e)).join('\n') + '\n';
		expect(kl.verifyLog(kl.parseLog(text)).ok).toBe(true);
	});

	it('rejects an edited, reordered, truncated-at-the-root or re-signed log', () => {
		const { entries } = buildLog();
		const edited = entries.map((e: any) => ({ ...e }));
		edited[1].at = '2020-01-01T00:00:00Z';
		expect(kl.verifyLog(edited).ok).toBe(false);
		expect(kl.verifyLog([entries[1], entries[0]]).ok).toBe(false);
		expect(kl.verifyLog([entries[1]]).ok).toBe(false);
		expect(kl.verifyLog([]).ok).toBe(false);
		// An entry signed by any key other than the root, even a genuine record key, is refused.
		const thief = newKey();
		const forged: any = { ...entries[1] };
		delete forged.root_sig;
		forged.root_sig = bytesToHex(ed.sign(kl.entrySigningBytes(forged), thief.seed));
		expect(kl.verifyLog([entries[0], forged]).errors.join()).toMatch(/root signature/);
	});

	it('refuses a key id that is not derived from its key (the pasted-seed guard)', () => {
		const { root, entries } = buildLog();
		const B = newKey();
		expect(() => kl.appendEntry(entries, { type: 'key-added', key_id: kl.deriveKeyId(newKey().pub), public_key_hex: B.pub }, root.seed)).toThrow(/key_id/);
	});

	it('a revocation is final, needs a known key, and may be dated before it was recorded', () => {
		const { root, A, entries } = buildLog();
		const id = kl.deriveKeyId(A.pub);
		expect(() => kl.appendEntry(entries, { type: 'key-revoked', key_id: kl.deriveKeyId(newKey().pub), public_key_hex: newKey().pub }, root.seed)).toThrow();
		entries.push(kl.appendEntry(entries, { type: 'key-revoked', key_id: id, public_key_hex: A.pub, at: '2025-09-01T00:00:00Z', reason: 'test exposure' }, root.seed, '2026-02-01T00:00:00.000Z'));
		expect(kl.verifyLog(entries).keys.get(id)).toMatchObject({ compromised_since: '2025-09-01T00:00:00Z', revoke_reason: 'test exposure' });
		expect(() => kl.appendEntry(entries, { type: 'key-revoked', key_id: id, public_key_hex: A.pub }, root.seed)).toThrow(/final/);
		expect(() => kl.appendEntry(entries, { type: 'key-retired', key_id: id, public_key_hex: A.pub }, root.seed)).toThrow(/final/);
	});

	it('refuses recorded_at going backwards', () => {
		const { root, A, entries } = buildLog();
		expect(() => kl.appendEntry(entries, { type: 'key-retired', key_id: kl.deriveKeyId(A.pub), public_key_hex: A.pub, at: T0 }, root.seed, '2025-12-31T00:00:00.000Z')).toThrow(/backwards/);
	});

	it('after a root rotation, only the new root signs', () => {
		const { root, entries } = buildLog();
		const root2 = newKey();
		entries.push(kl.appendEntry(entries, { type: 'root-rotated', key_id: kl.deriveRootId(root2.pub), public_key_hex: root2.pub }, root.seed, '2026-03-01T00:00:00.000Z'));
		const B = newKey();
		const add = { type: 'key-added', key_id: kl.deriveKeyId(B.pub), public_key_hex: B.pub };
		expect(() => kl.appendEntry(entries, add, root.seed, '2026-03-02T00:00:00.000Z')).toThrow(/root signature/);
		entries.push(kl.appendEntry(entries, add, root2.seed, '2026-03-02T00:00:00.000Z'));
		expect(kl.verifyLog(entries, { expectedRootFingerprint: kl.rootFingerprint(root.pub) }).ok).toBe(true);
	});
});

describe('judgeSignature', () => {
	const stateWith = (mutate?: (entries: any[], root: any, A: any) => void) => {
		const { root, A, entries } = buildLog();
		mutate?.(entries, root, A);
		const s = kl.verifyLog(entries);
		expect(s.ok).toBe(true);
		return { s, keyId: kl.deriveKeyId(A.pub), pub: A.pub };
	};
	const revoked = (since: string) => stateWith((entries, root, A) => {
		entries.push(kl.appendEntry(entries, { type: 'key-revoked', key_id: kl.deriveKeyId(A.pub), public_key_hex: A.pub, at: since, reason: 'test' }, root.seed, '2026-05-01T00:00:00.000Z'));
	});

	it('a key in force: trusted when dated, trusted-undated when not', () => {
		const { s, keyId, pub } = stateWith();
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, contentAnchoredAt: '2026-02-01T00:00:00Z' }).verdict).toBe('trusted');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub }).verdict).toBe('trusted-undated');
	});

	it('an unknown key, or a known id carrying a different public key, is not trusted', () => {
		const { s, keyId } = stateWith();
		expect(kl.judgeSignature(s, { keyId: 'almstins-0000000000000000' }).verdict).toBe('unknown-key');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: newKey().pub }).verdict).toBe('unknown-key');
	});

	it('revoked: only a signature proven before compromised_since (less the block-time margin) counts', () => {
		const { s, keyId, pub } = revoked('2026-04-01T00:00:00Z');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, signatureProvenAt: '2026-03-31T12:00:00Z' }).verdict).toBe('trusted');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, signatureProvenAt: '2026-03-31T23:00:00Z' }).verdict).toBe('rejected');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, signatureProvenAt: '2026-04-02T00:00:00Z' }).verdict).toBe('rejected');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub }).verdict).toBe('rejected');
	});

	it('revoked: a content anchor never rescues a signature, because anyone can anchor any content', () => {
		const { s, keyId, pub } = revoked('2026-04-01T00:00:00Z');
		const j = kl.judgeSignature(s, { keyId, publicKeyHex: pub, contentAnchoredAt: '2025-07-01T00:00:00Z' });
		expect(j.verdict).toBe('rejected');
		expect(j.reason).toMatch(/content, not its signature/);
	});

	it('retired: accepted when the record is shown to exist within the grace after retirement', () => {
		const { s, keyId, pub } = stateWith((entries, root, A) => {
			entries.push(kl.appendEntry(entries, { type: 'key-retired', key_id: kl.deriveKeyId(A.pub), public_key_hex: A.pub, at: '2026-04-01T00:00:00Z' }, root.seed, '2026-04-01T00:00:00.000Z'));
		});
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, contentAnchoredAt: '2026-04-05T00:00:00Z' }).verdict).toBe('trusted');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub, contentAnchoredAt: '2026-05-01T00:00:00Z' }).verdict).toBe('rejected');
		expect(kl.judgeSignature(s, { keyId, publicKeyHex: pub }).verdict).toBe('trusted-undated');
	});
});
