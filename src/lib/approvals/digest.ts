/**
 * The monthly check-up's line for each standing approval in "Revoke first" (src/pages/api/cron/monthly-digest.ts),
 * in the existing digest item shape. The description is written in English, like the digest's other items,
 * with the same words the Wallets page uses (describe.ts). Pure.
 */

import { en } from '@/i18n/dashboard/walletApprovals';
import { reasonText, spenderText, whatText } from './describe';
import type { ApprovalsReport } from './types';

export const APPROVAL_DIGEST_REASON = 'standing_approval_flagged';

export interface ApprovalDigestItem {
	sourceType: 'approval';
	/** Wallet id and approval id: stable from one month to the next, so an approval is listed once. */
	sourceId: string;
	reason: typeof APPROVAL_DIGEST_REASON;
	description: string;
	asset: string | null;
	amountUsd: null;
	date: string;
	counterparty: string | null;
}

export function flaggedApprovalItems(report: ApprovalsReport, walletId: string): ApprovalDigestItem[] {
	const today = report.checkedAt.slice(0, 10);
	return report.approvals
		.filter((a) => a.group === 'revoke_first')
		.map((a) => ({
			sourceType: 'approval' as const,
			sourceId: `${walletId}:${a.id}`,
			reason: APPROVAL_DIGEST_REASON,
			description: `Standing approval on ${en.chainName(a.chain)}: ${spenderText(a)} can spend ${whatText(a, en)} (${a.reasons
				.map((r) => reasonText(r, a, en))
				.join('; ')}). Cancel it on revoke.cash.`,
			asset: a.token.symbol ?? null,
			amountUsd: null,
			date: (a.givenAt ?? report.checkedAt).slice(0, 10) || today,
			counterparty: a.spender.address,
		}));
}
