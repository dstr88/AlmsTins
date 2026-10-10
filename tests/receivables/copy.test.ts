import { describe, it, expect } from 'vitest';
import { RESERVED_STATEMENT_PREFIXES, hasReservedPrefix } from '../../src/lib/receivables/attestationClass';
import * as attestCopy from '../../src/lib/receivables/copy/attest';
import { BRIGHT_LINE_RULES, brightLineViolations } from '../helpers/brightLineWording';

/**
 * Receivables copy (src/lib/receivables/copy/*) against the shared bright-line helper, plus a
 * canary per rule so a broken pattern cannot pass everything silently.
 */

const COPY_MODULES: Record<string, Record<string, unknown>> = { attest: attestCopy };

describe('receivables copy keeps to the bright lines', () => {
	for (const [mod, exports] of Object.entries(COPY_MODULES)) {
		for (const [name, value] of Object.entries(exports)) {
			if (typeof value !== 'string') continue;
			it(`copy/${mod}.${name}`, () => {
				expect(brightLineViolations(value)).toEqual([]);
			});
		}
	}

	it('the reserved_prefix message names every reserved word and passes its own check', () => {
		const msg = attestCopy.RESERVED_PREFIX_MESSAGE;
		for (const p of RESERVED_STATEMENT_PREFIXES) expect(msg).toContain(p.split(' ')[0]);
		// The message quotes the words in capitals mid-sentence; it never opens with one.
		expect(hasReservedPrefix(msg)).toBe(false);
	});
});

describe('brightLineWording canaries', () => {
	const canaries: Array<[string, string]> = [
		['never stops a payment', 'Do not pay this invoice.'],
		['never stops a payment', 'This blocks the payment.'],
		['active voice', 'Almstins blocks duplicate claims.'],
		['lending', 'The registry rejects the claim.'],
		['collateral', 'Recording it gives you a lien on the invoice.'],
		['collateral', 'Your interest is perfected once recorded.'],
		['collateral', 'The first claim takes priority.'],
		['collateral', 'You are first in line.'],
		['collateral', 'This is a registered security interest.'],
		['American English', 'We recognise the record.'],
		['American English', 'Receivables tokenisation.'],
		['American English', 'Paid by cheque in two instalments.'],
		['American English', 'The colour of the pill.'],
	];
	for (const [rule, text] of canaries) {
		it(`${rule}: ${text}`, () => {
			expect(brightLineViolations(text).some((v) => v.startsWith(`${rule}:`))).toBe(true);
		});
	}

	it('every rule has a canary', () => {
		const ruled = new Set(BRIGHT_LINE_RULES.map((r) => r.rule));
		for (const rule of ruled) expect(canaries.some(([r]) => r === rule), rule).toBe(true);
		// And every pattern catches at least one canary.
		for (const { rule, pattern } of BRIGHT_LINE_RULES) {
			expect(canaries.some(([, t]) => pattern.test(t)), `${rule} ${pattern}`).toBe(true);
		}
	});

	it('leaves the approved phrasing alone', () => {
		for (const t of [
			'On record at Almstins.',
			'Recorded as financed.',
			'It creates no security interest and has no legal effect.',
			'The color of the pill. Your record. Four claims in an hour.',
		]) expect(brightLineViolations(t), t).toEqual([]);
	});
});
