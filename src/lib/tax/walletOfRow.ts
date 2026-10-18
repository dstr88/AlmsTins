/**
 * walletOfRow.ts: which wallet or account a transaction row belongs to. Pure: no database, no I/O.
 *
 * Two halves that share one set of rules.
 *
 * The records half (refOfImportRow, refOfOnchainRow, refOfSuiRow) is what historyRows.ts used to do
 * inline: it says where a row claims to belong, as a WalletRef, from the row's own columns. The
 * history export and the plain CSV call exactly these, so their output is unchanged. They leave a
 * manual token-basis row, an Aave row and a collapsed on-chain self-send in the unassigned bucket
 * or on the wallet that happened to sync last, which is fine for a list of records.
 *
 * The tax half (walletOfRow) resolves a row to wallet keys (walletKey.ts), the strings the
 * per-wallet ledger pools on, and adds the cases a pool cannot leave to chance:
 *
 *   import row, chain source, wallet_id     the wallet's chain key ({chain}:{address})
 *   import row, exchange, account_id        cex:{source}:{account_id}
 *   import row, no account_id               cex:{source}:unassigned
 *   source 'manual', batch 'manual-{id}'    that wallet (a token-basis row names no chain, so the first
 *                                           chain the wallet lists, else the chain its address looks like)
 *   source 'aave_{chain}'                   the wallet of the transactions row with the same tx hash
 *   transactions row                        the chain and the address of the side that moved. When
 *                                           both sides are tracked addresses it is a self-send:
 *                                           two legs, an out and an in. They share the row's tx
 *                                           hash, so give each leg its own id and the transfer
 *                                           resolver links them by hash.
 *   Sui and custom rows                     their wallet_id
 *
 * Tenant scope is the caller's: the wallets, owned addresses and tx lookup it passes are the
 * session tenant's own.
 */

import type { WalletRef } from '../walletIdentity';
import { canonicalImportSource } from '../importSource';
import { cexWalletKey, chainWalletKey, guessChainFromAddress, isChainSource, normalizeChain, normalizeWalletAddress, parseWalletKey } from '../walletKey';
import { normalizeTxHash } from './normalize';

const text = (v: unknown): string => (v == null ? '' : String(v)).trim();

// ── Records half: where a row says it belongs ────────────────────────────────

/**
 * An imported row's reference. Chain-synced imports (bitcoin, solana, avalanche_cchain, litecoin)
 * key on the wallet, because their account id is shared across addresses; exchange rows key on
 * the account, or on the exchange's unassigned bucket when the row has none.
 */
export function refOfImportRow(r: { source?: unknown; wallet_id?: unknown; account_id?: unknown }): WalletRef {
	const source = text(r.source);
	const walletId = text(r.wallet_id);
	const accountId = text(r.account_id);
	return walletId && isChainSource(source)
		? { kind: 'wallet', walletId, chain: normalizeChain(source) }
		: { kind: 'account', source, accountId: accountId || null };
}

/** An on-chain (transactions) row's reference: its wallet and chain. */
export function refOfOnchainRow(r: { wallet_id?: unknown; chain?: unknown }): WalletRef {
	return { kind: 'wallet', walletId: text(r.wallet_id) || null, chain: normalizeChain(r.chain) };
}

/** A Sui row's reference: its wallet. */
export function refOfSuiRow(r: { wallet_id?: unknown }): WalletRef {
	return { kind: 'wallet', walletId: text(r.wallet_id) || null, chain: 'sui' };
}

// ── Reference to key ─────────────────────────────────────────────────────────

/** One row of `wallets`, as far as a key needs it. */
export interface WalletEntry {
	/** As stored. An exchange mirror wallet stores cex:{source}:{accountId}. */
	address: string;
	/** wallets.chains, when the caller has it. Only manual token-basis rows read it. */
	chains?: readonly unknown[] | null;
}

