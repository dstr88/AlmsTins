import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
	computeFingerprints,
	fingerprintKeyAvailable,
	fingerprintKeyPresent,
	fingerprintKid,
} from '../../src/lib/receivables/server/fingerprint';
import { fingerprintTuples, type FingerprintInput } from '../../src/lib/receivables/fingerprintNormalize';

/**
 * src/lib/receivables/server/fingerprint.ts: the keyed hash behind the duplicate check (S3).
 * Keys are generated here and set with vi.stubEnv; none is a real one.
 */

const INPUT: FingerprintInput = {
	recordType: 'invoice', supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042',
	buyerRef: 'PO-00123', face: 1000, currency: 'USD', isTest: false,
};

let logs: unknown[][];
beforeEach(() => {
	logs = [];
	for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a); });
	}
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text, 'utf8').digest('hex');

describe('the key', () => {
	it('accepts 64 hex characters and base64 of 32 bytes', () => {
		const key = randomBytes(32);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key.toString('hex'));
		expect(fingerprintKeyAvailable()).toBe(true);
		const fromHex = computeFingerprints(INPUT);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key.toString('base64'));
		expect(fingerprintKeyAvailable()).toBe(true);
		expect(computeFingerprints(INPUT)).toEqual(fromHex);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', `  ${key.toString('hex').toUpperCase()}\n`);
		expect(computeFingerprints(INPUT)).toEqual(fromHex);
	});

	it('a missing or wrong-length key is unavailable: null, never a throw', () => {
		for (const bad of ['', '   ', randomBytes(16).toString('hex'), randomBytes(31).toString('base64'), randomBytes(33).toString('base64'), 'not a key']) {
			vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', bad);
			expect(fingerprintKeyAvailable(), bad).toBe(false);
			expect(fingerprintKid(), bad).toBeNull();
			expect(computeFingerprints(INPUT), bad).toBeNull();
		}
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		expect(fingerprintKeyPresent()).toBe(false);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', 'not a key');
		expect(fingerprintKeyPresent()).toBe(true);
	});
});

describe('computeFingerprints', () => {
	it('is HMAC-SHA256 of each tuple, hex, with the kid fp1- plus 12 hex of the key hash', () => {
		const key = randomBytes(32);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key.toString('hex'));
		const t = fingerprintTuples(INPUT);
		const kid = `fp1-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
		expect(fingerprintKid()).toBe(kid);
		expect(kid).toMatch(/^fp1-[0-9a-f]{12}$/);
		expect(computeFingerprints(INPUT)).toEqual({ ref: hmac(key, t.ref!), inv: hmac(key, t.inv!), kid });
	});

	it('no debtor reference: ref is null and inv is still there', () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		const fp = computeFingerprints({ ...INPUT, buyerRef: null })!;
		expect(fp.ref).toBeNull();
		expect(fp.inv).toMatch(/^[0-9a-f]{64}$/);
	});

	it('another key gives other hashes and another kid', () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		const a = computeFingerprints(INPUT)!;
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		const b = computeFingerprints(INPUT)!;
		expect(b.ref).not.toBe(a.ref);
		expect(b.inv).not.toBe(a.inv);
		expect(b.kid).not.toBe(a.kid);
	});

	it('never throws on odd input', () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
		const odd = { recordType: 'invoice', supplier: null, buyer: undefined, invoiceNo: {}, buyerRef: 7, face: NaN, currency: null, isTest: 'x' } as unknown as FingerprintInput;
		expect(() => computeFingerprints(odd)).not.toThrow();
	});

	it('logs nothing, so neither the key nor a tuple can reach a log', () => {
		const key = randomBytes(32);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', key.toString('hex'));
		computeFingerprints(INPUT);
		fingerprintKid();
		fingerprintKeyAvailable();
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', 'bad');
		computeFingerprints(INPUT);
		expect(logs).toEqual([]);
	});
});
