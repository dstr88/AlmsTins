/**
 * The words for one standing approval, from a locale (src/i18n/dashboard/walletApprovals.ts): what it
 * covers, how much, and why it is flagged. Pure: the Wallets page list and the monthly check-up's
 * digest line both use it, so they say the same thing.
 */

import { shortenAddress } from '@/lib/addressDisplay';
import { formatQty } from '@/lib/format';
import type { WalletApprovalsLocale } from '@/i18n/dashboard/walletApprovals';
import type { ApprovalReason, StandingApproval } from './types';

function collectionName(a: StandingApproval): string {
	return a.token.name || a.token.symbol || shortenAddress(a.token.address);
}

function tokenLabel(a: StandingApproval, t: WalletApprovalsLocale): string {
	return a.token.symbol || a.token.name || `${t.unknownToken} (${shortenAddress(a.token.address)})`;
}

/** The contract that can spend: its public name, or its short address. */
export function spenderText(a: StandingApproval): string {
	return a.spender.name || shortenAddress(a.spender.address);
}

export function whatText(a: StandingApproval, t: WalletApprovalsLocale): string {
	switch (a.kind) {
		case 'nft_all':
			return t.whatNftAll(collectionName(a));
		case 'nft_one':
			return t.whatNftOne(a.tokenId ?? '?', collectionName(a));
		case 'permit2':
			return t.whatPermit2(tokenLabel(a, t));
		default:
			return t.whatToken(tokenLabel(a, t));
	}
}

export function amountText(a: StandingApproval, t: WalletApprovalsLocale): string {
	if (a.group === 'unknown') return t.amountUnknown;
	if (a.kind === 'nft_all') return t.amountAllNfts;
	if (a.kind === 'nft_one') return t.amountOneNft;
	if (a.unlimited) return t.amountUnlimited;
	if (a.amountText) return `${formatQty(a.amountText, { maxDecimals: 6 })} ${a.token.symbol ?? ''}`.trim();
	return a.amountRaw ?? t.amountUnknown;
}

export function reasonText(r: ApprovalReason, a: StandingApproval, t: WalletApprovalsLocale): string {
	switch (r.code) {
		case 'unlimited':
			return a.kind === 'nft_all' ? t.reasonWholeCollection : t.reasonUnlimited;
		case 'inactive':
			return t.reasonInactive(r.months);
		case 'checker':
			return t.reasonChecker(r.hits.map((h) => t.checkerHit[h] ?? h).join(', '));
	}
}
