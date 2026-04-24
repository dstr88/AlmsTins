const MAX_SYMBOLS = 50;
const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{1,14}$/;
const NON_ASCII_RE = /[^\x00-\x7F]/;
const INVALID_CHARS_RE = /[\s@|/\\:\[\]{}()<>$!'\",;]/;

export const PRICE_SYMBOL_ALLOWLIST = new Set([
	'BTC',
	'ETH',
	'USDT',
	'BNB',
	'XRP',
	'SOL',
	'USDC',
	'ADA',
	'LINK',
	'XLM',
	'ZEC',
	'SUI',
	'POL',
	'MATIC',
	'WMATIC',
	'WPOL',
	'WETH',
	'WBTC',
	'AVAX',
	'AAVE',
	'ARB',
	'STETH',
	'WSTETH',
	'QUICK',
	'BTCB',
	'SAVAX',
	'WAVAX',
	'WETHE',
	// Additional tokens found in user snapshots
	'LTC',
	'CRO',
	'DOT',
	'PYTH',
]);

const SYMBOL_NORMALIZATION_MAP = new Map<string, string>([
	['WETH', 'ETH'],
	['WMATIC', 'MATIC'],
	['WBTC', 'BTC'],
	['BTC.B', 'BTC'],
	['BTCB', 'BTC'],
	['SAVAX', 'AVAX'],
	['WAVAX', 'AVAX'],
	['WETH.E', 'ETH'],
	['WETHE', 'ETH'],
	['USDCE', 'USDC'],
	['USDC.E', 'USDC'],
	['WSTETH', 'STETH'],
]);

export function sanitizeSymbol(raw: string): string | null {
	const normalized = raw.normalize('NFKC').trim().toUpperCase();
	if (!normalized) return null;
	if (NON_ASCII_RE.test(normalized)) return null;
	if (INVALID_CHARS_RE.test(normalized)) return null;
	if (normalized.length < 2 || normalized.length > 15) return null;
	if (!TICKER_RE.test(normalized)) return null;
	return normalized;
}

function normalizePriceSymbol(symbol: string): string {
	return SYMBOL_NORMALIZATION_MAP.get(symbol) ?? symbol;
}

export function sanitizeSymbols(input: string[], max = MAX_SYMBOLS): string[] {
	const seen = new Set<string>();
	for (const raw of input) {
		const symbol = sanitizeSymbol(String(raw ?? ''));
		if (!symbol) continue;
		if (seen.has(symbol)) continue;
		seen.add(symbol);
	}
	const sorted = Array.from(seen).sort();
	return max && sorted.length > max ? sorted.slice(0, max) : sorted;
}

export function allowlistSymbols(input: string[]) {
	const sanitized = sanitizeSymbols(input, Number.MAX_SAFE_INTEGER);
	const normalized = sanitized.map(normalizePriceSymbol);
	const allowed = normalized.filter((symbol) => PRICE_SYMBOL_ALLOWLIST.has(symbol));
	return Array.from(new Set(allowed)).sort();
}
