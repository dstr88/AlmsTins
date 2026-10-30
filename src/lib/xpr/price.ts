/**
 * The current USD price of XPR for a balance snapshot: CoinGecko's `proton` coin (XPR Network was
 * called Proton). null when CoinGecko cannot answer, so a snapshot stores the balance unpriced
 * rather than as zero. Only the chain's own coin is priced: any other token is unpriced and listed
 * (src/lib/xpr/assets.ts). A row's price on its own day comes from the shared day-price path
 * (src/lib/sync/utxoHistoricalPrice.ts), which resolves the symbol XPR to the same coin.
 */

import { getSimplePricesById } from '../prices/coingecko';

export const XPR_COINGECKO_ID = 'proton';

export async function fetchXprPriceUsd(): Promise<number | null> {
	try {
		const usd = (await getSimplePricesById([XPR_COINGECKO_ID]))[XPR_COINGECKO_ID]?.usd;
		return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : null;
	} catch {
		return null;
	}
}
