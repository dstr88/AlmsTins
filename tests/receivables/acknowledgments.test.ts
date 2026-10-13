import { describe, it, expect } from 'vitest';
import {
	ACK_CODES,
	NOTICE_CODES,
	isAckCode,
	resolveAcknowledged,
	shouldRaise,
	withAcknowledged,
	type AckCode,
} from '../../src/lib/receivables/acknowledgments';
import { canonicalBytes } from '../../src/lib/recordProof/isoSign';

/**
 * src/lib/receivables/acknowledgments.ts: which raised warnings a write signs as acknowledged,
 * and that an empty acknowledgment leaves a manifest exactly as it was (same object, same bytes),
 * so every record written before acknowledgments existed keeps its digest.
 */

const MANIFEST = { v: 1, kind: 'financing_claim', receivableId: 'c0'.repeat(32), financier: 'Lender Co', amount: 250, currency: 'USD', date: '2026-10-01' };

describe('resolveAcknowledged', () => {
	it('signs the intersection of raised and requested, sorted and without duplicates', () => {
		expect(resolveAcknowledged(['exceeds_headroom'], ['exceeds_headroom', 'exceeds_headroom'])).toEqual({
			acknowledged: ['exceeds_headroom'], outstanding: [], unknown: [],
		});
		expect(resolveAcknowledged(['exceeds_headroom', 'exceeds_headroom'], ['exceeds_headroom']).acknowledged).toEqual(['exceeds_headroom']);
	});

	it('a code raised but not requested is outstanding', () => {
		expect(resolveAcknowledged(['exceeds_headroom'], [])).toEqual({ acknowledged: [], outstanding: ['exceeds_headroom'], unknown: [] });
	});

	it('a code requested but not raised acknowledges nothing', () => {
		expect(resolveAcknowledged([], ['exceeds_headroom'])).toEqual({ acknowledged: [], outstanding: [], unknown: [] });
	});

	it('unknown requested codes are reported, never thrown', () => {
		let r: ReturnType<typeof resolveAcknowledged> | undefined;
		expect(() => { r = resolveAcknowledged(['exceeds_headroom'], ['nope', 42, 'exceeds_headroom', 'nope']); }).not.toThrow();
		expect(r).toEqual({ acknowledged: ['exceeds_headroom'], outstanding: [], unknown: ['42', 'nope'] });
		expect(resolveAcknowledged([], [null, undefined, {}]).unknown).toEqual(['[object Object]', 'null', 'undefined']);
	});

	it('isAckCode knows exactly ACK_CODES', () => {
		expect(ACK_CODES).toEqual(['exceeds_headroom', 'possible_duplicate']);
		for (const c of ACK_CODES) expect(isAckCode(c)).toBe(true);
		for (const c of ['EXCEEDS_HEADROOM', 'diligence_required', '', 1, null, undefined, ['exceeds_headroom']]) expect(isAckCode(c)).toBe(false);
	});
});

describe('S3 codes', () => {
	it('possible_duplicate is signed only when raised and requested', () => {
		expect(resolveAcknowledged(['exceeds_headroom', 'possible_duplicate'], ['possible_duplicate'])).toEqual({
			acknowledged: ['possible_duplicate'], outstanding: ['exceeds_headroom'], unknown: [],
		});
		expect(resolveAcknowledged([], ['possible_duplicate'])).toEqual({ acknowledged: [], outstanding: [], unknown: [] });
		expect(resolveAcknowledged(['possible_duplicate', 'exceeds_headroom'], ['possible_duplicate', 'exceeds_headroom']).acknowledged)
			.toEqual(['exceeds_headroom', 'possible_duplicate']);
	});

	it('notice codes are informational and sorted', () => {
		expect(NOTICE_CODES).toEqual(['duplicate_check_unavailable', 'possible_duplicate']);
		expect(isAckCode('duplicate_check_unavailable')).toBe(false);
	});

	it('shouldRaise only for an explicit acceptsWarnings: true', () => {
		expect(shouldRaise({ acceptsWarnings: true })).toBe(true);
		for (const body of [{}, { acceptsWarnings: 'true' }, { acceptsWarnings: 1 }, { acceptsWarnings: false }, null, undefined, 'acceptsWarnings', []]) {
			expect(shouldRaise(body)).toBe(false);
		}
	});
});

describe('withAcknowledged', () => {
	it('an empty list returns the same object, with the same canonical bytes', () => {
		const m = { ...MANIFEST };
		const out = withAcknowledged(m, []);
		expect(out).toBe(m);
		expect(out).not.toHaveProperty('acknowledged');
		expect(canonicalBytes(out)).toEqual(canonicalBytes(m));
		expect(JSON.stringify(out)).toBe(JSON.stringify(MANIFEST));
	});

	it('a non-empty list is added as the last key, as a copy', () => {
		const m = { ...MANIFEST };
		const codes: AckCode[] = ['exceeds_headroom'];
		const out = withAcknowledged(m, codes);
		expect(out).not.toBe(m);
		expect(Object.keys(out).at(-1)).toBe('acknowledged');
		expect(out.acknowledged).toEqual(['exceeds_headroom']);
		expect(out.acknowledged).not.toBe(codes);
		codes.push('exceeds_headroom');
		expect(out.acknowledged).toEqual(['exceeds_headroom']);
		expect(m).not.toHaveProperty('acknowledged');
		expect(JSON.stringify(out)).toBe(JSON.stringify(MANIFEST).slice(0, -1) + ',"acknowledged":["exceeds_headroom"]}');
	});
});
