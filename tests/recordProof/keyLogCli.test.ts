import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalManifestBytes, signManifestWithKey } from '@/lib/recordProof/signing';
import { buildRecordProofFile } from '@/lib/receivables/server/proofFile';
import { createHash } from 'node:crypto';
import { buildRecordProof } from '@/lib/recordProof/buildProof';
import { sampleBreakdown } from './_fixture';

ed.hashes.sha512 = sha512;

/**
 * End to end, the way a stranger and the owner would run them: the owner builds the public key
 * log with scripts/key-log.mjs, and scripts/verify-record.mjs checks a downloaded receivables
 * proof file against that log, with no almstins.com involved. All keys, names and amounts are
 * invented for this suite.
 */

type Out = { code: number; out: string };
const run = (script: string, args: string[], cwd?: string): Out => {
	try {
		return { code: 0, out: execFileSync('node', [join(process.cwd(), 'scripts', script), ...args], { encoding: 'utf8', cwd, stdio: 'pipe' }) };
	} catch (e: any) {
		return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
};

let dir: string;
let logDir: string;
let rootSeedFile: string;
let fingerprint: string;
let recordPub: string;
let keyId: string;
let fileGood: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'almstins-keylog-'));
	logDir = join(dir, 'almstins-keys');
	rootSeedFile = join(dir, 'root.seed');
	process.env.ALMSTINS_SIGNING_KEY = bytesToHex(ed.utils.randomSecretKey());

	const made = run('key-log.mjs', ['new-root', '--out', rootSeedFile]);
	expect(made.code).toBe(0);
	fingerprint = /Root fingerprint: ([0-9a-f]{64})/.exec(made.out)![1];

	// A receivable manifest, signed the way the registry signs one.
	const manifest = { v: 1, kind: 'receivable', supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-001', face: 1234.5, currency: 'USD' };
	const bytes = canonicalManifestBytes(manifest);
	const sig = signManifestWithKey(bytes)!;
	recordPub = sig.publicKeyHex;
	keyId = sig.keyId;
	const digest = createHash('sha256').update(bytes).digest('hex');
	const file = buildRecordProofFile('receivable', digest, {
		manifestJson: JSON.stringify(manifest),
		signatureJson: JSON.stringify({ keyId: sig.keyId, alg: sig.alg, signatureHex: sig.signatureHex, publicKeyHex: sig.publicKeyHex }),
		digest,
		anchorJson: JSON.stringify({ type: 'opentimestamps', digest, receipt: Buffer.from('test-ots-bytes').toString('base64'), anchoredAt: '2026-03-01T10:00:00.000Z' }),
	})!;
	fileGood = join(dir, 'good.proof.json');
	writeFileSync(fileGood, JSON.stringify(file, null, 2));
});
afterAll(() => { delete process.env.ALMSTINS_SIGNING_KEY; });

