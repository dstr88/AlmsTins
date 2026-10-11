import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module for a hand-run script
import { matchAttestationSources, utcMs } from '../../src/scripts/attestationSourceMatch.mjs';

/**
 * The hand-run backfill restores `source` on pre-S0a request-link answers so they count as
 * consent again. It may tag a row only when the database proves the row came through a
 * request link; anything less stays a party statement (fail closed).
 */

const RCV = 'r'.repeat(64);
const att = (over: Record<string, unknown> = {}) => ({
	id: 'a1', receivable_id: RCV, tenant_id: 'fin-1', role: 'buyer', source: null,
	statement: 'Confirms invoice INV-1 for USD 1,000.00. Their reference: PO-9. Affirms: goods/services received. Answered by Ada Obi (AP lead) via a single-use link.',
	attested_at: '2026-09-05 14:03:12', ...over,
});
const inv = (over: Record<string, unknown> = {}) => ({
	token: 't1', receivable_id: RCV, from_tenant: 'fin-1', role: 'buyer',
	accepted_at: '2026-09-05 14:03:11', accepted_by: 'Ada Obi', claim_id: null, offer_id: null, ...over,
});

describe('matchAttestationSources', () => {
	it('tags a debtor confirmation proven by its answered link', () => {
		const r = matchAttestationSources([att()], [inv()]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
		expect(r.counts.debtor_confirmation).toEqual({ candidates: 1, provable: 1, ambiguous: 0, unmatched: 0 });
	});

	it('tags each supplier flow by its link kind', () => {
		const rows = [
			att({ id: 'rc', role: 'supplier', statement: 'Confirms receipt of USD 900.00 advanced by Fin A against invoice INV-1, registered 2026-09-01. Answered by Bo via a single-use link.' }),
			att({ id: 'rec', role: 'supplier', statement: 'Confirms this is their receivable: invoice INV-1 to Buyer for USD 1,000.00, and that the attached paperwork is what they provided. Answered by Bo via a single-use link.' }),
			att({ id: 'off', role: 'supplier', statement: 'Accepts financing of USD 900.00 from Fin A against invoice INV-1. Terms: recourse, initialled "BO". Accepted by Bo via a single-use link, before funds were advanced.' }),
		];
		const links = [
			inv({ token: 'k-rc', role: 'supplier', accepted_by: 'Bo', claim_id: 'c1' }),
			inv({ token: 'k-rec', role: 'supplier', accepted_by: 'Bo' }),
			inv({ token: 'k-off', role: 'supplier', accepted_by: 'Bo', offer_id: 'o1' }),
		];
		// Three supplier links answered by "Bo" at the same moment would make each row match
		// several links, so space them out like real answers.
		links[0].accepted_at = '2026-09-05 10:00:00'; rows[0].attested_at = '2026-09-05 10:00:01';
		links[1].accepted_at = '2026-09-05 11:00:00'; rows[1].attested_at = '2026-09-05 11:00:01';
		links[2].accepted_at = '2026-09-05 12:00:00'; rows[2].attested_at = '2026-09-05 12:00:01';
		const r = matchAttestationSources(rows, links);
		expect(r.tags).toEqual(expect.arrayContaining([
			{ id: 'rc', source: 'receipt_confirmation' },
			{ id: 'rec', source: 'record_confirmation' },
			{ id: 'off', source: 'offer_acceptance' },
		]));
		expect(r.tags).toHaveLength(3);
	});

	it.each([
		['a different tenant sent the link', {}, { from_tenant: 'fin-2' }],
		['a different receivable', {}, { receivable_id: 'x'.repeat(64) }],
		['the link was never answered', {}, { accepted_at: null }],
		['someone else answered the link', {}, { accepted_by: 'Mallory' }],
		['the answer came long after the link was claimed', { attested_at: '2026-09-05 15:00:00' }, {}],
		['the row was written before the link was claimed', { attested_at: '2026-09-05 13:50:00' }, {}],
		['a supplier link for a debtor statement', {}, { role: 'supplier' }],
	])('leaves the row alone when %s', (_why, a, i) => {
		const r = matchAttestationSources([att(a)], [inv(i)]);
		expect(r.tags).toEqual([]);
	});

	it('never touches a row that already has a source, a typed statement or a dispute', () => {
		const rows = [
			att({ id: 'has', source: 'party_statement' }),
			att({ id: 'typed', statement: 'Confirms invoice INV-1, I spoke to them by phone. Answered by Ada Obi.' }),
			att({ id: 'disp', role: 'other', statement: 'DISPUTED — states this invoice is not theirs. Invoice INV-1. Answered by Ada Obi via a single-use link.' }),
		];
		expect(matchAttestationSources(rows, [inv()]).tags).toEqual([]);
	});

	it('is ambiguous, and tags nothing, when two links could explain one row or one link two rows', () => {
		const twoLinks = matchAttestationSources([att()], [inv(), inv({ token: 't2' })]);
		expect(twoLinks.tags).toEqual([]);
		expect(twoLinks.counts.debtor_confirmation.ambiguous).toBe(1);
		const twoRows = matchAttestationSources([att(), att({ id: 'a2' })], [inv()]);
		expect(twoRows.tags).toEqual([]);
	});

	it('reads both timestamp formats as UTC', () => {
		expect(utcMs('2026-09-05 14:03:11')).toBe(utcMs('2026-09-05T14:03:11Z'));
		expect(Number.isNaN(utcMs(null))).toBe(true);
	});
});
