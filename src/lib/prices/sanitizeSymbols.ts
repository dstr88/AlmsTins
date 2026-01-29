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
	const allowed = sanitized.filter((symbol) => PRICE_SYMBOL_ALLOWLIST.has(symbol));
	return allowed.sort();
}
