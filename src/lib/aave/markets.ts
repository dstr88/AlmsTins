/**
 * Every Aave V3 market, named for the DeFi tin and the liquidation email. Aave runs 24 live markets on
 * 21 chains, four of them on Ethereum alone (main, Lido, EtherFi, Horizon), and each computes its own
 * health factor. The app used to check only the main market on Ethereum, Polygon and Avalanche, so a
 * position in the Ethereum Lido market never showed and never alerted.
 *
 * The market list comes live from Aave's API; this file only turns an Aave market name into:
 *   - a position key: the key in GET /api/aave/health's `chains`. The three main markets keep the keys
 *     they always had ('ethereum', 'polygon', 'avalanche'), so cached payloads and tests stay valid;
 *     every other market gets a slug ('ethereum_lido', 'arbitrum', 'bnb').
 *   - a label: "Ethereum Lido", "BNB Chain". Known names come from the map; a market Aave adds later
 *     falls back to its name split into words, so it shows up without a code change.
 *
 * Pure, so the endpoint, the cron and the tests share it. Market names stay English in every language.
 */

const PREFIX = /^AaveV3/;

/** Aave market name (without "AaveV3") → label, where splitting the name into words reads wrong. */
const LABELS: Readonly<Record<string, string>> = {
	EthereumEtherFi: 'Ethereum EtherFi',
	BNB: 'BNB Chain',
	ZkSync: 'zkSync',
	XLayer: 'X Layer',
	MegaETH: 'MegaETH',
};

/** "AaveV3EthereumLido" → "EthereumLido". */
function bareName(marketName: string): string {
	return marketName.trim().replace(PREFIX, '') || marketName.trim();
}

/** "EthereumLido" → ["Ethereum", "Lido"]; runs of capitals stay together ("BNB", "MegaETH" → "Mega", "ETH"). */
function words(bare: string): string[] {
	return bare.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [bare];
}

/** "AaveV3EthereumLido" → "Ethereum Lido"; "AaveV3Polygon" → "Polygon". */
export function marketLabel(marketName: string): string {
	const bare = bareName(marketName);
	return LABELS[bare] ?? words(bare).join(' ');
}

/** "AaveV3EthereumLido" → "ethereum_lido"; "AaveV3Polygon" → "polygon". */
export function marketKey(marketName: string): string {
	const bare = bareName(marketName);
	const slug = words(bare).join('_').toLowerCase();
	return slug || bare.toLowerCase();
}