describe('scripts/key-log.mjs', () => {
	it('new-root writes the seed with mode 600, never prints it, and refuses a path inside a git checkout', () => {
		const seed = readFileSync(rootSeedFile, 'utf8').trim();
		expect(seed).toMatch(/^[0-9a-f]{64}$/);
		const again = run('key-log.mjs', ['new-root', '--out', join(dir, 'root2.seed')]);
		expect(again.out).not.toContain(readFileSync(join(dir, 'root2.seed'), 'utf8').trim());
		const inRepo = run('key-log.mjs', ['new-root', '--out', join(process.cwd(), 'scripts', 'should-not-exist.seed')]);
		expect(inRepo.code).toBe(1);
		expect(inRepo.out).toMatch(/inside a git checkout/);
		expect(existsSync(join(process.cwd(), 'scripts', 'should-not-exist.seed'))).toBe(false);
	});

	it('init and add-key build a log that verifies against the posted fingerprint', () => {
		expect(run('key-log.mjs', ['init', '--log', logDir, '--root-seed', rootSeedFile]).code).toBe(0);
		const add = run('key-log.mjs', ['add-key', '--log', logDir, '--root-seed', rootSeedFile, '--key-id', keyId, '--public-key', recordPub, '--valid-from', '2026-01-01T00:00:00Z']);
		expect(add.code).toBe(0);
		expect(add.out).toContain('ots stamp');
		expect(readFileSync(join(logDir, 'heads', '1.txt'), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
		const v = run('key-log.mjs', ['verify', '--log', logDir, '--root-fingerprint', fingerprint]);
		expect(v.code).toBe(0);
		expect(v.out).toContain(`${keyId}  valid from 2026-01-01T00:00:00Z  in force`);
	});

	it('add-key refuses a key id that does not belong to the key, and a seed that is not the root', () => {
		const other = bytesToHex(ed.getPublicKey(ed.utils.randomSecretKey()));
		const bad = run('key-log.mjs', ['add-key', '--log', logDir, '--root-seed', rootSeedFile, '--key-id', keyId, '--public-key', other, '--valid-from', '2026-01-01T00:00:00Z']);
		expect(bad.out).toMatch(/never paste a seed/);
		const wrongRoot = run('key-log.mjs', ['add-key', '--log', logDir, '--root-seed', join(dir, 'root2.seed'), '--key-id', keyId, '--public-key', recordPub, '--valid-from', '2026-01-01T00:00:00Z']);
		expect(wrongRoot.out).toMatch(/not the log's current root/);
	});
});

describe('scripts/verify-record.mjs with a signed record proof file', () => {
	it('verifies against the key log, dated by the time ots verify gave', () => {
		const r = run('verify-record.mjs', [fileGood, '--key-log', logDir, '--root-fingerprint', fingerprint, '--anchored-at', '2026-03-01T10:00:00Z']);
		expect(r.code).toBe(0);
		expect(r.out).toContain('✅ VERIFIED:');
		expect(r.out).toContain('Signature: valid');
	});

	it('without --anchored-at it is verified but undated', () => {
		const r = run('verify-record.mjs', [fileGood, '--key-log', logDir, '--root-fingerprint', fingerprint]);
		expect(r.code).toBe(0);
		expect(r.out).toContain('VERIFIED (undated)');
	});

	it('a log with the wrong root fingerprint, or none, is refused', () => {
		expect(run('verify-record.mjs', [fileGood, '--key-log', logDir, '--root-fingerprint', 'a'.repeat(64)]).code).toBe(1);
		expect(run('verify-record.mjs', [fileGood, '--key-log', logDir]).out).toMatch(/needs --root-fingerprint/);
	});

	it('the key the file carries alone never verifies: it is self-asserted', () => {
		const r = run('verify-record.mjs', [fileGood]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/UNVERIFIABLE.*matches the key the file carries/s);
	});

	it('an edited manifest is TAMPERED', () => {
		const f = JSON.parse(readFileSync(fileGood, 'utf8'));
		f.manifest.face = 9999;
		const p = join(dir, 'edited.proof.json');
		writeFileSync(p, JSON.stringify(f));
		const r = run('verify-record.mjs', [p, '--key-log', logDir, '--root-fingerprint', fingerprint]);
		expect(r.code).toBe(1);
		expect(r.out).toContain('TAMPERED');
	});

	it('--write-ots saves the exact .ots bytes for ots verify', () => {
		const ots = join(dir, 'rec.ots');
		run('verify-record.mjs', [fileGood, '--pubkey', recordPub, '--write-ots', ots]);
		expect(readFileSync(ots).toString()).toBe('test-ots-bytes');
	});

	it('a Year Summary bundle verifies against the key log too (undated: bundles carry no anchor)', () => {
		const p = join(dir, 'bundle.json');
		writeFileSync(p, JSON.stringify(buildRecordProof('t', 2025, sampleBreakdown(), null, '2025-07-01T00:00:00.000Z')));
		const r = run('verify-record.mjs', [p, '--key-log', logDir, '--root-fingerprint', fingerprint]);
		expect(r.code).toBe(0);
		expect(r.out).toContain('VERIFIED (undated)');
	});

	it('once the key is revoked, the record is REJECTED: its anchor dates the content, not the signature', () => {
		const rev = run('key-log.mjs', ['revoke', '--log', logDir, '--root-seed', rootSeedFile, '--key-id', keyId, '--compromised-since', '2026-06-01T00:00:00Z', '--reason', 'test exposure']);
		expect(rev.code).toBe(0);
		const r = run('verify-record.mjs', [fileGood, '--key-log', logDir, '--root-fingerprint', fingerprint, '--anchored-at', '2026-03-01T10:00:00Z']);
		expect(r.code).toBe(1);
		expect(r.out).toContain('REJECTED');
		expect(r.out).toMatch(/content, not its signature/);
	});
});
