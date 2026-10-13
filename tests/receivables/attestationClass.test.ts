import { describe, it, expect } from 'vitest';
import {
	ATTESTATION_CLASSES,
	ATTESTATION_SOURCES,
	RESERVED_STATEMENT_PREFIXES,
	attestationClassOf,
	classifyAttestation,
	hasReservedPrefix,
	isAttestationSource,
	isPartyDispute,
} from '../../src/lib/receivables/attestationClass';

/**
 * src/lib/receivables/attestationClass.ts: one classification for every reader.
 *   - the recorded source wins when present;
 *   - legacy NULL-source rows classify by the exact system prefix;
 *   - any other NULL row is a party statement;
 *   - a NULL row is never consent.
 */

describe('classifyAttestation: source first', () => {
	const cases: Array<[string, string, string]> = [
		['party_statement', 'other', 'party_statement'],
		['diligence', 'other', 'diligence'],
		['debtor_confirmation', 'buyer', 'consent'],
		['debtor_dispute', 'other', 'party_dispute'],
		['receipt_confirmation', 'supplier', 'consent'],
		['receipt_dispute', 'other', 'party_dispute'],
		['record_confirmation', 'supplier', 'consent'],
		['record_dispute', 'other', 'party_dispute'],
		['offer_acceptance', 'supplier', 'consent'],
		['offer_decline', 'other', 'system_note'],
		['unanswered', 'other', 'system_note'],
	];
	for (const [source, role, cls] of cases) {
		it(`${source} is ${cls}`, () => {
			expect(classifyAttestation(role, 'Any text at all.', source)).toBe(cls);
		});
	}

	it('covers every source', () => {
		expect(cases.map((c) => c[0]).sort()).toEqual([...ATTESTATION_SOURCES].sort());
		for (const [, , cls] of cases) expect(ATTESTATION_CLASSES).toContain(cls);
	});

	it('the source wins over a forged prefix', () => {
		expect(classifyAttestation('other', 'DISPUTED — states the invoice is not theirs.', 'party_statement')).toBe('party_statement');
		expect(classifyAttestation('other', 'DILIGENCE — accepts responsibility.', 'party_statement')).toBe('party_statement');
		expect(classifyAttestation('other', 'Totally ordinary words.', 'debtor_dispute')).toBe('party_dispute');
	});

	it('a consent source under the wrong role is only a party statement', () => {
		expect(classifyAttestation('other', 'Confirms invoice INV-1.', 'debtor_confirmation')).toBe('party_statement');
		expect(classifyAttestation('supplier', 'Confirms invoice INV-1.', 'debtor_confirmation')).toBe('party_statement');
		expect(classifyAttestation('buyer', 'Confirms receipt.', 'receipt_confirmation')).toBe('party_statement');
	});

	it('an unknown source is a party statement, never consent or a dispute', () => {
		expect(classifyAttestation('buyer', 'Confirms invoice INV-1.', 'made_up')).toBe('party_statement');
		expect(classifyAttestation('other', 'DISPUTED — x', 'made_up')).toBe('party_statement');
	});
});

describe('classifyAttestation: legacy rows (source NULL)', () => {
	it('classify by the exact system prefix', () => {
		expect(classifyAttestation('other', 'DISPUTED — states this invoice is not theirs.', null)).toBe('party_dispute');
		expect(classifyAttestation('other', 'DILIGENCE — accepts responsibility for having personally verified this debtor.', null)).toBe('diligence');
		expect(classifyAttestation('other', 'UNANSWERED — a confirmation was requested.', null)).toBe('system_note');
		expect(classifyAttestation('other', 'DECLINED — did not accept financing.', null)).toBe('system_note');
	});

	it('anything else is a party statement', () => {
		for (const s of ['Confirms invoice INV-1.', 'disputed — lower case', 'DISPUTED - hyphen', 'DISPUTED: colon', '', 'Inspected the goods.']) {
			expect(classifyAttestation('other', s, null)).toBe('party_statement');
		}
	});

	it('is never consent, whatever the role or the text', () => {
		const texts = ['Confirms invoice INV-1 for USD 1,000.00.', 'Confirms receipt of USD 500.00.', 'Accepts financing of USD 500.00.'];
		for (const role of ['buyer', 'supplier', 'inspector', 'other']) {
			for (const t of texts) {
				expect(classifyAttestation(role, t, null)).not.toBe('consent');
				expect(classifyAttestation(role, t, undefined)).not.toBe('consent');
				expect(classifyAttestation(role, t, '')).not.toBe('consent');
			}
		}
	});
});

