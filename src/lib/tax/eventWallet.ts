/**
 * eventWallet.ts: which wallet a lifecycle event belongs to, and how to show it. Pure: no database.
 *
 * The lifecycle table keeps no wallet of its own. Each event points at its source row (an import
 * row or a transactions row), and walletOfRow resolves that row to the wallet it sits in. The
 * event's direction picks the leg of a self-send that it belongs to.
 */

import { buildOwnedIndex, walletOfRow, type WalletEntry, type WalletOfRowContext } from './walletOfRow';
import { parseWalletKey } from '../walletKey';

/** The columns of an event's source row, as the lifecycle query joins them in. */
export interface EventSourceRow {
	sourceType: unknown;
	direction: unknown;
	importWalletId?: unknown;
	importSource?: unknown;
	importAccountId?: unknown;
	txWalletId?: unknown;
	txChain?: unknown;
	fromAddress?: unknown;
	toAddress?: unknown;
}

/** One row of `wallets`: its id and the address it tracks. */
export interface WalletRecord {
	id: unknown;
	address: unknown;
}

/** The wallet context walletOfRow needs, from the tenant's wallets. */
export function walletContextOf(wallets: readonly WalletRecord[]): WalletOfRowContext {
	const byId = new Map<string, WalletEntry>();
	for (const w of wallets) {
		byId.set(String(w.id ?? ''), { address: String(w.address ?? '') });
	}
	return {
		wallets: byId,
		owned: buildOwnedIndex(wallets.map((w) => w.address)),
	};
}

/** The wallet key an event belongs to (walletKey.ts format), or null when its source is unknown. */
export function eventWalletKey(row: EventSourceRow, ctx: WalletOfRowContext): string | null {
	const direction = row.direction === 'in' || row.direction === 'out' ? row.direction : null;
	let resolved;
	if (row.sourceType === 'import') {
		resolved = walletOfRow(
			{ origin: 'import', source: row.importSource, walletId: row.importWalletId, accountId: row.importAccountId },
			ctx,
		);
	} else if (row.sourceType === 'onchain') {
		resolved = walletOfRow(
			{ origin: 'onchain', walletId: row.txWalletId, chain: row.txChain, fromAddress: row.fromAddress, toAddress: row.toAddress },
			ctx,
		);
	} else {
		return null;
	}
	const leg = resolved.legs.find((l) => l.side === direction) ?? resolved.legs[0];
	return leg?.wallet ?? null;
}

/**
 * What to show for a wallet key: the address for an on-chain wallet, "source · account" for an
 * exchange account. Null when the key is missing or the wallet is unassigned.
 */
export function walletDisplayOf(key: string | null | undefined): string | null {
	const parsed = parseWalletKey(key);
	if (!parsed) return null;
	if (parsed.kind === 'cex') return parsed.accountId ? `${parsed.source} · ${parsed.accountId}` : parsed.source;
	return parsed.address;
}
