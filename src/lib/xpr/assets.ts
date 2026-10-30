/**
 * How an XPR Network token is named in Almstins. A token on an Antelope chain is its contract plus
 * its symbol: anyone can deploy a contract and mint a token called 'XUSDC' or 'XPR'. So the chain's
 * own coin is only eosio.token's XPR, and every other token is stored as `SYMBOL@contract`, which
 * can never be mistaken for, merged with or priced as a real coin of the same ticker (the '@' is
 * not a ticker character, so the price lookups skip it: src/lib/prices/sanitizeSymbols.ts).
 */

import { CHAINS } from '../chains';

/** The contract that holds the chain's own coin. */
export const XPR_NATIVE_CONTRACT = 'eosio.token';

const NATIVE_SYMBOL = CHAINS.xpr.native.symbol;

/** True for the chain's own coin: the XPR of eosio.token, and nothing else called XPR. */
export function isXprNativeAsset(symbol: unknown, contract: unknown): boolean {
	return String(symbol ?? '').trim().toUpperCase() === NATIVE_SYMBOL && String(contract ?? '').trim().toLowerCase() === XPR_NATIVE_CONTRACT;
}

/** 'XPR' for the chain's own coin, else 'SYMBOL@contract'. */
export function xprAssetSymbol(symbol: unknown, contract: unknown): string {
	const sym = String(symbol ?? '').trim().toUpperCase();
	const con = String(contract ?? '').trim().toLowerCase();
	return isXprNativeAsset(sym, con) ? NATIVE_SYMBOL : `${sym}@${con}`;
}

/** The contract of a stored asset name ('XUSDC@xtokens' is 'xtokens', 'XPR' is eosio.token), or null for a name that is not one. */
export function xprContractOfAsset(asset: unknown): string | null {
	const a = String(asset ?? '').trim();
	if (a.toUpperCase() === NATIVE_SYMBOL) return XPR_NATIVE_CONTRACT;
	const at = a.indexOf('@');
	return at > 0 && at < a.length - 1 ? a.slice(at + 1) : null;
}
