import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	FINGERPRINT_RECORD_TYPES,
	FINGERPRINT_SCHEME,
	faceMinor,
	fingerprintTuples,
	hasDebtorReference,
	normInvoiceNo,
	normParty,
	normRef,
	type FingerprintInput,
} from '../../src/lib/receivables/fingerprintNormalize';

/**
 * src/lib/receivables/fingerprintNormalize.ts: the canonical text the duplicate check hashes (S3).
 * The plan's pins, the edges, and golden vectors. A golden vector failing means the normalizer's
 * output changed: bump the scheme in server/fingerprint.ts (fp1 to fp2) so every stored
 * fingerprint is recomputed, then update the vectors here.
 */

const base: FingerprintInput = {
	recordType: 'invoice', supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042',
	buyerRef: 'PO-00123', face: 1000, currency: 'usd', isTest: false,
};

describe('normRef / normInvoiceNo: the plan pins', () => {
	it('INVOICE 42, INV-42 and inv 42 are the same number', () => {
		expect(normInvoiceNo('INVOICE 42')).toBe('42');
		expect(normInvoiceNo('INV-42')).toBe('42');
		expect(normInvoiceNo('inv 42')).toBe('42');
	});

	it('NOV2024-7 keeps its letters (NO is not followed by a separator or a digit)', () => {
		expect(normInvoiceNo('NOV2024-7')).toBe('NOV20247');
	});

	it('P.O. #123 and PO-00123 are the same reference', () => {
		expect(normRef('P.O. #123')).toBe('123');
		expect(normRef('PO-00123')).toBe('123');
	});
});

describe('normRef: edges', () => {
	it('strips one label, longest first, only before a separator or a digit', () => {
		expect(normRef('Invoice No. 7')).toBe('7');
		expect(normRef('INVOICE NO 0042')).toBe('42');
		expect(normRef('PO123')).toBe('123');
		expect(normRef('Purchase Order: 5521')).toBe('5521');
		expect(normRef('Contract No. 88-A')).toBe('88A');
		expect(normRef('REF/2026/0101')).toBe('20260101');
		expect(normRef('POLAR-9')).toBe('POLAR9');
		// Only one label goes: "INV" then "NO" stays.
		expect(normRef('INV NO-9')).toBe('9');
		expect(normRef('INV-NOV-9')).toBe('NOV9');
	});

	it('keeps the label when no digit would be left', () => {
		expect(normRef('REF ABC')).toBe('REFABC');
		expect(normRef('INVOICE')).toBe('INVOICE');
		expect(normRef('PO-ABC')).toBe('POABC');
	});

	it('drops leading zeros of a leading digit run, keeping one digit', () => {
		expect(normRef('0042')).toBe('42');
		expect(normRef('000')).toBe('0');
		expect(normRef('00A7')).toBe('0A7');
		expect(normRef('A0042')).toBe('A0042');
	});

	it('is empty for nothing usable', () => {
		for (const v of ['', '   ', '#', '---', null, undefined]) expect(normRef(v)).toBe('');
	});

	it('NFKC folds compatibility characters before comparing', () => {
		// Full-width letters and digits.
		expect(normRef('ＩＮＶ－４２')).toBe('42');
	});
});

describe('normParty', () => {
	it('ACME Ltd and Acme Limited are the same party', () => {
		expect(normParty('ACME Ltd')).toBe('acme');
		expect(normParty('Acme Limited')).toBe('acme');
	});

	it('"The Acme Co." is Acme', () => {
		expect(normParty('The Acme Co.')).toBe('acme');
		expect(normParty('Acme')).toBe('acme');
	});

	it('reads & as and, drops periods, and an "and" left by "and Co"', () => {
		expect(normParty('Smith & Co.')).toBe('smith');
		expect(normParty('Smith and Company')).toBe('smith');
		expect(normParty('Bigco P.L.C.')).toBe('bigco');
		expect(normParty('Black & White Ltd')).toBe('blackandwhite');
		expect(normParty("O'Brien Pty Ltd")).toBe('obrien');
		expect(normParty('  ACME   SUPPLIES  LIMITED ')).toBe('acmesupplies');
	});

	it('never strips a name to nothing', () => {
		expect(normParty('Limited')).toBe('limited');
		expect(normParty('The')).toBe('the');
		expect(normParty('Ltd. & Co.')).toBe('ltd');
		expect(normParty('')).toBe('');
	});

	it('keeps letters outside ASCII (no accent folding in fp1)', () => {
		expect(normParty('Société Générale S.A.')).toBe('sociétégénérale');
		expect(normParty('Societe Generale SA')).toBe('societegenerale');
	});
});