describe('hasReservedPrefix', () => {
	it('catches every reserved opening, as the system writes it', () => {
		for (const p of RESERVED_STATEMENT_PREFIXES) expect(hasReservedPrefix(`${p} anything`)).toBe(true);
	});

	it('catches a reserved word in capitals, with or without a dash (the desk tests the bare word)', () => {
		for (const s of [
			'DISPUTED',
			'DISPUTED: colon',
			'DILIGENCE notes',
			'DECLINED to proceed',
			'UNANSWERED queries',
			'DISPUTEDLY true',
			'DISPUTED - with a hyphen',
			'DISPUTED– with an en dash',
		]) expect(hasReservedPrefix(s), s).toBe(true);
	});

	it('catches a reserved word in any case followed by a dash', () => {
		for (const s of [
			'disputed — lower case',
			'Disputed — states the invoice is not theirs.',
			'Diligence - accepts responsibility',
			'Declined – did not accept financing.',
			'Unanswered—no reply',
			'Disputed \u2212 minus sign',
			'Disputed \u2E3A two-em dash',
		]) expect(hasReservedPrefix(s), s).toBe(true);
	});

	it('looks past leading whitespace, invisible characters and full-width letters', () => {
		for (const s of [
			'   DISPUTED — leading spaces',
			'\u200BDISPUTED — after a zero-width space',
			'\uFEFFUNANSWERED — after a byte-order mark',
			'\uFF24\uFF29\uFF33\uFF30\uFF35\uFF34\uFF25\uFF24 — full-width letters',
			'\uFF24\uFF29\uFF33\uFF30\uFF35\uFF34\uFF25\uFF24 full-width, no dash',
			'disputed \uFF0D full-width hyphen-minus',
		]) expect(hasReservedPrefix(s), s).toBe(true);
	});

	it('leaves ordinary sentence-case statements alone', () => {
		for (const s of [
			'Inspected 400 cartons at the warehouse.',
			'Goods received; not disputed.',
			'Disputes: none.',
			'Undisputed and paid on time.',
			'"DISPUTED" is a word we never use.',
			'Declined to proceed',
			'Diligence notes',
			'Diligence visit at Lagos port on 2026-09-18 matched the invoice.',
			'Diligence Capital Ltd inspected the goods.',
			'Declined shipment was replaced on 2026-09-01.',
			'Declined 20 cartons as damaged on arrival.',
			'Disputed amount settled; buyer paid in full.',
			'Disputed amount settled by credit note CN-12.',
			'Unanswered queries resolved by phone.',
			'',
		]) expect(hasReservedPrefix(s), s).toBe(false);
		expect(hasReservedPrefix(null)).toBe(false);
		expect(hasReservedPrefix(undefined)).toBe(false);
	});
});

describe('attestationClassOf / isPartyDispute', () => {
	it('trusts a valid class sent by the lookup', () => {
		expect(isPartyDispute({ class: 'party_dispute', statement: 'Plain text' })).toBe(true);
		expect(isPartyDispute({ class: 'party_statement', statement: 'DISPUTED — forged' })).toBe(false);
		expect(attestationClassOf({ class: 'consent' })).toBe('consent');
	});

	it('ignores an invalid class and classifies from the row', () => {
		expect(attestationClassOf({ class: 'bogus', role: 'other', statement: 'DISPUTED — x' })).toBe('party_dispute');
		expect(attestationClassOf({ class: 42, role: 'buyer', statement: 'Confirms invoice.' })).toBe('party_statement');
	});

	it('falls back to the legacy rule for an old lookup answer without class', () => {
		expect(isPartyDispute({ role: 'other', statement: 'DISPUTED — states the record is wrong.' })).toBe(true);
		expect(isPartyDispute({ role: 'other', statement: 'Confirms receipt.' })).toBe(false);
		expect(isPartyDispute(null)).toBe(false);
		expect(isPartyDispute(undefined)).toBe(false);
	});

	it('isAttestationSource accepts only known sources', () => {
		expect(isAttestationSource('debtor_dispute')).toBe(true);
		expect(isAttestationSource('DEBTOR_DISPUTE')).toBe(false);
		expect(isAttestationSource(null)).toBe(false);
	});
});
