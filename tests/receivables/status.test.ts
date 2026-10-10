import { describe, it, expect } from 'vitest';
import { claimedOf, financingStatusOf, lifecycleOf, ragState } from '../../src/lib/receivables/status';

/**
 * src/lib/receivables/status.ts as pure functions. The registry-level characterization
 * (registryCharacterization.test.ts) pins the same derivations end to end through
 * getReceivableStatus; registryRag.test.ts pins ragState against the page's own rag().
 */

describe('claimedOf', () => {
	it('sums active claims only, in order', () => {
		expect(claimedOf([])).toBe(0);
		expect(claimedOf([{ status: 'active', amount: 400 }, { status: 'discharged', amount: 600 }, { status: 'active', amount: 100 }])).toBe(500);
		expect(claimedOf([{ status: 'active', amount: 0.1 }, { status: 'active', amount: 0.2 }])).toBe(0.1 + 0.2);
	});
});

describe('financingStatusOf', () => {
	it.each([
		[0, 1000, 'unfinanced'],
		[-5, 1000, 'unfinanced'],
		[1, 1000, 'partially_financed'],
		[999.99, 1000, 'partially_financed'],
		[1000, 1000, 'fully_financed'],
		[1000.01, 1000, 'over_financed'],
	] as const)('%s against %s is %s', (claimed, face, status) => {
		expect(financingStatusOf(claimed, face)).toBe(status);
	});
});

describe('lifecycleOf', () => {
	it.each([
		[{ settled: false, claimed: 0, hadClaims: false }, 'created'],
		[{ settled: false, claimed: 10, hadClaims: true }, 'financed'],
		[{ settled: false, claimed: 0, hadClaims: true }, 'released'],
		[{ settled: true, claimed: 10, hadClaims: true }, 'settled'],
		[{ settled: true, claimed: 0, hadClaims: false }, 'settled'],
	] as const)('%o is %s', (input, lifecycle) => {
		expect(lifecycleOf(input)).toBe(lifecycle);
	});
});

describe('ragState', () => {
	const dispute = { class: 'party_dispute' };
	const legacyDispute = { role: 'other', statement: 'DISPUTED — states the record is wrong.' };
	const forged = { class: 'party_statement', role: 'other', statement: 'DISPUTED — typed by hand.' };

	it.each([
		['open', {}, 'open'],
		['partial', { status: 'partially_financed' }, 'partial'],
		['full', { status: 'fully_financed' }, 'full'],
		['over reads full', { status: 'over_financed' }, 'full'],
		['settled', { settled: true, status: 'fully_financed' }, 'settled'],
		['disputed beats settled', { settled: true, attestations: [dispute] }, 'disputed'],
		['a legacy dispute counts', { status: 'partially_financed', attestations: [legacyDispute] }, 'disputed'],
		['a typed statement that only looks like a dispute does not', { attestations: [forged] }, 'open'],
		['test beats a dispute', { isTest: true, attestations: [dispute] }, 'test'],
		['missing attestations are fine', { attestations: null }, 'open'],
	] as const)('%s', (_name, input, state) => {
		expect(ragState(input as any)).toBe(state);
	});
});
