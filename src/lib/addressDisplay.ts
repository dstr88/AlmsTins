/**
 * How an address looks on a screen, in one place (decision D4, Oct 25, 2026).
 *
 * Shortened, an address shows its first 8 characters, an ellipsis and its last 6:
 * `0x1234ab…89abcd`. Scams that send dust from a look-alike address ("address poisoning") match the
 * first and last 4 or 5 characters, so a longer head and tail make the look-alike easier to spot.
 * Wherever someone might send money to the address (the address details modal, a QR code, a
 * payment or receiving address), show it whole instead: never shorten it there.
 *
 * Transaction hashes, Sui digests and Solana program ids are shortened the same way, so every long
 * id on a screen reads alike. Pure and import-free: React islands, Astro frontmatter and bundled
 * Astro scripts all import it.
 */

/** Characters kept at the start of a shortened address. */
export const SHORT_HEAD = 8;
/** Characters kept at the end of a shortened address. */
export const SHORT_TAIL = 6;

/**
 * An address (or hash) as `first 8…last 6`. One no longer than 16 characters is returned whole,
 * since shortening it would hide characters without saving room. Null or empty gives ''.
 */
export function shortenAddress(value: string | null | undefined): string {
	const v = (value ?? '').trim();
	if (v.length <= SHORT_HEAD + SHORT_TAIL + 2) return v;
	return `${v.slice(0, SHORT_HEAD)}…${v.slice(-SHORT_TAIL)}`;
}
