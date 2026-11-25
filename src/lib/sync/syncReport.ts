/**
 * What the Bookkeeping page's Sync now button tells the customer after /api/wallets/sync-all
 * answers. The answer lists every wallet and chain (AllWalletSyncStats in ./syncTransactions.ts).
 * A chain that failed is in the answer with `ok: false`; before Nov 2026 the button looked only at
 * the HTTP status, so a sync where every Ethereum wallet failed reloaded the page as if all went
 * well.
 *
 * A wallet skipped because its address is not an EVM address (a custom wallet) is not a failure.
 *
 * No database or server imports: the page's bundled script uses this.
 */

import { chainInfo, normalizeChain } from '@/lib/chains';

export interface SyncFailures {
	/** Wallets with at least one chain that failed, or that failed before any chain was read. */
	failedWallets: number;
	/** The chains that failed, as ids ('ethereum', 'avalanche'), each once, in the order first seen. */
	failedChains: string[];
	/** True when at least one wallet and chain synced. */
	anySynced: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Reads the sync-all answer. Anything unreadable counts as nothing failed and nothing synced. */
export function syncFailures(answer: unknown): SyncFailures {
	const perWallet = isObj(answer) && Array.isArray(answer.perWallet) ? answer.perWallet : [];
	const chains = new Set<string>();
	let failedWallets = 0;
	let anySynced = false;
	for (const w of perWallet) {
		if (!isObj(w) || w.skippedReason) continue;
		const list = Array.isArray(w.chains) ? w.chains.filter(isObj) : [];
		let failed = Boolean(w.error);
		for (const c of list) {
			if (c.ok === false || (c.error && c.ok !== true)) {
				failed = true;
				const id = normalizeChain(c.chain);
				if (id) chains.add(id);
			} else {
				anySynced = true;
			}
		}
		if (failed) failedWallets += 1;
	}
	return { failedWallets, failedChains: [...chains], anySynced };
}

/** The strings the message is built from (src/i18n/dashboard/bookkeeping.ts). */
export interface SyncFailureStrings {
	/** "1 wallet could not be synced{where}." */
	syncFailedOne: string;
	/** "{count} wallets could not be synced{where}." */
	syncFailedMany: string;
	/** " on {chains}" */
	syncFailedWhere: string;
	/** Said when some wallets and chains did sync. */
	syncFailedRest: string;
	/** Said when nothing synced. */
	syncFailedNone: string;
}

/** The chains' names joined the way the language joins a list: "Ethereum and Avalanche". */
export function chainNames(ids: readonly string[], lang: string): string {
	const names = ids.map((id) => chainInfo(id)?.name ?? id);
	try {
		return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(names);
	} catch {
		return names.join(', ');
	}
}

/** The message shown under Sync now, or null when nothing failed. */
export function syncFailureMessage(f: SyncFailures, s: SyncFailureStrings, lang: string): string | null {
	if (f.failedWallets === 0) return null;
	const where = f.failedChains.length ? s.syncFailedWhere.replace('{chains}', chainNames(f.failedChains, lang)) : '';
	const head = (f.failedWallets === 1 ? s.syncFailedOne : s.syncFailedMany)
		.replace('{count}', String(f.failedWallets))
		.replace('{where}', where);
	return `${head} ${f.anySynced ? s.syncFailedRest : s.syncFailedNone}`;
}