describe('faceMinor', () => {
	it('is the amount in minor units as text', () => {
		expect(faceMinor(1000)).toBe('100000');
		expect(faceMinor(12.5)).toBe('1250');
		expect(faceMinor('2500')).toBe('250000');
	});
});

describe('fingerprintTuples', () => {
	it('builds the strong key only with a debtor reference, and the fallback with supplier and number', () => {
		expect(fingerprintTuples(base)).toEqual({
			ref: 'v1|invoice|ref|r|bigco|123|USD|100000',
			inv: 'v1|invoice|inv|r|bigco|acmesupplies|42|USD|100000',
		});
		expect(fingerprintTuples({ ...base, buyerRef: null }).ref).toBeNull();
		expect(fingerprintTuples({ ...base, buyerRef: '  ' }).ref).toBeNull();
		expect(hasDebtorReference({ ...base, buyerRef: '#' })).toBe(false);
		expect(hasDebtorReference(base)).toBe(true);
	});

	it('an empty or unusable invoice number leaves no fallback key', () => {
		expect(fingerprintTuples({ ...base, invoiceNo: '' }).inv).toBeNull();
		expect(fingerprintTuples({ ...base, invoiceNo: '--' }).inv).toBeNull();
		expect(fingerprintTuples({ ...base, supplier: '' }).inv).toBeNull();
	});

	it('cosmetic differences give the same text', () => {
		const typedAgain: FingerprintInput = {
			...base, supplier: 'ACME SUPPLIES LIMITED', buyer: 'BIGCO P.L.C.', invoiceNo: 'inv 42', buyerRef: 'P.O. #123', currency: ' USD ',
		};
		expect(fingerprintTuples(typedAgain)).toEqual(fingerprintTuples(base));
	});

	it('a test record and a real record never give the same text', () => {
		const real = fingerprintTuples(base);
		const test = fingerprintTuples({ ...base, isTest: true });
		expect(test.ref).not.toBe(real.ref);
		expect(test.inv).not.toBe(real.inv);
		expect(test.inv!.split('|')[3]).toBe('t');
	});

	it('the scheme and record type lead every tuple, so record types never collide', () => {
		expect(FINGERPRINT_SCHEME).toBe('v1');
		expect(FINGERPRINT_RECORD_TYPES).toEqual(['invoice']);
		const t = fingerprintTuples(base);
		for (const tuple of [t.ref!, t.inv!]) expect(tuple.split('|').slice(0, 2)).toEqual(['v1', 'invoice']);
	});

	it('amount and currency are part of both keys', () => {
		const t = fingerprintTuples(base);
		expect(fingerprintTuples({ ...base, face: 1000.01 })).not.toEqual(t);
		expect(fingerprintTuples({ ...base, currency: 'NGN' }).inv).not.toBe(t.inv);
		expect(fingerprintTuples({ ...base, currency: '' }).inv).toBe('v1|invoice|inv|r|bigco|acmesupplies|42|NGN|100000');
	});

	it('every field is letters and digits, so the | join cannot be ambiguous', () => {
		const t = fingerprintTuples({ ...base, supplier: 'A|B Ltd', buyer: 'C|D', invoiceNo: '4|2', buyerRef: '1|2', currency: 'U|S' });
		expect(t.ref!.split('|')).toHaveLength(8);
		expect(t.inv!.split('|')).toHaveLength(9);
	});

	it('golden vectors (fp1)', () => {
		expect(fingerprintTuples({
			recordType: 'invoice', supplier: 'The Acme Co.', buyer: 'Société Générale S.A.', invoiceNo: 'Invoice No. 7',
			face: 12.5, currency: 'ngn', isTest: true,
		})).toEqual({ ref: null, inv: 'v1|invoice|inv|t|sociétégénérale|acme|7|NGN|1250' });
		expect(fingerprintTuples({
			recordType: 'invoice', supplier: 'Kano Grains & Co. Ltd', buyer: 'The Lagos Mills PLC', invoiceNo: 'INV/2026/000318',
			buyerRef: 'PO No. 004417', face: 1234.5, currency: 'NGN', isTest: false,
		})).toEqual({
			ref: 'v1|invoice|ref|r|lagosmills|4417|NGN|123450',
			inv: 'v1|invoice|inv|r|lagosmills|kanograins|2026000318|NGN|123450',
		});
	});
});

describe('source', () => {
	it('imports only normalizeName and names no rtype', () => {
		const src = fs.readFileSync(fileURLToPath(new URL('../../src/lib/receivables/fingerprintNormalize.ts', import.meta.url)), 'utf8');
		expect([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['@/lib/verifyNameMatch']);
		expect(src).not.toMatch(/purchase_order|contract_|'contract'/);
	});
});