/**
 * The wallet key of a reference, the same key walletIdentity.resolveWalletRef gives it (a test
 * holds the two together): an exchange account is cex:{source}:{id}, an exchange mirror wallet is
 * its account, an on-chain wallet is {chain}:{address}, and a wallet that is not in `wallets`
 * is {chain}:unassigned.
 */
export function walletKeyOfRef(ref: WalletRef, wallets: ReadonlyMap<string, WalletEntry>): string {
	if (ref.kind === 'account') return cexWalletKey(ref.source, ref.accountId);
	const chain = normalizeChain(ref.chain);
	const wallet = ref.walletId ? wallets.get(ref.walletId) : undefined;
	if (!wallet) return chainWalletKey(chain, null);
	if (wallet.address.toLowerCase().startsWith('cex:')) {
		const parsed = parseWalletKey(wallet.address);
		if (parsed?.kind === 'cex') return cexWalletKey(parsed.source, parsed.accountId);
	}
	return chainWalletKey(chain, wallet.address);
}

// ── Tax half ─────────────────────────────────────────────────────────────────

/** The addresses the tenant tracks, normalized (an EVM address is lowercased). Exchange mirrors are not addresses. */
export function buildOwnedIndex(addresses: Iterable<unknown>): Set<string> {
	const owned = new Set<string>();
	for (const address of addresses) {
		const a = normalizeWalletAddress(address);
		if (a && !a.toLowerCase().startsWith('cex:')) owned.add(a);
	}
	return owned;
}

export interface WalletOfRowContext {
	/** The tenant's rows of `wallets`, by wallets.id. */
	wallets: ReadonlyMap<string, WalletEntry>;
	/** The tracked on-chain addresses (buildOwnedIndex). Without it an on-chain row keys on its wallet_id. */
	owned?: ReadonlySet<string>;
	/** transactions.wallet_id by normalized tx hash (normalizeTxHash), for rows that carry only a hash (Aave). */
	walletIdByTxHash?: ReadonlyMap<string, string>;
}

/** Where a row of each table is read from. Fields are the columns the loaders select, in camelCase. */
export type WalletRow =
	| { origin: 'import'; source: unknown; walletId?: unknown; accountId?: unknown; importBatchId?: unknown; txHash?: unknown }
	| { origin: 'onchain'; walletId?: unknown; chain: unknown; fromAddress?: unknown; toAddress?: unknown; txType?: unknown }
	| { origin: 'sui'; walletId?: unknown };

/** How a row's wallet was found. For diagnostics and tests; the key is what counts. */
export type WalletBasis =
	| 'wallet' // a row of `wallets`: a chain-synced import, an on-chain, Sui or custom row, by wallet_id
	| 'account' // an exchange account, by account_id
	| 'unassigned' // the row names no wallet or account (or one the tenant does not have)
	| 'manual_batch' // a manual token-basis row, by its import batch
	| 'aave_tx' // an Aave row, by its tx hash
	| 'owned_address'; // an on-chain row, by the tracked address on the side that moved

export interface WalletLeg {
	/** 'out': the coins left this wallet. 'in': they arrived. null: the row does not say. */
	side: 'in' | 'out' | null;
	wallet: string;
}

export interface RowWallet {
	/** One leg for most rows; two for a self-send (an out leg, then an in leg). */
	legs: WalletLeg[];
	basis: WalletBasis;
}

const MANUAL_BATCH = /^manual-(.+)$/;

/** The side an on-chain row's type says the synced wallet was on. */
function sideOfTxType(txType: unknown): 'in' | 'out' | null {
	const t = text(txType).toLowerCase();
	if (t === 'incoming' || t === 'token_in') return 'in';
	if (t === 'outgoing' || t === 'token_out') return 'out';
	return null;
}

/** The chain a manual token-basis row's wallet is keyed on: its first listed chain, else the chain its address looks like. */
function chainOfManualWallet(wallet: WalletEntry): string {
	for (const c of wallet.chains ?? []) {
		const chain = normalizeChain(c);
		if (chain !== 'unknown') return chain;
	}
	return guessChainFromAddress(wallet.address);
}

