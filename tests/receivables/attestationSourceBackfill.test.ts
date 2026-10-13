import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module for a hand-run script
import { matchAttestationSources, utcMs } from '../../src/scripts/attestationSourceMatch.mjs';

/**
 * The hand-run backfill restores `source` on pre-S0a request-link answers so they count as
 * consent again. It may tag a row only when the database proves the row came through a
 * request link; anything less stays a party statement (fail closed).
 *
 * Rows here have the shape production writes: attested_at is the manifest's date only
 * (addAttestation never gets a time of day from a link answer), and created_at is the
 * database's insert stamp.
 */

const RCV = 'r'.repeat(64);
const att = (over: Record<string, unknown> = {}) => ({
	id: 'a1', receivable_id: RCV, tenant_id: 'fin-1', role: 'buyer', source: null,
	statement: 'Confirms invoice INV-1 for USD 1,000.00. Their reference: PO-9. Affirms: goods/services received. Answered by Ada Obi (AP lead) via a single-use link.',
	attested_at: '2026-09-05', created_at: '2026-09-05 14:03:12', ...over,
});
const inv = (over: Record<string, unknown> = {}) => ({
	token: 't1', receivable_id: RCV, from_tenant: 'fin-1', role: 'buyer',
	accepted_at: '2026-09-05 14:03:11', accepted_by: 'Ada Obi', claim_id: null, offer_id: null, ...over,
});

describe('matchAttestationSources', () => {
	it('tags a debtor confirmation proven by its answered link', () => {
		const r = matchAttestationSources([att()], [inv()]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
		expect(r.counts.debtor_confirmation).toMatchObject({ candidates: 1, provable: 1, ambiguous: 0, unmatched: 0 });
	});

	// The production dry run of 2026-10-10 matched 0 of 7 because the window ran on the
	// date-only attested_at, which reads as midnight. The answer below came mid-afternoon.
	it('times the answer by the insert stamp, not by the date-only attested_at', () => {
		const r = matchAttestationSources([att({ created_at: '2026-09-05 17:12:45' })], [inv({ accepted_at: '2026-09-05 17:12:44' })]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
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
		// A link must not be able to explain two link-worded rows, so three links answered by
		// "Bo" in the same minute would all be ambiguous. Space them out like real answers.
		links[0].accepted_at = '2026-09-05 10:00:00'; rows[0].created_at = '2026-09-05 10:00:01';
		links[1].accepted_at = '2026-09-05 11:00:00'; rows[1].created_at = '2026-09-05 11:00:01';
		links[2].accepted_at = '2026-09-05 12:00:00'; rows[2].created_at = '2026-09-05 12:00:01';
		const r = matchAttestationSources(rows, links);
		expect(r.tags).toEqual(expect.arrayContaining([
			{ id: 'rc', source: 'receipt_confirmation' },
			{ id: 'rec', source: 'record_confirmation' },
			{ id: 'off', source: 'offer_acceptance' },
		]));
		expect(r.tags).toHaveLength(3);
	});

	it('accepts an answer that crosses midnight UTC', () => {
		const r = matchAttestationSources(
			[att({ attested_at: '2026-09-05', created_at: '2026-09-06 00:00:01' })],
			[inv({ accepted_at: '2026-09-05 23:59:59' })]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
	});

	it.each([
		['a different tenant sent the link', {}, { from_tenant: 'fin-2' }, 'tenant'],
		['a different receivable', {}, { receivable_id: 'x'.repeat(64) }, 'receivable'],
		['the link was never answered', {}, { accepted_at: null }, 'receivable'],
		['someone else answered the link', {}, { accepted_by: 'Mallory' }, 'answerer'],
		['a supplier link for a debtor statement', {}, { role: 'supplier' }, 'kind'],
		['the row was written 3 minutes after the link was claimed', { created_at: '2026-09-05 14:06:12' }, {}, 'window'],
		['the row was stamped 121s after the link was claimed', { created_at: '2026-09-05 14:05:12' }, {}, 'window'],
		['the row was stamped 61s before the link was claimed', { created_at: '2026-09-05 14:02:10' }, {}, 'window'],
		['the row was written before the link was claimed', { created_at: '2026-09-05 13:50:00' }, {}, 'window'],
		['the answerer is a longer name that starts the same', {}, { accepted_by: 'Ada' }, 'answerer'],
		['the row has no insert stamp', { created_at: null }, {}, 'window'],
		['the insert stamp is unreadable', { created_at: 'yesterday' }, {}, 'window'],
		['the signed date is another day', { attested_at: '2026-09-04' }, {}, 'day'],
	])('leaves the row alone when %s', (_why, a, i, rule) => {
		const r = matchAttestationSources([att(a)], [inv(i)]);
		expect(r.tags).toEqual([]);
		expect(r.counts.debtor_confirmation.unmatched).toBe(1);
		expect(r.counts.debtor_confirmation.why[rule as string]).toBe(1);
	});

	it.each([
		['120s after', '2026-09-05 14:05:11'],
		['60s before', '2026-09-05 14:02:11'],
	])('still tags a row stamped exactly %s the link was claimed', (_when, createdAt) => {
		const r = matchAttestationSources([att({ created_at: createdAt })], [inv()]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
	});

	// A link is answered once and writes one row. If its real answer was a dispute, a copy of
	// the confirmation wording typed by the sender in the same minute must not borrow it.
	it('tags nothing when the link could also have written a dispute or a row that has a source', () => {
		const dispute = att({ id: 'disp', role: 'other', created_at: '2026-09-05 14:03:11',
			statement: 'DISPUTED — states this invoice is not theirs. Invoice INV-1. Answered by Ada Obi (AP lead) via a single-use link.' });
		const copied = att({ id: 'typed', created_at: '2026-09-05 14:04:31' });
		const r = matchAttestationSources([dispute, copied], [inv()]);
		expect(r.tags).toEqual([]);
		expect(r.counts.debtor_confirmation).toMatchObject({ candidates: 1, provable: 0, ambiguous: 1 });

		const sourced = att({ id: 'post-s0a', source: 'debtor_dispute', created_at: '2026-09-05 14:03:11',
			statement: 'DISPUTED — states the amount is wrong. Invoice INV-1. Answered by Ada Obi via a single-use link.' });
		expect(matchAttestationSources([sourced, copied], [inv()]).tags).toEqual([]);
	});

	it('still tags when the other link-worded rows on the receivable belong to other answers', () => {
		const elsewhere = att({ id: 'other', role: 'other', created_at: '2026-09-05 16:00:00',
			statement: 'DISPUTED — states the amount is wrong. Invoice INV-1. Answered by Ada Obi via a single-use link.' });
		const r = matchAttestationSources([att(), elsewhere], [inv()]);
		expect(r.tags).toEqual([{ id: 'a1', source: 'debtor_confirmation' }]);
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
		const twoLinks = matchAttestationSources([att()], [inv(), inv({ token: 't2', accepted_at: '2026-09-05 14:03:05' })]);
		expect(twoLinks.tags).toEqual([]);
		expect(twoLinks.counts.debtor_confirmation.ambiguous).toBe(1);
		const twoRows = matchAttestationSources([att(), att({ id: 'a2', created_at: '2026-09-05 14:03:14' })], [inv()]);
		expect(twoRows.tags).toEqual([]);
	});

	it('reads both timestamp formats as UTC', () => {
		expect(utcMs('2026-09-05 14:03:11')).toBe(utcMs('2026-09-05T14:03:11Z'));
		expect(Number.isNaN(utcMs(null))).toBe(true);
	});
});
