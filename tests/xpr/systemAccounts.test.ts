import { describe, expect, it } from 'vitest';
import { isXprReviewKind, xprCounterpartyLabel, xprRowKind, xprRowNotes } from '@/lib/xpr/systemAccounts';
import { DEFI_FUNDING_KEYWORDS, DEFI_LP_KEYWORDS, INCOME_KEYWORDS, LOAN_INTEREST_KEYWORDS } from '@/lib/yearEnd/constants';

/**
 * Staking, payout, lock and swap accounts are recorded as sent and received, stored for review with
 * a plain note. The tax passes read a row's kind and notes for keywords and give the row a treatment
 * from them, so nothing written here may contain one, and the memo (text a stranger wrote) is never
 * put where they read.
 */

const REVIEW_ACCOUNTS = ['stake.proton', 'eosio.vpay', 'eosio.bpay', 'eosio.saving', 'locked.token', 'lock.token', 'proton.swaps', 'swap.alcor', 'eosio.ram', 'eosio'];

describe('which accounts need a second look', () => {
	it('names the accounts seen doing it, and any eosio. system account', () => {
		for (const a of REVIEW_ACCOUNTS) expect(xprCounterpartyLabel(a), a).not.toBeNull();
		expect(xprCounterpartyLabel('STAKE.PROTON')).toBe('XPR Network stake contract');
		expect(xprCounterpartyLabel('eosio.anything')).toBe('XPR Network system account');
	});

	it('an ordinary account is not one, whatever it is called', () => {
		for (const a of ['testbob2', 'staking.fan', 'reward.me', 'airdrop1', 'loan.token']) expect(xprCounterpartyLabel(a), a).toBeNull();
	});
});

describe('the kind a row is stored with', () => {
	it('send / receive, or send_review / receive_review, and a review kind still reads as a send or a receive', () => {
		expect(xprRowKind('in', 'testbob2')).toBe('receive');
		expect(xprRowKind('out', 'testbob2')).toBe('send');
		expect(xprRowKind('out', 'stake.proton')).toBe('send_review');
		expect(xprRowKind('in', 'eosio.vpay')).toBe('receive_review');
		expect(xprRowKind('out', 'stake.proton')).toContain('send');
		expect(xprRowKind('in', 'eosio.vpay')).toContain('receive');
		expect(isXprReviewKind('send_review')).toBe(true);
		expect(isXprReviewKind(' RECEIVE_REVIEW ')).toBe(true);
		expect(isXprReviewKind('send')).toBe(false);
		expect(isXprReviewKind(null)).toBe(false);
	});
});

describe('no word the tax passes act on', () => {
	const keywords = [...INCOME_KEYWORDS, ...LOAN_INTEREST_KEYWORDS, ...DEFI_LP_KEYWORDS, ...DEFI_FUNDING_KEYWORDS, 'airdrop', 'rebase', 'borrow', 'loan', 'repay', 'liquidat', 'collateral'];

	it('the label, the note and the kind of every review account carry none', () => {
		for (const a of REVIEW_ACCOUNTS) {
			const text = `${xprRowNotes(a)} ${xprRowKind('in', a)} ${xprRowKind('out', a)} ${xprCounterpartyLabel(a)}`.toLowerCase();
			for (const kw of keywords) expect(text.includes(kw), `${a}: "${kw}"`).toBe(false);
		}
	});

	it('an ordinary account gets no note', () => {
		expect(xprRowNotes('testbob2')).toBe('');
	});

	it('a review note says what it is and leaves the decision with the owner', () => {
		expect(xprRowNotes('stake.proton')).toMatch(/^Needs review: this transfer was with stake\.proton, the XPR Network stake contract\./);
		expect(xprRowNotes('stake.proton')).toMatch(/for you and your tax professional to decide/);
	});
});
