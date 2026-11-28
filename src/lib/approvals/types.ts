/**
 * The standing approvals report: what GET /api/wallets/[id]/approvals returns and the Wallets page
 * shows (src/components/dashboard/WalletApprovals.tsx). Types only, no imports with side effects, so
 * the React island can import it.
 *
 * Donnie's rule (Nov 28, 2026): no approval is ever shown as safe. Every approval in force is a risk;
 * the groups only set the order to look at them. There is no "ok" or "safe" value anywhere here.
 */

import type { ApprovalChain } from '@/lib/chains';

/**
 * What kind of approval it is:
 * - `token`: an ERC-20 allowance (the Approval event, approve() or a signed permit someone used)
 * - `nft_all`: a whole NFT collection (ApprovalForAll), ERC-721 or ERC-1155
 * - `nft_one`: one NFT (the ERC-721 Approval event with a token id)
 * - `permit2`: an allowance inside Uniswap's Permit2 contract, which has its own expiry
 */
export type ApprovalKind = 'token' | 'nft_all' | 'nft_one' | 'permit2';

/** The order to look at them: `revoke_first` (a flag below applies), `still_a_risk` (none does), `unknown` (couldn't check). */
export type ApprovalGroup = 'revoke_first' | 'still_a_risk' | 'unknown';

/** Why an approval is in `revoke_first`, each said in words by the page. */
export type ApprovalReason =
	| { code: 'unlimited' }
	| { code: 'inactive'; months: number }
	| { code: 'checker'; hits: string[] };

export interface ApprovalSpender {
	address: string;
	/** A public contract name: the known-contracts list first, then the explorer's verified name. Null shows the short address. */
	name: string | null;
	nameSource: 'known' | 'verified' | null;
	/** The newest transaction the explorer lists for the contract (ISO), or null when it lists none or couldn't be read. */
	lastActiveAt: string | null;
	/** False when the explorer couldn't be asked, so `lastActiveAt` null means "unknown", not "never". */
	lastActiveRead: boolean;
	/** What the wallet checker's sources say; null when they weren't asked. `goplus`: GoPlus answered (credited on the page). */
	checker: { hits: string[]; complete: boolean; goplus: boolean } | null;
}

export interface ApprovalToken {
	address: string;
	symbol: string | null;
	name: string | null;
	decimals: number | null;
}

export interface StandingApproval {
	/** Stable within one report: chain, kind, token, spender and token id. */
	id: string;
	chain: ApprovalChain;
	chainId: number;
	kind: ApprovalKind;
	token: ApprovalToken;
	/** For `nft_one`: the NFT's id (decimal). */
	tokenId: string | null;
	spender: ApprovalSpender;
	/** The amount as the contract holds it now, in base units (decimal string). Null for NFT approvals. */
	amountRaw: string | null;
	/** The amount in whole tokens (decimal string), when the token's decimals are known. */
	amountText: string | null;
	unlimited: boolean;
	/** Permit2 only: when the allowance stops (ISO). Ordinary approvals never expire. */
	expiresAt: string | null;
	/** When the approval was given: the newest event for it on the chain (ISO). */
	givenAt: string | null;
	givenTx: string | null;
	group: ApprovalGroup;
	reasons: ApprovalReason[];
	/** For `unknown`: which part couldn't be read. */
	unknownWhy?: 'state' | 'chain';
	links: { revoke: string; checker: string | null };
}

/** `pending`: still being read (the list fills in as each chain finishes). */
export type ChainReadStatus = 'read' | 'partial' | 'unavailable' | 'pending';

export interface ApprovalsReport {
	ok: true;
	walletId: string;
	/** When the check ran (ISO): approvals can change a minute later. */
	checkedAt: string;
	/** False while some chain is still being read: the list so far, never presented as the whole list. */
	complete: boolean;
	chains: Array<{ chain: ApprovalChain; status: ChainReadStatus; revoke: string; checker: string | null }>;
	approvals: StandingApproval[];
	counts: { total: number; revokeFirst: number; stillARisk: number; unknown: number };
}
