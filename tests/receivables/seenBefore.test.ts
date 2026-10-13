import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	FOUND_ONLY_KEYS,
	FULL_ANSWER_KEYS,
	NEVER_RETURNED,
	SEEN_BEFORE_LIMITS,
	SEEN_BEFORE_MATCHES_CAP,
	SEEN_BEFORE_MAX_BYTES,
	foundOnly,
	parseSeenBeforeBody,
	summarizeMatches,
	toFingerprintInput,
	type SeenBeforeRow,
} from '../../src/lib/receivables/seenBefore';
import {
	SEEN_BEFORE_INVALID_BODY,
	SEEN_BEFORE_INVALID_BUYER_REF,
	SEEN_BEFORE_INVALID_CURRENCY,
	SEEN_BEFORE_INVALID_FACE,
	SEEN_BEFORE_INVALID_NAMES,
	SEEN_BEFORE_INVALID_PARTIES,
} from '../../src/lib/receivables/copy/seenBefore';
import { fingerprintTuples } from '../../src/lib/receivables/fingerprintNormalize';

/**
 * "Seen before?" (S5), the pure half: reading the request body and building the answer
 * (src/lib/receivables/seenBefore.ts). The store's SQL is in seenBeforeStore.test.ts.
 */

const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD' };
const body = (over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({ invoice: { ...INVOICE, ...over }, ...top });
const messageOf = (b: unknown) => {
	const r = parseSeenBeforeBody(b);
	return r.ok ? null : r.message;
};

describe('parseSeenBeforeBody', () => {
	it('reads a full body, trimmed, with no clamp or default applied', () => {
		expect(parseSeenBeforeBody(body({ supplier: '  Acme Supplies Ltd ', buyerRef: ' PO-00123 ', currency: ' usd ' }, { test: true }))).toEqual({
			ok: true,
			input: { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', buyerRef: 'PO-00123', face: 1000, currency: 'usd', isTest: true },
		});
	});

	it('a body that is not { invoice: { ... } }', () => {
		for (const b of [null, undefined, 'x', 42, true, [], [body()], {}, { invoice: null }, { invoice: 'INV-0042' }, { invoice: [INVOICE] }, { ...INVOICE }]) {
			expect(messageOf(b), JSON.stringify(b)).toBe(SEEN_BEFORE_INVALID_BODY);
		}
	});

	it('the supplier, the debtor and the invoice number must each be non-empty text', () => {
		for (const field of ['supplier', 'buyer', 'invoiceNo']) {
			for (const bad of [undefined, null, '', '   ', 42, ['x'], { x: 1 }]) {
				expect(messageOf(body({ [field]: bad })), `${field}=${JSON.stringify(bad)}`).toBe(SEEN_BEFORE_INVALID_PARTIES);
			}
		}
	});

	it('the currency must be non-empty text, checked before any default could make it NGN', () => {
		for (const bad of [undefined, null, '', '  ', 840]) {
			expect(messageOf(body({ currency: bad })), JSON.stringify(bad)).toBe(SEEN_BEFORE_INVALID_CURRENCY);
		}
		// The parse never fills it in: an NGN check must say NGN.
		const ngn = parseSeenBeforeBody(body({ currency: 'NGN' }));
		expect(ngn.ok && ngn.input.currency).toBe('NGN');
	});

	it('the face must be a finite JSON number above zero; a numeric string is not one', () => {
		for (const bad of ['1000', '1e3', undefined, null, 0, -1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, true, [1000]]) {
			expect(messageOf(body({ face: bad })), String(bad)).toBe(SEEN_BEFORE_INVALID_FACE);
		}
		const cents = parseSeenBeforeBody(body({ face: 0.01 }));
		expect(cents.ok && cents.input.face).toBe(0.01);
	});

	it('buyerRef: text when sent; null, absent or blank read as none', () => {
		for (const bad of [42, true, ['PO-1'], { po: 1 }]) {
			expect(messageOf(body({ buyerRef: bad })), JSON.stringify(bad)).toBe(SEEN_BEFORE_INVALID_BUYER_REF);
		}
		for (const none of [undefined, null, '', '   ']) {
			const r = parseSeenBeforeBody(body({ buyerRef: none }));
			expect(r.ok && r.input.buyerRef, JSON.stringify(none)).toBeNull();
		}
	});

	it('names or an invoice number of punctuation alone have no invoice key', () => {
		for (const over of [{ supplier: '...' }, { buyer: '-- / --' }, { buyer: '. ,' }, { invoiceNo: '#-/' }]) {
			expect(messageOf(body(over)), JSON.stringify(over)).toBe(SEEN_BEFORE_INVALID_NAMES);
		}
		// A legal form alone is still a name (normParty keeps the last word).
		expect(parseSeenBeforeBody(body({ supplier: 'Ltd' })).ok).toBe(true);
	});

	it('"test" counts only when exactly true', () => {
		for (const [t, want] of [[true, true], [false, false], ['true', false], [1, false], [undefined, false], [null, false]] as const) {
			const r = parseSeenBeforeBody(body({}, { test: t }));
			expect(r.ok && r.input.isTest, String(t)).toBe(want);
		}
		// A "test" inside the invoice is not the flag.
		const inner = parseSeenBeforeBody(body({ test: true }));
		expect(inner.ok && inner.input.isTest).toBe(false);
	});

	it('checks in order: shape, names, currency, face, buyerRef, then the key', () => {
		expect(messageOf(body({ supplier: '', currency: '', face: 0 }))).toBe(SEEN_BEFORE_INVALID_PARTIES);
		expect(messageOf(body({ currency: '', face: 0 }))).toBe(SEEN_BEFORE_INVALID_CURRENCY);
		expect(messageOf(body({ face: 0, buyerRef: 1 }))).toBe(SEEN_BEFORE_INVALID_FACE);
		expect(messageOf(body({ buyerRef: 1, supplier: '...' }))).toBe(SEEN_BEFORE_INVALID_BUYER_REF);
	});

	it('the fingerprint input is the create path\'s invoice input: same tuples as the typed record', () => {
		const r = parseSeenBeforeBody(body({ buyerRef: 'PO-00123' }, { test: true }));
		if (!r.ok) throw new Error(r.message);
		const fp = toFingerprintInput(r.input);
		expect(fp).toEqual({ recordType: 'invoice', ...INVOICE, buyerRef: 'PO-00123', isTest: true });
		// Typed differently, the same invoice key; only the debtor reference key needs a reference.
		const other = parseSeenBeforeBody(body({ supplier: 'ACME SUPPLIES LIMITED', invoiceNo: 'inv 42', currency: 'usd' }, { test: true }));
		if (!other.ok) throw new Error(other.message);
		expect(fingerprintTuples(toFingerprintInput(other.input)).inv).toBe(fingerprintTuples(fp).inv);
		expect(fingerprintTuples(toFingerprintInput(other.input)).ref).toBeNull();
	});
});

// ── summarizeMatches ────────────────────────────────────────────────────────

const row = (over: Partial<SeenBeforeRow> = {}): SeenBeforeRow => ({
	face: 1000, claimed: 0, encumbered: false, anyAffirmed: false, anyUnaffirmed: false,
	debtorConfirmed: false, debtorDisputed: false, settled: false, withdrawn: false, refMatch: false,
	createdDay: '2026-10-01', ...over,
});
const AT = '2026-10-12T15:00:00.000Z';
const sum = (rows: SeenBeforeRow[], o: { refChecked?: boolean; test?: boolean } = {}) =>
	summarizeMatches(rows, { refChecked: o.refChecked ?? false, test: o.test ?? false, checkedAt: AT });

describe('summarizeMatches', () => {
	it('no rows: not_found, with nothing that could read as a finding', () => {
		expect(sum([], { refChecked: true, test: true })).toEqual({
			v: 1, found: false, matches: 0, status: 'not_found', anyFinanced: false, financing: 'none',
			claimsAffirmed: 'none', anySettled: false, debtor: 'none', withdrawn: false,
			refChecked: true, refMatch: false, firstSeen: null, test: true, checkedAt: AT,
		});
	});

	it('status: financed outranks settled, settled outranks recorded', () => {
		expect(sum([row()]).status).toBe('recorded');
		expect(sum([row(), row({ settled: true })]).status).toBe('settled');
		expect(sum([row({ settled: true }), row({ encumbered: true, claimed: 10 })]).status).toBe('financed');
		// A record both settled and still claimed against is financed.
		expect(sum([row({ settled: true, encumbered: true, claimed: 10 })]).status).toBe('financed');
	});

	it('anyFinanced, anySettled and withdrawn are any-of', () => {
		const a = sum([row(), row({ encumbered: true, claimed: 1, settled: true, withdrawn: true })]);
		expect([a.anyFinanced, a.anySettled, a.withdrawn]).toEqual([true, true, true]);
		const b = sum([row(), row()]);
		expect([b.anyFinanced, b.anySettled, b.withdrawn]).toEqual([false, false, false]);
	});

	it('financing is the worst single record, never a sum across records', () => {
		expect(sum([row({ claimed: 0 })]).financing).toBe('none');
		expect(sum([row({ claimed: 999.99 })]).financing).toBe('partial');
		expect(sum([row({ claimed: 1000 })]).financing).toBe('full');
		expect(sum([row({ claimed: 1000.01 })]).financing).toBe('over');
		// Two records each 60% financed: partial, not over.
		expect(sum([row({ claimed: 600 }), row({ claimed: 600 })]).financing).toBe('partial');
		expect(sum([row({ claimed: 400 }), row({ claimed: 1000 }), row({ claimed: 200 })]).financing).toBe('full');
		expect(sum([row({ claimed: 1200 }), row({ claimed: 0 })]).financing).toBe('over');
		// Per record, against its own face.
		expect(sum([row({ face: 500, claimed: 600 }), row({ face: 5000, claimed: 600 })]).financing).toBe('over');
	});

	it('claimsAffirmed: all, some or none, across every record', () => {
		expect(sum([row()]).claimsAffirmed).toBe('none');
		expect(sum([row({ anyUnaffirmed: true })]).claimsAffirmed).toBe('none');
		expect(sum([row({ anyAffirmed: true })]).claimsAffirmed).toBe('all');
		expect(sum([row({ anyAffirmed: true }), row()]).claimsAffirmed).toBe('all');
		expect(sum([row({ anyAffirmed: true, anyUnaffirmed: true })]).claimsAffirmed).toBe('some');
		expect(sum([row({ anyAffirmed: true }), row({ anyUnaffirmed: true })]).claimsAffirmed).toBe('some');
	});

	it('debtor: a dispute outranks a confirmation', () => {
		expect(sum([row()]).debtor).toBe('none');
		expect(sum([row({ debtorConfirmed: true })]).debtor).toBe('confirmed');
		expect(sum([row({ debtorDisputed: true })]).debtor).toBe('disputed');
		expect(sum([row({ debtorConfirmed: true }), row({ debtorDisputed: true })]).debtor).toBe('disputed');
		expect(sum([row({ debtorConfirmed: true, debtorDisputed: true })]).debtor).toBe('disputed');
	});

	it('refMatch needs refChecked; refChecked echoes the request', () => {
		expect(sum([row({ refMatch: true })], { refChecked: true })).toMatchObject({ refChecked: true, refMatch: true });
		expect(sum([row(), row({ refMatch: true })], { refChecked: true })).toMatchObject({ refChecked: true, refMatch: true });
		expect(sum([row()], { refChecked: true })).toMatchObject({ refChecked: true, refMatch: false });
		expect(sum([row({ refMatch: true })], { refChecked: false })).toMatchObject({ refChecked: false, refMatch: false });
	});

	it('firstSeen is the earliest day', () => {
		expect(sum([row({ createdDay: '2026-10-03' }), row({ createdDay: '2026-09-30' }), row({ createdDay: '2026-10-01' })]).firstSeen).toBe('2026-09-30');
		expect(sum([row({ createdDay: '2025-12-31' })]).firstSeen).toBe('2025-12-31');
	});

	it('matches counts up to five, then says five', () => {
		expect(SEEN_BEFORE_MATCHES_CAP).toBe(5);
		for (const [n, want] of [[1, 1], [3, 3], [5, 5], [6, 5], [50, 5]]) {
			const a = sum(Array.from({ length: n }, () => row()));
			expect(a.matches, String(n)).toBe(want);
			expect(a.found).toBe(true);
		}
	});

	it('test and checkedAt echo', () => {
		expect(sum([row()], { test: true })).toMatchObject({ test: true, checkedAt: AT });
		expect(sum([row()], { test: false })).toMatchObject({ test: false, checkedAt: AT });
	});
});

describe('the answer\'s keys', () => {
	const full = sum([row({ encumbered: true, claimed: 1000, debtorDisputed: true, refMatch: true, withdrawn: true })], { refChecked: true, test: true });

	it('the full answer has exactly FULL_ANSWER_KEYS, in order', () => {
		expect(Object.keys(full)).toEqual([...FULL_ANSWER_KEYS]);
		expect(Object.keys(sum([]))).toEqual([...FULL_ANSWER_KEYS]);
	});

	it('foundOnly has exactly FOUND_ONLY_KEYS, in order, and the same values', () => {
		expect(FOUND_ONLY_KEYS).toEqual(['v', 'found', 'test', 'checkedAt']);
		expect(Object.keys(foundOnly(full))).toEqual([...FOUND_ONLY_KEYS]);
		expect(foundOnly(full)).toEqual({ v: 1, found: true, test: true, checkedAt: AT });
		expect(foundOnly(sum([]))).toEqual({ v: 1, found: false, test: false, checkedAt: AT });
		for (const k of FOUND_ONLY_KEYS) expect(FULL_ANSWER_KEYS).toContain(k);
	});

	it('no NEVER_RETURNED key at any tier, and the list holds what must never leave', () => {
		for (const k of NEVER_RETURNED) {
			expect(FULL_ANSWER_KEYS as readonly string[]).not.toContain(k);
			expect(full).not.toHaveProperty(k);
			expect(foundOnly(full)).not.toHaveProperty(k);
		}
		for (const k of ['id', 'tenant_id', 'tenantId', 'invoiceNo', 'face', 'amount', 'fingerprint_inv', 'fingerprint_ref', 'count']) {
			expect(NEVER_RETURNED as readonly string[]).toContain(k);
		}
	});

	it('the limits are the spec\'s', () => {
		expect(SEEN_BEFORE_MAX_BYTES).toBe(4096);
		expect(SEEN_BEFORE_LIMITS).toEqual({ perTenantPerMinute: 60, perIpPerMinute: 120 });
	});
});

describe('purity', () => {
	const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
	const importsOf = (src: string) => [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'|\bimport\(\s*'([^']+)'\s*\)/gm)].map((m) => m[1] ?? m[2]);

	it('seenBefore.ts imports only the pure receivables modules and its copy', () => {
		const allowed = ['./fingerprintNormalize', './status', './attestationClass', './copy/seenBefore'];
		const specs = importsOf(read('src/lib/receivables/seenBefore.ts'));
		expect(specs.length).toBeGreaterThan(0);
		expect(specs.filter((s) => !allowed.includes(s))).toEqual([]);
	});

	it('copy/seenBefore.ts is import-free', () => {
		expect(importsOf(read('src/lib/receivables/copy/seenBefore.ts'))).toEqual([]);
	});
});
