/**
 * Default EVM chains we want to sync for a “normal” ERC-20 wallet.
 *
 * This is used when a wallet is created without an explicit `chains` list.
 * You can safely extend this later as you add support for more networks.
 */
export const DEFAULT_ERC20_CHAINS = ['ethereum', 'polygon', 'avalanche'] as const;
export type SupportedChain = (typeof DEFAULT_ERC20_CHAINS)[number] | 'solana' | 'sui' | 'rootstock';

/** Broader set of chains that wallets can be tagged with (includes non-EVM). */
export type WalletChain = SupportedChain | 'bitcoin' | string;
