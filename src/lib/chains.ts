/**
 * The facts about each blockchain Almstins reads, written once: its name, family, native coin,
 * EVM chain id, the other spellings stored rows use for it, and its block explorer. Below the
 * records are the named lists each feature uses. The lists differ on purpose (the Agent Vault
 * watches three chains, net worth reads eight); they live here, each with its name, so adding a
 * chain is one record plus a deliberate choice per feature, never a hunt for copies.
 * tests/ci/chainFactsGuard.test.ts fails on a chain list or native coin map written anywhere else.
 *
 * Polygon's native coin is POL (renamed from MATIC in 2024; owner decision D3, Oct 25 2026).
 * Snapshots stored before the change say MATIC. The price lookups already priced MATIC as POL,
 * and the snapshot readers read it as POL (currentCoinSymbol), so both spellings price and
 * match the same.
 *
 * Pure data and pure functions: React islands and bundled page scripts use this too.
 */

export type ChainFamily = 'evm' | 'utxo' | 'solana' | 'sui';

export interface ChainExplorer {
	/** The explorer's name, as a link's text shows it. */
	readonly name: string;
	/** Page of an address: this prefix, then the address. */
	readonly address: string;
	/** Page of a transaction: this prefix, then the hash or signature. */
	readonly tx: string;
}

export interface ChainInfo {
	readonly name: string;
	readonly family: ChainFamily;
	readonly native: { readonly symbol: string; readonly decimals: number };
	/** The EIP-155 chain id; null off EVM. */
	readonly evmChainId: number | null;
	/** Other spellings stored rows and imports use for this chain (lowercase). */
	readonly aliases: readonly string[];
	/** The explorer links go to; null where Almstins links none. */
	readonly explorer: ChainExplorer | null;
}

const evmExplorer = (name: string, host: string): ChainExplorer => ({
	name,
	address: `https://${host}/address/`,
	tx: `https://${host}/tx/`,
});

export const CHAINS = {
	ethereum: {
		name: 'Ethereum',
		family: 'evm',
		native: { symbol: 'ETH', decimals: 18 },
		evmChainId: 1,
		aliases: ['eth', 'mainnet', 'ethereum-mainnet', 'ethereum_mainnet'],
		explorer: evmExplorer('Etherscan', 'etherscan.io'),
	},
	polygon: {
		name: 'Polygon',
		family: 'evm',
		native: { symbol: 'POL', decimals: 18 },
		evmChainId: 137,
		aliases: ['matic', 'polygon-pos', 'polygon_pos'],
		explorer: evmExplorer('Polygonscan', 'polygonscan.com'),
	},
	avalanche: {
		name: 'Avalanche',
		family: 'evm',
		native: { symbol: 'AVAX', decimals: 18 },
		evmChainId: 43114,
		aliases: ['avax', 'avalanche_cchain', 'avalanche-cchain', 'avalanche-c', 'avalanche_c', 'cchain', 'c-chain'],
		// snowtrace.io is run by Routescan.
		explorer: evmExplorer('Snowtrace', 'snowtrace.io'),
	},
	bsc: {
		name: 'BNB Chain',
		family: 'evm',
		native: { symbol: 'BNB', decimals: 18 },
		evmChainId: 56,
		aliases: [],
		explorer: evmExplorer('BscScan', 'bscscan.com'),
	},
	base: {
		name: 'Base',
		family: 'evm',
		native: { symbol: 'ETH', decimals: 18 },
		evmChainId: 8453,
		aliases: [],
		explorer: null,
	},
	arbitrum: {
		name: 'Arbitrum',
		family: 'evm',
		native: { symbol: 'ETH', decimals: 18 },
		evmChainId: 42161,
		aliases: [],
		explorer: null,
	},
	optimism: {
		name: 'Optimism',
		family: 'evm',
		native: { symbol: 'ETH', decimals: 18 },
		evmChainId: 10,
		aliases: [],
		explorer: null,
	},
	rootstock: {
		name: 'Rootstock',
		family: 'evm',
		native: { symbol: 'RBTC', decimals: 18 },
		evmChainId: 30,
		aliases: ['rsk'],
		explorer: null,
	},
	bitcoin: {
		name: 'Bitcoin',
		family: 'utxo',
		native: { symbol: 'BTC', decimals: 8 },
		evmChainId: null,
		aliases: ['btc', 'xbt'],
		explorer: { name: 'Blockstream', address: 'https://blockstream.info/address/', tx: 'https://blockstream.info/tx/' },
	},
	litecoin: {
		name: 'Litecoin',
		family: 'utxo',
		native: { symbol: 'LTC', decimals: 8 },
		evmChainId: null,
		aliases: ['ltc'],
		explorer: { name: 'Litecoin Space', address: 'https://litecoinspace.org/address/', tx: 'https://litecoinspace.org/tx/' },
	},
	solana: {
		name: 'Solana',
		family: 'solana',
		native: { symbol: 'SOL', decimals: 9 },
		evmChainId: null,
		aliases: ['sol'],
		explorer: { name: 'Solana Explorer', address: 'https://explorer.solana.com/address/', tx: 'https://explorer.solana.com/tx/' },
	},
	sui: {
		name: 'Sui',
		family: 'sui',
		native: { symbol: 'SUI', decimals: 9 },
		evmChainId: null,
		aliases: [],
		explorer: { name: 'Suiscan', address: 'https://suiscan.xyz/mainnet/account/', tx: 'https://suiscan.xyz/mainnet/tx/' },
	},
} as const satisfies Record<string, ChainInfo>;

