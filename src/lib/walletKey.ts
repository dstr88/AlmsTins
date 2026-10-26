/**
 * walletKey.ts: one stable string per wallet, shared by the history export now and by the
 * per-wallet engine later (pass4's per-wallet pool keys on the same function).
 *
 *   Exchange accounts:            cex:{source}:{account_id}     e.g. cex:crypto_com:6f1c...
 *   Imported rows with no account: cex:{source}:unassigned
 *   On-chain wallets:             {chain}:{address}             e.g. ethereum:0xabc..., solana:9xQe...
 *   On-chain rows with no wallet:  {chain}:unassigned
 *
 * The cex: format is the one exchange mirror wallets (cexSnapshot.ts), address labels and the
 * transfer matcher already use. One EVM address on two chains is two wallets (owner decision,
 * Oct 12 2026): ethereum:0xabc and polygon:0xabc. Chain names go through one normalizing map,
 * so imported rows (source avalanche_cchain) and on-chain rows (chain avalanche) for the same
 * address get the same key. Only EVM addresses (0x + 40 hex) are lowercased: base58 (Solana,
 * legacy Bitcoin) is case-sensitive, so it keeps its case.
 *
 * Pure: no database, no I/O.
 */

import { canonicalImportSource } from './importSource';
import { EVM_ADDRESS, isEvmAddress } from './addressFormats';
import { CHAIN_IMPORT_SOURCES, normalizeChain } from './chains';

export const UNASSIGNED = 'unassigned';

// Chain names (normalizeChain) and the EVM address check live in ./chains and ./addressFormats;
// re-exported because the wallet-key callers import them from here.
export { isEvmAddress, normalizeChain };

/** Trim; lowercase only an EVM address. Everything else keeps its case. */
export function normalizeWalletAddress(address: unknown): string {
	const a = String(address ?? '').trim();
	return EVM_ADDRESS.test(a) ? a.toLowerCase() : a;
}

/** The chain an address most likely belongs to, for a wallet with no chain and no rows. */
export function guessChainFromAddress(address: string): string {
	const a = address.trim();
	const lower = a.toLowerCase();
	if (isEvmAddress(a)) return 'ethereum';
	if (/^0x[0-9a-f]{64}$/.test(lower)) return 'sui';
	if (lower.startsWith('ltc1')) return 'litecoin';
	if (lower.startsWith('bc1') || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a)) return 'bitcoin';
	if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
	if (/^custom_/i.test(a)) return 'custom';
	return 'unknown';
}

/** True when an import source is a blockchain (bitcoin, solana, avalanche_cchain, ...), not an exchange. */
export function isChainSource(source: unknown): boolean {
	return CHAIN_IMPORT_SOURCES.has(canonicalImportSource(source));
}

/** cex:{source}:{account_id}, or cex:{source}:unassigned when the row has no account. */
export function cexWalletKey(source: unknown, accountId?: unknown): string {
	const s = canonicalImportSource(source);
	const id = typeof accountId === 'string' ? accountId.trim() : accountId == null ? '' : String(accountId).trim();
	return `cex:${s}:${id || UNASSIGNED}`;
}

/**
 * {chain}:{address}, or {chain}:unassigned when there is no address. An address that is
 * already a cex: key (an exchange mirror wallet row stores `cex:{source}:{accountId}` as its
 * address) is that key.
 */
export function chainWalletKey(chain: unknown, address: unknown): string {
	const a = normalizeWalletAddress(address);
	if (a.toLowerCase().startsWith('cex:')) {
		const parsed = parseWalletKey(a);
		if (parsed?.kind === 'cex') return cexWalletKey(parsed.source, parsed.accountId);
	}
	return `${normalizeChain(chain)}:${a || UNASSIGNED}`;
}

export type WalletKeyInput =
	| { kind: 'cex'; source: unknown; accountId?: unknown }
	| { kind: 'chain'; chain: unknown; address?: unknown };

export function walletKey(input: WalletKeyInput): string {
	return input.kind === 'cex' ? cexWalletKey(input.source, input.accountId) : chainWalletKey(input.chain, input.address);
}

export type ParsedWalletKey =
	| { kind: 'cex'; source: string; accountId: string | null }
	| { kind: 'chain'; chain: string; address: string | null };

/** Inverse of walletKey(). Null for a string that is not a wallet key. */
export function parseWalletKey(key: unknown): ParsedWalletKey | null {
	if (typeof key !== 'string') return null;
	const k = key.trim();
	if (k.toLowerCase().startsWith('cex:')) {
		const rest = k.slice(4);
		const i = rest.indexOf(':');
		if (i <= 0 || i === rest.length - 1) return null;
		const id = rest.slice(i + 1);
		return { kind: 'cex', source: rest.slice(0, i), accountId: id === UNASSIGNED ? null : id };
	}
	const i = k.indexOf(':');
	if (i <= 0 || i === k.length - 1) return null;
	const address = k.slice(i + 1);
	return { kind: 'chain', chain: k.slice(0, i), address: address === UNASSIGNED ? null : address };
}

/** True for cex:{source}:unassigned and {chain}:unassigned. */
export function isUnassignedWalletKey(key: unknown): boolean {
	const p = parseWalletKey(key);
	if (!p) return false;
	return p.kind === 'cex' ? p.accountId === null : p.address === null;
}
