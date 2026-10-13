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

export const UNASSIGNED = 'unassigned';

// Every spelling the app stores or receives for a chain, mapped to one name.
const CHAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
	eth: 'ethereum',
	mainnet: 'ethereum',
	'ethereum-mainnet': 'ethereum',
	ethereum_mainnet: 'ethereum',
	matic: 'polygon',
	'polygon-pos': 'polygon',
	polygon_pos: 'polygon',
	avax: 'avalanche',
	avalanche_cchain: 'avalanche',
	'avalanche-cchain': 'avalanche',
	'avalanche-c': 'avalanche',
	avalanche_c: 'avalanche',
	cchain: 'avalanche',
	'c-chain': 'avalanche',
	btc: 'bitcoin',
	xbt: 'bitcoin',
	sol: 'solana',
	ltc: 'litecoin',
	rsk: 'rootstock',
	trx: 'tron',
});

/** Sources stored in import_transactions / exchange_accounts that are blockchains, not exchanges. */
const CHAIN_SOURCES: ReadonlySet<string> = new Set(['bitcoin', 'solana', 'avalanche_cchain', 'litecoin']);

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Lowercase, trim, drop an `onchain_` prefix, and map aliases: 'AVALANCHE_CCHAIN' → 'avalanche'. */
export function normalizeChain(chain: unknown): string {
	const c = String(chain ?? '')
		.trim()
		.toLowerCase()
		.replace(/^onchain_/, '');
	if (!c) return 'unknown';
	return CHAIN_ALIASES[c] ?? c;
}

export function isEvmAddress(address: unknown): boolean {
	return typeof address === 'string' && EVM_ADDRESS.test(address.trim());
}

/** Trim; lowercase only an EVM address. Everything else keeps its case. */
export function normalizeWalletAddress(address: unknown): string {
	const a = String(address ?? '').trim();
	return EVM_ADDRESS.test(a) ? a.toLowerCase() : a;
}

/** True when an import source is a blockchain (bitcoin, solana, avalanche_cchain, ...), not an exchange. */
export function isChainSource(source: unknown): boolean {
	return CHAIN_SOURCES.has(canonicalImportSource(source));
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
