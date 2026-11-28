/**
 * Where a standing approval is canceled. Almstins never asks for a signature: canceling happens in the
 * user's own wallet, through revoke.cash or the chain explorer's Token Approval Checker.
 *
 * revoke.cash: `https://revoke.cash/address/<wallet>?chainId=<id>` opens that wallet's approvals on that
 * network (checked Nov 28, 2026 for chain ids 1, 137, 43114 and 42161: each page names the network).
 * revoke.cash shows one network at a time, so each chain gets its own link.
 *
 * Token Approval Checker: Etherscan's page and its sister explorers' (Polygonscan, Arbiscan, and
 * Snowtrace for Avalanche). They take no address in the link; the user connects a wallet there.
 *
 * Pure, no imports with side effects: the React island uses it too.
 */

import { CHAINS, type ApprovalChain } from '@/lib/chains';

const CHECKER_HOST: Record<ApprovalChain, string> = {
	ethereum: 'https://etherscan.io',
	polygon: 'https://polygonscan.com',
	avalanche: 'https://snowtrace.io',
	arbitrum: 'https://arbiscan.io',
};

/** revoke.cash for this wallet on this chain. */
export function revokeCashUrl(chain: ApprovalChain, wallet: string): string {
	return `https://revoke.cash/address/${encodeURIComponent(wallet.toLowerCase())}?chainId=${CHAINS[chain].evmChainId}`;
}

/** The chain explorer's Token Approval Checker. */
export function approvalCheckerUrl(chain: ApprovalChain): string {
	return `${CHECKER_HOST[chain]}/tokenapprovalchecker`;
}

/** The checker's name as a link shows it. */
export function approvalCheckerName(chain: ApprovalChain): string {
	const names: Record<ApprovalChain, string> = { ethereum: 'Etherscan', polygon: 'Polygonscan', avalanche: 'Snowtrace', arbitrum: 'Arbiscan' };
	return names[chain];
}
