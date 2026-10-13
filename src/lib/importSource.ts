// ─────────────────────────────────────────────────────────────────────────────
// Canonical `source` values for import_transactions and exchange_accounts.
//
// Crypto.com is stored as 'crypto_com' (underscore) by every writer: the CSV
// importer, import/detect.ts, the demo seed, and the exchange-account routes.
// pass1 keys its Crypto.com kind map and card-rebate intercept on that value
// (61e4521), and the vault tins, dedup, and transfer matcher group by it.
//
// 'crypto-com' (hyphen) is only a URL slug (/api/import/crypto-com,
// /api/exchanges/crypto-com/...). It must never be stored: a row saved with it
// falls through to pass1's keyword guesses and gets its own exchange account.
// ─────────────────────────────────────────────────────────────────────────────

export const CRYPTO_COM_SOURCE = 'crypto_com';

// Stored value → display name, for the exchanges the app has tins for.
const KNOWN_SOURCES: Record<string, string> = {
	coinbase:   'Coinbase',
	crypto_com: 'Crypto.com',
	gemini:     'Gemini',
	kraken:     'Kraken',
	robinhood:  'Robinhood',
	venmo:      'Venmo',
	cashapp:    'Cash App',
	exodus:     'Exodus',
};

// Letters and digits only, so 'crypto-com', 'Crypto.com', 'crypto com' and
// 'crypto_com' all compare equal.
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const BY_COMPACT = new Map(Object.keys(KNOWN_SOURCES).map((s) => [compact(s), s]));

/**
 * Maps a free-form source name (an AI screenshot parse, a route slug) to the
 * value stored in the database. Known exchanges resolve to their canonical
 * value; anything else is lowercased and trimmed, as before.
 */
export function canonicalImportSource(raw: unknown): string {
	if (typeof raw !== 'string') return 'unknown';
	const s = raw.toLowerCase().trim();
	if (!s) return 'unknown';
	return BY_COMPACT.get(compact(s)) ?? s;
}

/** Display name for a stored source: 'crypto_com' → 'Crypto.com', 'chase' → 'Chase'. */
export function importSourceDisplayName(source: string): string {
	return KNOWN_SOURCES[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}
