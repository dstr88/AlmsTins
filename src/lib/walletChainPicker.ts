/**
 * The chain boxes on a wallet card (WalletChainPicker): which wallets get them, which boxes are
 * ticked, and the chain list a tick leaves behind. Pure, so the card and its tests share one rule.
 */
import { CHAINS, WALLET_CARD_EVM_CHAINS, normalizeChain } from '@/lib/chains';
import { EVM_ADDRESS } from '@/lib/addressFormats';

export interface ChainChoice {
	chain: string;
	name: string;
	checked: boolean;
}

/** Only an EVM address gets the boxes: the other wallet kinds have their own chains. */
export function hasChainPicker(address: string | null | undefined): boolean {
	return Boolean(address && EVM_ADDRESS.test(address.trim()));
}

/** One box per chain in WALLET_CARD_EVM_CHAINS, ticked when the wallet's list has that chain. */
export function chainChoices(chains: readonly string[]): ChainChoice[] {
	const listed = new Set(chains.map(normalizeChain));
	return WALLET_CARD_EVM_CHAINS.map((chain) => ({
		chain,
		name: CHAINS[chain].name,
		checked: listed.has(chain),
	}));
}

/**
 * The chain list after one box is ticked or unticked. Chains on the list that the boxes do not
 * show stay as they are. Null when an untick would leave no chain at all: the server reads an
 * empty list as the default chains, so the card refuses that change instead.
 */
export function chainsAfterToggle(chains: readonly string[], chain: string): string[] | null {
	const target = normalizeChain(chain);
	if (!chains.some((c) => normalizeChain(c) === target)) return [...chains, target];
	const next = chains.filter((c) => normalizeChain(c) !== target);
	return next.length ? next : null;
}