export type ChainId = keyof typeof CHAINS;

const BY_ID: ReadonlyMap<string, ChainInfo> = new Map(Object.entries(CHAINS));

/** The record of a chain by its id (not an alias); null for any other string. */
export function chainInfo(id: unknown): ChainInfo | null {
	return typeof id === 'string' ? BY_ID.get(id) ?? null : null;
}

// Every spelling the app stores or receives for a chain, mapped to one name. Tron has no record
// (Almstins reads no Tron data) but stored rows may still name it.
const ALIASES: ReadonlyMap<string, string> = new Map([
	...Object.entries(CHAINS).flatMap(([id, info]) => info.aliases.map((alias): [string, string] => [alias, id])),
	['trx', 'tron'],
]);

/**
 * One name per chain: lowercase, trim, drop an `onchain_` prefix, and map aliases
 * ('AVALANCHE_CCHAIN' and 'avax' are 'avalanche'). Empty is 'unknown'; an unknown name is kept
 * as given (lowercased), never guessed.
 */
export function normalizeChain(chain: unknown): string {
	const c = String(chain ?? '')
		.trim()
		.toLowerCase()
		.replace(/^onchain_/, '');
	if (!c) return 'unknown';
	return ALIASES.get(c) ?? c;
}

/** The symbol of a chain's own coin ('POL' for Polygon), or '' for a chain with no record. Takes aliases. */
export function nativeSymbol(chain: unknown): string {
	return chainInfo(normalizeChain(chain))?.native.symbol ?? '';
}

/** The symbol of an EVM chain's own coin, or '' for any chain that is not EVM. Takes aliases. */
export function evmNativeSymbol(chain: unknown): string {
	const info = chainInfo(normalizeChain(chain));
	return info?.family === 'evm' ? info.native.symbol : '';
}

/** Old symbols of a chain's coin that stored rows still carry, mapped to the current one. */
const RENAMED_COIN_SYMBOLS: ReadonlyMap<string, string> = new Map([['MATIC', 'POL']]);

/**
 * A coin symbol as it is called now: MATIC (any case) is POL; any other symbol comes back exactly
 * as given. Snapshots written before October 2026 store Polygon's coin as MATIC and later ones as
 * POL; every reader that groups or compares snapshot tokens by symbol goes through this, so the two
 * spellings are one holding.
 */
export function currentCoinSymbol(symbol: string): string {
	return RENAMED_COIN_SYMBOLS.get(String(symbol ?? '').trim().toUpperCase()) ?? symbol;
}

/** The EIP-155 id of an EVM chain (by id, not alias), or null. */
export function evmChainId(chain: unknown): number | null {
	return chainInfo(chain)?.evmChainId ?? null;
}

// ── Feature lists ────────────────────────────────────────────────────────────
// Each list is what one feature does today. Lists that differ are noted; change a list only as a
// decision about that feature.

/** The EVM chains a wallet is tagged with when it is added with none (constants.DEFAULT_ERC20_CHAINS). */
export const DEFAULT_WALLET_CHAINS = ['ethereum', 'polygon', 'avalanche'] as const satisfies readonly ChainId[];

/**
 * What createWallet in src/lib/wallets.ts stores when called with no chains. Differs from
 * DEFAULT_WALLET_CHAINS (no Polygon) since before October 2026; kept, not decided here.
 */
export const CREATE_WALLET_FALLBACK_CHAINS = ['ethereum', 'avalanche'] as const satisfies readonly ChainId[];

/**
 * The chains the weekly sync-wallets cron assumes for a wallet row whose chains column is empty.
 * Differs from DEFAULT_WALLET_CHAINS (no Avalanche); the sync then adds Polygon in any case.
 */
export const SYNC_CRON_FALLBACK_CHAINS = ['ethereum', 'polygon'] as const satisfies readonly ChainId[];

/** The chains the EVM transaction sync (src/lib/sync/syncTransactions.ts) reads from Etherscan and Routescan. */
export const WALLET_SYNC_EVM_CHAINS = ['ethereum', 'polygon', 'avalanche'] as const satisfies readonly ChainId[];

/** The chains whose full token list is read from Alchemy (src/lib/evmTokenDiscovery.ts). */
export const EVM_DISCOVERY_CHAINS = ['ethereum', 'polygon'] as const satisfies readonly ChainId[];

/** The chains /api/wallets/[id]/transactions reads and accepts, in the order its error message lists them. */
export const WALLET_TX_CHAINS = ['ethereum', 'avalanche', 'polygon'] as const satisfies readonly ChainId[];