function refBasis(ref: WalletRef, wallets: ReadonlyMap<string, WalletEntry>): WalletBasis {
	if (ref.kind === 'account') return ref.accountId ? 'account' : 'unassigned';
	return ref.walletId && wallets.has(ref.walletId) ? 'wallet' : 'unassigned';
}

function oneLeg(ref: WalletRef, ctx: WalletOfRowContext, side: WalletLeg['side'] = null): RowWallet {
	return { legs: [{ side, wallet: walletKeyOfRef(ref, ctx.wallets) }], basis: refBasis(ref, ctx.wallets) };
}

/**
 * The wallet key (or, for a self-send, the two keys) a row belongs to, by the rules in the header.
 * A rule that cannot find its wallet falls back to what the records half says, so a row never
 * goes missing: at worst it lands in an unassigned bucket.
 */
export function walletOfRow(row: WalletRow, ctx: WalletOfRowContext): RowWallet {
	if (row.origin === 'sui') return oneLeg(refOfSuiRow({ wallet_id: row.walletId }), ctx);

	if (row.origin === 'import') {
		const source = canonicalImportSource(row.source);
		// A manual token-basis row belongs to the wallet it was entered on.
		const batch = source === 'manual' ? MANUAL_BATCH.exec(text(row.importBatchId)) : null;
		const manualWallet = batch ? ctx.wallets.get(batch[1]) : undefined;
		if (manualWallet) {
			return {
				legs: [{ side: null, wallet: chainWalletKey(chainOfManualWallet(manualWallet), manualWallet.address) }],
				basis: 'manual_batch',
			};
		}
		// An Aave row has no account or wallet, but its tx hash is on a transactions row.
		if (source.startsWith('aave_') && text(row.txHash)) {
			const walletId = ctx.walletIdByTxHash?.get(normalizeTxHash(row.txHash));
			if (walletId && ctx.wallets.has(walletId)) {
				return {
					legs: [{ side: null, wallet: walletKeyOfRef({ kind: 'wallet', walletId, chain: source.slice('aave_'.length) }, ctx.wallets) }],
					basis: 'aave_tx',
				};
			}
		}
		return oneLeg(refOfImportRow({ source: row.source, wallet_id: row.walletId, account_id: row.accountId }), ctx);
	}

	// An on-chain row. The wallet_id on it is whichever wallet synced it last, so for a transfer
	// between two tracked wallets it names one of them at random. The addresses name both.
	const chain = normalizeChain(row.chain);
	const from = normalizeWalletAddress(row.fromAddress);
	const to = normalizeWalletAddress(row.toAddress);
	const fromOwned = !!ctx.owned && !!from && ctx.owned.has(from);
	const toOwned = !!ctx.owned && !!to && ctx.owned.has(to);
	const side = sideOfTxType(row.txType);
	const viaWalletId = (leg: WalletLeg['side']) => oneLeg(refOfOnchainRow({ wallet_id: row.walletId, chain: row.chain }), ctx, leg);

	if (fromOwned && toOwned) {
		return {
			legs: [
				{ side: 'out', wallet: chainWalletKey(chain, from) },
				{ side: 'in', wallet: chainWalletKey(chain, to) },
			],
			basis: 'owned_address',
		};
	}
	if (side === 'out' && fromOwned) return { legs: [{ side, wallet: chainWalletKey(chain, from) }], basis: 'owned_address' };
	if (side === 'in' && toOwned) return { legs: [{ side, wallet: chainWalletKey(chain, to) }], basis: 'owned_address' };
	// The type says nothing (a contract call, a manual kind): the tracked side tells.
	if (side === null && (fromOwned || toOwned)) {
		return fromOwned
			? { legs: [{ side: 'out', wallet: chainWalletKey(chain, from) }], basis: 'owned_address' }
			: { legs: [{ side: 'in', wallet: chainWalletKey(chain, to) }], basis: 'owned_address' };
	}
	return viaWalletId(side);
}
