/**
 * normalize.ts: the input normalizers the tax code shares. Pure: no database, no I/O.
 *
 * normalizeAsset and normalizeAmount are lifecycle.ts's symbol aliasing and raw on-chain amount
 * parsing, moved here unchanged. lifecycle.ts imports them back under its old names, so the
 * lifecycle rebuild reads symbols and quantities exactly as before, and the ledger adapters and
 * the transfer resolver read them the same way.
 *
 * normalizeTxHash puts a transaction hash in the form two sources can be compared on.
 *
 * parseInstant reads the two timestamp spellings the app stores (see below), the way
 * historyRows.toUtcDate does, so rows from both tables sort and compare on one clock.
 */

/**
 * The symbol every tax path compares on: upper case, with the aliases the lifecycle rebuild has
 * always applied. 'native' becomes the chain's coin (ethereum, polygon and avalanche only), and
 * MATIC and WMATIC are POL.
 */
export function normalizeAsset(symbol: string, chain?: string | null): string {
	const upper = symbol.toUpperCase();
	if (upper === 'NATIVE') {
		if (chain === 'ethereum') return 'ETH';
		if (chain === 'polygon') return 'POL';
		if (chain === 'avalanche') return 'AVAX';
	}
	if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
	return upper;
}

/**
 * A raw on-chain amount in the token's smallest unit, as a number of whole units:
 * normalizeAmount('1500000000000000000', 18) is 1.5. Null for an empty or unreadable value. A
 * missing or non-finite decimals is read as 18.
 *
 * Known gap, kept so the lifecycle rebuild does not change: a decimals of 0 reads the value as a
 * fraction ('5' with 0 decimals is 0.5, not 5). A token with whole-unit amounts needs this fixed,
 * as a deliberate lifecycle change, before an adapter feeds it such a row.
 */
export function normalizeAmount(value: string | null, decimals: number | null): number | null {
	if (!value) return null;
	const safeDecimals = Number.isFinite(decimals) ? (decimals as number) : 18;
	const padded = value.padStart(safeDecimals + 1, '0');
	const whole = padded.slice(0, -safeDecimals) || '0';
	const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
	const numeric = Number(fraction ? `${whole}.${fraction}` : whole);
	return Number.isFinite(numeric) ? numeric : null;
}

/**
 * A transaction hash in the form two sources can be compared on. A 64-digit hex hash (an EVM
 * hash with or without its 0x, a Bitcoin or Litecoin txid) is lowercased and loses the 0x.
 * Anything else (a Solana signature, a Sui digest, an exchange's own id) is case-sensitive and is
 * kept as it is. Empty for no hash.
 */
export function normalizeTxHash(hash: unknown): string {
	const h = hash == null ? '' : String(hash).trim();
	const hex = /^(?:0x)?([0-9a-fA-F]{64})$/.exec(h);
	return hex ? hex[1].toLowerCase() : h;
}

// The spellings the app stores: a date, or a date and time with a T or a space, with or without a zone.
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A stored timestamp as milliseconds since the epoch, or null when it cannot be read. Stored
 * times are ISO with a zone, or "YYYY-MM-DD HH:MM:SS" (or a T instead of the space) meaning UTC.
 * A date alone is midnight UTC. Anything else is refused rather than guessed at: Date.parse reads
 * "Mar 4, 2025" in the machine's zone, and rolls a day that does not exist (Feb 30) into the next
 * month. A zone-less time is given a Z first, for the same reason.
 */
export function parseInstant(value: unknown): number | null {
	const raw = value == null ? '' : value instanceof Date ? value.toISOString() : String(value).trim();
	const m = ISO_LIKE.exec(raw);
	if (!m) return null;
	const [, year, month, day, hour, , zone] = m;
	const midnight = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	if (midnight.getUTCFullYear() !== Number(year) || midnight.getUTCMonth() !== Number(month) - 1 || midnight.getUTCDate() !== Number(day)) return null;
	const iso = raw.replace(' ', 'T');
	const ms = Date.parse(hour !== undefined && !zone ? `${iso}Z` : iso);
	return Number.isFinite(ms) ? ms : null;
}
