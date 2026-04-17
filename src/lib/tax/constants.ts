// ─────────────────────────────────────────────────────────────────────────────
// Tax pipeline constants
//   - Known lending protocol contract addresses
//   - Income / airdrop keywords by exchange source
//   - Burn addresses
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercase Ethereum addresses for known lending protocol pools. */
export const LENDING_PROTOCOL_ADDRESSES = new Set([
	// ── Aave V2 ──────────────────────────────────────────────────────────────
	'0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', // Ethereum V2 LendingPool
	'0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', // Polygon V2 LendingPool
	'0x4f01aed16d97e3ab5ab2b501154dc9bb0f1a5a2c', // Avalanche V2 LendingPool
	// ── Aave V3 ──────────────────────────────────────────────────────────────
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Ethereum V3 Pool
	'0x794a61358d6845594f94dc1db02a252b5b4814ad', // Polygon V3 / Avalanche V3 / Arbitrum V3 / Optimism V3
	'0xa97684ead0e402dc232d5a977953df7ecbab3cdb', // Avalanche V3 PoolAddressesProvider
	'0x8145edddf43f50276641b55bd3ad95944510021e', // Avalanche V3 Pool (alternate proxy)
	// ── Aave V2 Ethereum wrappers / helpers ──────────────────────────────────
	'0xcc9a0b7c43dc2a5f023bb9b738e45b0ef6f4bf0e', // Aave V2 ETH Gateway
	'0x1c91347f2a44538ce62ef789017b69f63b8a99a6', // Aave V2 WETH Gateway (Avalanche)
	// ── Compound V3 ──────────────────────────────────────────────────────────
	'0xc3d688b66703497daa19211eedff47f25384cdc3', // Compound V3 Ethereum USDC market
	// ── Compound V2 ──────────────────────────────────────────────────────────
	'0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b', // Compound V2 Ethereum comptroller
	// ── Maker / DAI ──────────────────────────────────────────────────────────
	'0x9759a6ac90977b93b58547b4a71c78317f391a28', // Maker DSS
]);

/** Addresses that indicate a coin is permanently burned / destroyed. */
export const BURN_ADDRESSES = new Set([
	'0x0000000000000000000000000000000000000000',
	'0x000000000000000000000000000000000000dead',
	'0x0000000000000000000000000000000000000001',
]);

// ── Coinbase kind → category mapping ─────────────────────────────────────────

export const COINBASE_INCOME_KINDS = new Set([
	'Coinbase Earn',
	'Rewards Income',
	'Staking Income',
	'Learning Reward',
	'Inflation Reward',
	'Interest Income',
	'Staking Reward',
	'Token Grant',
]);

export const COINBASE_AIRDROP_KINDS = new Set(['Airdrop']);

export const COINBASE_BUY_KINDS = new Set([
	'Buy',
	'Advanced Trade Buy',
	'Subscription Acquisition',
]);

export const COINBASE_SELL_KINDS = new Set([
	'Sell',
	'Advanced Trade Sell',
	'Subscription Liquidation',
]);

export const COINBASE_SWAP_KINDS = new Set(['Convert']);

export const COINBASE_TRANSFER_IN_KINDS = new Set(['Receive']);
export const COINBASE_TRANSFER_OUT_KINDS = new Set(['Send', 'Withdrawal']);

export const COINBASE_FEE_KINDS = new Set(['Fee', 'Network Fee']);

// ── Crypto.com kind → category mapping ───────────────────────────────────────

export const CRYPTOCOM_INCOME_KINDS = new Set([
	'crypto_earn_interest_paid',
	'crypto_earn_program_created',
	'referral_card_cashback',
	'rewards_platform_deposit_credited',
	'interest_swap_credited',
	'crypto_wallet_swap_credited',
	'crypto_earn_extra_interest_paid',
	'mco_stake_reward',
	'card_cashback_reverted',
	'admin_wallet_credited',
	'referral_gift',
	'pay_rewards',
]);

