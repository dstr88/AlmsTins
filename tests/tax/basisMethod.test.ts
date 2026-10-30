import { describe, it, expect } from 'vitest';
import {
	basisRuleStatement,
	inPerWalletRollout,
	PER_WALLET_FROM,
	PER_WALLET_METHOD,
	PER_WALLET_ROLLOUT,
	ruleForYear,
	UNIVERSAL_METHOD,
} from '../../src/lib/tax/basisMethod';

describe('who gets the per-wallet rule', () => {
	it('starts on the date the regulation does', () => {
		expect(PER_WALLET_FROM).toBe('2025-01-01');
	});

	it('is the owner first, and only a US tenant', () => {
		expect(PER_WALLET_ROLLOUT).toBe('owner');
		expect(inPerWalletRollout(true, 'us')).toBe(true);
		expect(inPerWalletRollout(false, 'us')).toBe(false);
		expect(inPerWalletRollout(true, 'intl')).toBe(false);
		expect(inPerWalletRollout(false, 'intl')).toBe(false);
	});
});

describe('which rule a year used', () => {
	it('years before 2025 are one pool under either method', () => {
		expect(ruleForYear(PER_WALLET_METHOD, 2024)).toBe('universal');
		expect(ruleForYear(PER_WALLET_METHOD, 2009)).toBe('universal');
		expect(ruleForYear(UNIVERSAL_METHOD, 2024)).toBe('universal');
	});

	it('2025 and later follow the tenant method', () => {
		expect(ruleForYear(PER_WALLET_METHOD, 2025)).toBe('per_wallet');
		expect(ruleForYear(PER_WALLET_METHOD, 2027)).toBe('per_wallet');
		expect(ruleForYear(UNIVERSAL_METHOD, 2025)).toBe('universal');
		expect(ruleForYear(undefined, 2025)).toBe('universal');
	});
});

describe('the one-line statement of the rule', () => {
	it('says what was done in records wording, with no em dash and no claim of compliance or filing', () => {
		const lines = [
			basisRuleStatement('per_wallet', 2025),
			basisRuleStatement('universal', 2025),
			basisRuleStatement('universal', 2024),
		];
		for (const line of lines) {
			expect(line).not.toMatch(/—/);
			expect(line).not.toMatch(/compliant|safe harbor|file your|ready to attach|tax-ready/i);
		}
		expect(lines[0]).toMatch(/only the coins held in the wallet or account it was made from/);
		expect(lines[0]).toMatch(/1\.1012-1\(j\)/);
		expect(lines[1]).toMatch(/not applied/);
		expect(lines[2]).toMatch(/one pool per coin/);
	});
});
