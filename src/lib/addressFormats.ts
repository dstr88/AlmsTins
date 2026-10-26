/**
 * The shapes of blockchain addresses and transaction hashes, written once. Every other file
 * imports from here instead of writing `0x` + 40 hex digits again (tests/ci/chainFactsGuard.test.ts
 * fails on a new copy). Copies drifted before: some accepted an uppercase `0X`, some only
 * lowercase hex, and two bech32 checks accepted different prefixes.
 *
 * Shape only: no checksum is verified here (EIP-55, base58check and the bech32 checksum are
 * separate, stricter steps where a caller needs them, e.g. src/lib/walletChecker.ts).
 *
 * No database or server imports: React islands and bundled page scripts use this too.
 */

/** One base58 character (Bitcoin's alphabet: no 0, O, I or l). Case-sensitive. */
export const BASE58_CHAR = '[1-9A-HJ-NP-Za-km-z]';

/** The bech32 data alphabet (BIP-173): no '1', 'b', 'i' or 'o'. */
export const BECH32_DATA_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// ── EVM ──────────────────────────────────────────────────────────────────────

/** An EVM address with no anchors, for building larger patterns: lowercase 0x, 40 hex digits in either case. */
export const EVM_ADDRESS_SOURCE = '0x[0-9a-fA-F]{40}';

/** Like EVM_ADDRESS_SOURCE, but an uppercase 0X prefix is accepted too. */
export const EVM_ADDRESS_ANY_PREFIX_SOURCE = '0[xX][0-9a-fA-F]{40}';

/** An EVM address as typed: lowercase 0x and 40 hex digits in either case (checksum case is allowed, not checked). */
export const EVM_ADDRESS = new RegExp(`^${EVM_ADDRESS_SOURCE}$`);

/** An EVM address in its stored form: all lowercase. */
export const EVM_ADDRESS_LOWER = /^0x[0-9a-f]{40}$/;

/** An EVM address with either 0x or 0X, hex digits in either case. */
export const EVM_ADDRESS_ANY_PREFIX = new RegExp(`^${EVM_ADDRESS_ANY_PREFIX_SOURCE}$`);

/** An EVM transaction hash: 0x and 64 hex digits in either case. */
export const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** An EVM transaction hash in its stored form: all lowercase. */
export const EVM_TX_HASH_LOWER = /^0x[0-9a-f]{64}$/;

/** True for a string that, trimmed, is an EVM address (EVM_ADDRESS). */
export function isEvmAddress(value: unknown): boolean {
	return typeof value === 'string' && EVM_ADDRESS.test(value.trim());
}

/** The first EVM address written anywhere in a text (a URI, a QR payload), as written; null when there is none. */
export function findEvmAddress(text: string): string | null {
	return String(text ?? '').match(EVM_ADDRESS_SOURCE)?.[0] ?? null;
}

// ── Sui ──────────────────────────────────────────────────────────────────────

/**
 * A full Sui address: 0x and 64 hex digits in either case. The same shape as an EVM transaction
 * hash; only the chain tells them apart.
 */
export const SUI_ADDRESS = EVM_TX_HASH;

/** A full Sui address in its stored form: all lowercase. */
export const SUI_ADDRESS_LOWER = EVM_TX_HASH_LOWER;

// ── Base58 (Solana) ──────────────────────────────────────────────────────────

/** A Solana address (a base58 public key, 32 to 44 characters). Case-sensitive. */
export const SOLANA_ADDRESS = new RegExp(`^${BASE58_CHAR}{32,44}$`);

// ── Bech32 (segwit) ──────────────────────────────────────────────────────────

/**
 * The human-readable parts a segwit address may start with, before its '1' separator. One list
 * for every check that asks "is this a segwit address": before October 2026 one copy accepted
 * bc, tb and ltc and another bc, tb, bcrt, ltc and tltc.
 */
export const BECH32_HRPS = {
	mainnet: ['bc', 'ltc'],
	test: ['tb', 'bcrt', 'tltc'],
} as const;

/** A segwit pattern for the given human-readable parts, matched on the lowercased value. */
export function bech32Pattern(...hrps: readonly string[]): RegExp {
	return new RegExp(`^(?:${hrps.join('|')})1[${BECH32_DATA_CHARS}]{6,87}$`);
}

/**
 * A segwit (bech32 / bech32m) address on Bitcoin or Litecoin, mainnet or test, matched on the
 * lowercased value. The data charset, not the prefix alone, is what keeps a base58 (Solana)
 * string that happens to start with "bc1" from matching.
 */
export const BECH32_ADDRESS = bech32Pattern(...BECH32_HRPS.mainnet, ...BECH32_HRPS.test);