/** The chains the Agent Vault watches (src/lib/agentVault). */
export const VAULT_CHAINS = ['ethereum', 'polygon', 'avalanche'] as const satisfies readonly ChainId[];

/** The rails Verify offers for a receiving address. */
export const VERIFY_ADDRESS_RAILS = ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin'] as const satisfies readonly ChainId[];

/** The Verify address rails on EVM: one 0x address, the same key on each. */
export const VERIFY_EVM_RAILS: ReadonlySet<string> = new Set(VERIFY_ADDRESS_RAILS.filter((c) => CHAINS[c].family === 'evm'));

/** The chains whose snapshot tokens count toward net worth (src/lib/networth.ts). */
export const NETWORTH_CHAINS = ['ethereum', 'polygon', 'avalanche', 'solana', 'sui', 'rootstock', 'bitcoin', 'litecoin'] as const satisfies readonly ChainId[];

/** The EVM chains a dashboard tin's badge names on its own (vault.astro); any other mix shows ETH. */
export const TIN_BADGE_EVM_CHAINS = ['ethereum', 'polygon', 'avalanche', 'arbitrum'] as const satisfies readonly ChainId[];

/**
 * The chains an Add wallet form tags a wallet with when its owner names it by a coin symbol
 * (WalletOverview, the Research page). ETH means every default EVM chain. POL and its old name
 * MATIC are Polygon. Any other symbol has no entry: the forms keep it as typed.
 */
const SYMBOL_CHAINS: ReadonlyMap<string, readonly ChainId[]> = new Map<string, readonly ChainId[]>([
	['BTC', ['bitcoin']],
	['LTC', ['litecoin']],
	['ETH', DEFAULT_WALLET_CHAINS],
	['SOL', ['solana']],
	['SUI', ['sui']],
	['AVAX', ['avalanche']],
	['POL', ['polygon']],
	['MATIC', ['polygon']],
]);

/** The chains for a coin symbol typed in an Add wallet form (case ignored), or null when it names none. */
export function chainsForSymbol(symbol: string): ChainId[] | null {
	const chains = SYMBOL_CHAINS.get(String(symbol ?? '').trim().toUpperCase());
	return chains ? [...chains] : null;
}

/** The chains with an explorer Almstins links to. */
export type ExplorerChain = { [K in ChainId]: (typeof CHAINS)[K]['explorer'] extends null ? never : K }[ChainId];
export const EXPLORER_CHAINS = (Object.keys(CHAINS) as ChainId[]).filter((c) => CHAINS[c].explorer !== null) as ExplorerChain[];

/** The EVM chains with an explorer, in the order a picker shows them. */
export const EXPLORER_EVM_CHAINS = ['ethereum', 'polygon', 'avalanche', 'bsc'] as const satisfies readonly ExplorerChain[];

/** Sources stored in import_transactions / exchange_accounts that are blockchains, not exchanges. */
export const CHAIN_IMPORT_SOURCES: ReadonlySet<string> = new Set(['bitcoin', 'solana', 'avalanche_cchain', 'litecoin']);

/**
 * exchange_accounts sources that hold an on-chain wallet's imported history, not an exchange
 * balance: their mirror wallet is never valued (src/lib/snapshotRows.ts).
 */
export const ON_CHAIN_IMPORT_SOURCES: ReadonlySet<string> = new Set(['bitcoin', 'litecoin']);

// ── Aave ─────────────────────────────────────────────────────────────────────

export interface AaveMarket {
	readonly chain: ChainId;
	readonly chainId: number;
	/** The Aave V3 Pool contract (checksummed). Polygon and Avalanche share one address. */
	readonly pool: string;
}

/** The Aave V3 markets Almstins reads, in the order the syncs query them. */
export const AAVE_MARKETS: readonly AaveMarket[] = [
	{ chain: 'ethereum', chainId: CHAINS.ethereum.evmChainId, pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' },
	{ chain: 'polygon', chainId: CHAINS.polygon.evmChainId, pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' },
	{ chain: 'avalanche', chainId: CHAINS.avalanche.evmChainId, pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' },
];

/** The Aave markets' EIP-155 ids, in query order. */
export const AAVE_CHAIN_IDS: readonly number[] = AAVE_MARKETS.map((m) => m.chainId);

/** EIP-155 id → chain name, for the Aave markets. */
export const AAVE_CHAIN_BY_ID: Readonly<Record<number, string>> = Object.fromEntries(AAVE_MARKETS.map((m) => [m.chainId, m.chain]));

/** EIP-155 id → Aave V3 Pool address (checksummed). */
export const AAVE_POOL_BY_CHAIN_ID: Readonly<Record<number, string>> = Object.fromEntries(AAVE_MARKETS.map((m) => [m.chainId, m.pool]));

/** The Aave V3 Pool addresses, lowercase, for recognizing a transaction to Aave. */
export const AAVE_POOL_ADDRESSES: ReadonlySet<string> = new Set(AAVE_MARKETS.map((m) => m.pool.toLowerCase()));
