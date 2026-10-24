// src/lib/prices/walletTokenPricing.ts
//
// The USD price of a token a wallet holds on-chain, for both snapshot writers (Sync Tins and the
// wallet card's refresh). Pure: takes the ticker map from buildTickerPriceMap, no network.
//
// Same rule as Aave positions (src/lib/aave/pricing.ts): stablecoins at $1, 1:1 wrappers as their
// base coin (AAVE_BASE_COIN), everything else, WBTC included, from its own ticker or not at all. A
// missing ticker means unpriced (null), never a guess and never $0. Wallet-only additions:
//   - the native Polygon coin is stored as MATIC and prices as POL;
//   - an Avalanche bridged copy (LINK.e, DAI.e) prices as its base coin;
//   - only symbols on PRICE_SYMBOL_ALLOWLIST are priced, and only the exact stablecoin symbols get
//     $1, so an airdrop named like a big coin ("USDC-REWARD") never inherits a price.

import { AAVE_BASE_COIN } from '@/lib/aave/pricing';
import { PRICE_SYMBOL_ALLOWLIST } from '@/lib/prices/sanitizeSymbols';

const STABLES = new Set(['USDC', 'USDT', 'USDT0', 'USDC.E', 'USDT.E']);

export function walletTokenUsdPrice(symbol: string, tickerPrices: ReadonlyMap<string, number>): number | null {
	let sym = String(symbol ?? '').trim().toUpperCase();
	if (!sym) return null;
	if (STABLES.has(sym)) return 1;
	if (sym === 'MATIC') sym = 'POL';
	const base = AAVE_BASE_COIN.get(sym) ?? (sym.endsWith('.E') ? sym.slice(0, -2) : sym);
	if (!PRICE_SYMBOL_ALLOWLIST.has(sym.replace(/\./g, '')) && !PRICE_SYMBOL_ALLOWLIST.has(base)) return null;
	const price = tickerPrices.get(base);
	return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}
