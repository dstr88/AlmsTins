/**
 * knownContracts.ts
 *
 * Canonical token contract addresses for mainstream EVM tokens.
 * Keyed by chain name (matching the `chain` column in `transactions`)
 * then by UPPERCASE token symbol.
 *
 * Why this matters: scam tokens on Polygon routinely copy legitimate
 * symbol names ("USDC", "WETH") but deploy their own contract.
 * If a transfer shows symbol "USDC" but the contract address is not in
 * this list it is either (a) a bridged variant we don't know yet, or
 * (b) a scam.  We auto-resolve confirmed scams to $0 cost basis.
 */

import { isSpamName } from './tokenClassification';

type ChainContracts = Record<string, Set<string>>;

/** All addresses are stored lower-case for case-insensitive comparison. */
const CONTRACTS: Record<string, ChainContracts> = {
  // ── Polygon / Matic ───────────────────────────────────────────────────────
  polygon: {
    USDC:  new Set(['0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC.e (bridged)
                    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359']), // native USDC
    USDT:  new Set(['0xc2132d05d31c914a87c6611c10748aeb04b58e8f']),
    DAI:   new Set(['0x8f3cf7ad23cd3cadbd9735aff958023239c6a063']),
    WETH:  new Set(['0x7ceb23fd6bc0add59e62ac25578270cff1b9f619']),
    WBTC:  new Set(['0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6']),
    WMATIC:new Set(['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270']),
    MATIC: new Set(['0x0000000000000000000000000000000000001010']), // native MATIC ERC-20 wrapper
    AAVE:  new Set(['0xd6df932a45c0f255f85145f286ea0b292b21c90b']),
    LINK:  new Set(['0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39']),
    UNI:   new Set(['0xb33eaad8d922b1083446dc23f610c2567fb5180f']),
    STMATIC:new Set(['0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c6']),
    MATICX:new Set(['0xfa68fb4628dff1028cfec22b4162fccd0d45efb6']),
  },

  // ── Ethereum mainnet ──────────────────────────────────────────────────────
  eth: {
    USDC:  new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']),
    USDT:  new Set(['0xdac17f958d2ee523a2206206994597c13d831ec7']),
    DAI:   new Set(['0x6b175474e89094c44da98b954eedeac495271d0f']),
    WBTC:  new Set(['0x2260fac5e5542a773aa44fbcfedf7c193bc2c599']),
    WETH:  new Set(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']),
    AAVE:  new Set(['0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9']),
    LINK:  new Set(['0x514910771af9ca656af840dff83e8264ecf986ca']),
    UNI:   new Set(['0x1f9840a85d5af5bf1d1762f925bdaddc4201f984']),
    STETH: new Set(['0xae7ab96520de3a18e5e111b5eaab095312d7fe84']),
    WSTETH:new Set(['0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0']),
  },

  // ── Base ──────────────────────────────────────────────────────────────────
  base: {
    USDC:  new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']),
    WETH:  new Set(['0x4200000000000000000000000000000000000006']),
    DAI:   new Set(['0x50c5725949a6f0c72e6c4a641f24049a917db0cb']),
    CBETH: new Set(['0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22']),
  },

  // ── Arbitrum One ──────────────────────────────────────────────────────────
  arbitrum: {
    USDC:  new Set(['0xaf88d065e77c8cc2239327c5edb3a432268e5831',  // native USDC
                    '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8']), // USDC.e
    USDT:  new Set(['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9']),
    DAI:   new Set(['0xda10009cbd5d07dd0cecc66161fc93d7c9000da1']),
    WETH:  new Set(['0x82af49447d8a07e3bd95bd0d56f35241523fbab1']),
    WBTC:  new Set(['0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f']),
    ARB:   new Set(['0x912ce59144191c1204e64559fe8253a0e49e6548']),
    AAVE:  new Set(['0xba5ddd1f9d7f570dc94a51479a000e3bce967196']),
    LINK:  new Set(['0xf97f4df75117a78c1a5a0dbb814af92458539fb4']),
  },

  // ── Avalanche C-Chain ─────────────────────────────────────────────────────
  avax: {
    USDC:  new Set(['0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',  // native USDC
                    '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664']), // USDC.e
    USDT:  new Set(['0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
                    '0xc7198437980c041c805a1edcba50c1ce5db95118']), // USDT.e
    WAVAX: new Set(['0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7']),
    WETH:  new Set(['0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab']),  // WETH.e
    WBTC:  new Set(['0x50b7545627a5162f82a992c33b87adc75187b218']),  // WBTC.e
  },

  // ── BNB Smart Chain ───────────────────────────────────────────────────────
  bsc: {
    USDC:  new Set(['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d']),
    USDT:  new Set(['0x55d398326f99059ff775485246999027b3197955']),
    DAI:   new Set(['0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3']),
    WBNB:  new Set(['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c']),
    WETH:  new Set(['0x2170ed0880ac9a755fd29b2688956bd959f933f8']),
    BTCB:  new Set(['0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c']),
  },
};

// Normalise a chain string to our key
function normaliseChain(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'polygon' || c === 'matic') return 'polygon';
  if (c === 'eth' || c === 'ethereum' || c === 'mainnet') return 'eth';
  if (c === 'base') return 'base';
  if (c === 'arbitrum' || c === 'arb' || c === 'arbitrum_one') return 'arbitrum';
  if (c === 'avax' || c === 'avalanche' || c === 'avaxc') return 'avax';
  if (c === 'bsc' || c === 'bnb' || c === 'bnbchain') return 'bsc';
  return c;
}

export type ContractVerdict =
  | 'legitimate'   // contract matches a known-good address for this symbol+chain
  | 'scam'         // symbol matches a well-known token but contract is NOT known-good
  | 'unknown';     // symbol not in our list — may be legit, may be scam

/**
 * Classify a token transfer by its contract address.
 *
 * @param chain   - chain string from the transactions table
 * @param symbol  - token symbol (e.g. "USDC")
 * @param contractAddress - lower-case ERC-20 contract address from the transfer
 */
export function classifyContract(
  chain: string,
  symbol: string,
  contractAddress: string | null | undefined,
): ContractVerdict {
  if (!contractAddress) return 'unknown';

  const chainKey = normaliseChain(chain);
  const symKey   = symbol.toUpperCase();
  const addr     = contractAddress.toLowerCase();

  const chainMap = CONTRACTS[chainKey];
  if (!chainMap) return 'unknown'; // chain not in our database

  const knownSet = chainMap[symKey];
  if (!knownSet) return 'unknown'; // symbol not tracked for this chain

  return knownSet.has(addr) ? 'legitimate' : 'scam';
}

/**
 * Returns true when a fungible token's symbol or name matches a known spam/phishing
 * airdrop pattern. Delegates to the single source of truth in tokenClassification.ts
 * (the pattern lists that used to live here were consolidated there).
 */
export function isSpamToken(symbol: string, name?: string | null): boolean {
  return isSpamName(symbol, name);
}

/** Symbols that are stablecoins and should be auto-resolved at $1.00/token */
export const STABLECOIN_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'TUSD', 'USDP', 'GUSD', 'LUSD',
  'USDC.E', 'USDT.E', 'CUSD', 'USDCE',
]);