export const CRYPTOCOM_BUY_KINDS = new Set([
	'crypto_purchase',
	'viban_purchase',
	'van_purchase',
	'recurring_buy_order',
	'dust_conversion_credited',
]);

export const CRYPTOCOM_SELL_KINDS = new Set([
	'crypto_cashout',
	'dust_conversion_debited',
	'viban_card_top_up',
]);

export const CRYPTOCOM_SWAP_KINDS = new Set([
	'crypto_exchange',
	'crypto_wallet_swap_debited',
	'interest_swap_debited',
]);

export const CRYPTOCOM_TRANSFER_OUT_KINDS = new Set([
	'crypto_withdrawal',
	'crypto_earn_program_withdrawn',
]);

export const CRYPTOCOM_TRANSFER_IN_KINDS = new Set([
	'crypto_deposit',
	'crypto_to_exchange_transfer',
	'exchange_to_crypto_transfer',
]);

// ── Generic keyword detectors (applied when specific mappings don't match) ────

export const INCOME_KEYWORDS = [
	'reward',
	'interest',
	'earn',
	'staking',
	'yield',
	'cashback',
	'bonus',
	'grant',
	'airdrop',
];

export const LOAN_INTEREST_KEYWORDS = ['interest paid', 'borrow fee', 'accrued interest'];

/** Transfer match window: transactions within this many minutes of each other
 *  can be considered the same wallet-to-wallet transfer (on-chain pairs). */
export const TRANSFER_MATCH_WINDOW_MINUTES = 90;

/**
 * Wider transfer match window for CEX→CEX or CEX→on-chain pairs.
 * CEX CSV exports often have coarse timestamps (daily batches, delayed
 * posting) so a 90-minute window misses legitimate transfers like
 * LTC sent to Coinbase that posts hours later.
 */
export const TRANSFER_MATCH_WINDOW_CEX_MINUTES = 360; // 6 hours

/** Transfer match tolerance: the receiving side is allowed to be this much
 *  smaller than the sending side (gas / bridge fees eat some). */
export const TRANSFER_AMOUNT_TOLERANCE = 0.02; // 2 %

// ── DeFi event detection ──────────────────────────────────────────────────────

/** Keywords that suggest a liquidity pool deposit or withdrawal event. */
export const DEFI_LP_KEYWORDS = [
	'liquidity',
	'pool deposit',
	'pool withdrawal',
	'add liquidity',
	'remove liquidity',
	'uniswap v2',
	'uniswap v3',
	'curve lp',
	'sushiswap lp',
	'balancer lp',
	'provide lp',
	'lp token',
	'pool token',
];

/**
 * Wrapped token → underlying token pairs.
 * Wrapping/unwrapping these may be a taxable swap — flag for review.
 */
export const WRAPPED_TOKEN_MAP = new Map<string, string>([
	['WBTC',   'BTC'],
	['BTC.B',  'BTC'],  // Avalanche Bridge wrapped Bitcoin
	['BTCB',   'BTC'],  // alternate symbol same asset
	['WETH',   'ETH'],
	['STETH',  'ETH'],
	['WSTETH', 'STETH'],
	['CBETH',  'ETH'],
	['RETH',   'ETH'],
	['BETH',   'ETH'],
	['FRXETH', 'ETH'],
	['WAVAX',  'AVAX'], // Wrapped AVAX (common in Aave collateral)
	['SAVAX',  'AVAX'], // Staked AVAX (Benqi liquid staking)
]);

/**
 * Token symbols whose inbound transactions from exchange platforms are likely
 * rebase income events (positive rebase = ordinary income at FMV).
 */
export const REBASE_TOKEN_SYMBOLS = new Set([
	'OHM',
	'GOHM',
	'AMPL',
]);

/** Keywords suggesting perpetual / margin funding rate payments or receipts. */
export const DEFI_FUNDING_KEYWORDS = [
	'funding rate',
	'funding payment',
	'perp funding',
	'perpetual funding',
	'margin interest',
	'borrowing fee',
];
