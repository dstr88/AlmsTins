/**
 * An XPR Network account's token transfers, read from Hyperion's history index and reduced to the
 * rows the import writer stores. Pure of the database; `fetch` is injectable (tests use recorded
 * answers).
 *
 * What is read: every `transfer` action the account is the sender or the receiver of, in any token
 * contract (/v2/history/get_actions?filter=*:transfer). Rows are ordered oldest first and read in
 * pages of 1000 (the server's cap). Hyperion stops at 10,000 results per query, so the read moves
 * a time window forward instead of paging deep: each page starts at the last timestamp seen
 * (inclusive) and rows already seen at that instant are dropped by their global sequence, which is
 * unique per action on the chain. A single instant with more actions than a page is read by
 * skipping within it, up to the server's cap, past which the read stops and says so.
 *
 * What is not a row: a transfer the account is neither side of (it only authorized or was
 * notified), a transfer from the account to itself (no change in what it holds), and a transfer
 * action without a quantity (an NFT transfer). They are counted, not stored.
 */

import { normalizeXprAccountName } from '../addressFormats';
import { antelopeTimeMs, hyperionIsCurrent, xprHyperionGet, type XprRequestOptions, type XprResponse } from './client';
import { xprAssetSymbol } from './assets';

/** Hyperion's page cap. */
export const XPR_PAGE_SIZE = 1000;

/** Hyperion's cap on skip + limit for one query. */
const HYPERION_QUERY_CAP = 10_000;

export interface XprTransfer {
	/** Unique per action on the chain: the row's identity. */
	globalSequence: string;
	/** The transaction id (64 hex digits), shared by every action of the transaction. */
	txId: string;
	/** ISO 8601 UTC with milliseconds, e.g. 2026-10-30T16:25:54.000Z. */
	timestamp: string;
	/** The token contract ('eosio.token' for the chain's own coin). */
	contract: string;
	/** The stored asset name: 'XPR' or 'SYMBOL@contract'. */
	asset: string;
	/** The token's own symbol as the chain writes it. */
	symbol: string;
	/** Always positive, in whole units. */
	amount: number;
	/** Digits after the decimal point in the chain's quantity string. */
	precision: number;
	direction: 'in' | 'out';
	/** The account on the other side. */
	counterparty: string;
	memo: string;
}

export interface XprReadCounts {
	/** Actions read from the server. */
	actions: number;
	/** Rows kept (transfers the account sent or received). */
	kept: number;
	/** Actions the account was not a side of, self-transfers, and transfers with no quantity. */
	ignored: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** '63.2736 XPR' to its parts; null for anything that is not a token quantity. */
export function parseQuantity(value: unknown): { amount: number; precision: number; symbol: string } | null {
	const m = /^(\d+)(?:\.(\d+))?\s+([A-Z]{1,7})$/.exec(String(value ?? '').trim());
	if (!m) return null;
	const amount = Number(`${m[1]}${m[2] ? `.${m[2]}` : ''}`);
	return Number.isFinite(amount) ? { amount, precision: m[2]?.length ?? 0, symbol: m[3] } : null;
}

/** One Hyperion action as a transfer of `account`, or null when it is not one (see the header). */
export function transferOfAction(action: unknown, account: string): XprTransfer | null {
	if (!isObj(action) || !isObj(action.act)) return null;
	const act = action.act;
	if (act.name !== 'transfer' || !isObj(act.data)) return null;
	const { from, to } = act.data;
	if (typeof from !== 'string' || typeof to !== 'string' || from === to) return null;
	const direction = from === account ? 'out' : to === account ? 'in' : null;
	if (!direction) return null;
	const q = parseQuantity(act.data.quantity);
	const contract = typeof act.account === 'string' ? act.account.trim().toLowerCase() : '';
	const timeMs = antelopeTimeMs(action.timestamp);
	const txId = typeof action.trx_id === 'string' ? action.trx_id.trim().toLowerCase() : '';
	const sequence = action.global_sequence;
	if (!q || q.amount <= 0 || !contract || !Number.isFinite(timeMs) || !txId || !(typeof sequence === 'number' || typeof sequence === 'string')) return null;
	return {
		globalSequence: String(sequence),
		txId,
		timestamp: new Date(timeMs).toISOString(),
		contract,
		asset: xprAssetSymbol(q.symbol, contract),
		symbol: q.symbol,
		amount: q.amount,
		precision: q.precision,
		direction,
		counterparty: direction === 'out' ? to : from,
		memo: typeof act.data.memo === 'string' ? act.data.memo : '',
	};
}

export interface XprHistoryPage {
	transfers: XprTransfer[];
	counts: XprReadCounts;
}

export interface ReadXprHistoryOptions extends XprRequestOptions {
	/** Read from this instant on (inclusive). Without it, from the beginning of the chain. */
	after?: string | null;
	/** Stop starting new pages once this much time has passed (the rows read so far are returned). */
	budgetMs?: number;
	/** Called with each page's transfers, oldest first, before the next page is read. */
	onPage?: (page: XprHistoryPage) => Promise<void> | void;
}

export interface ReadXprHistoryResult {
	counts: XprReadCounts;
	/** True when everything up to now was read; false when the time budget or the server's cap stopped the read. */
	complete: boolean;
	/** The timestamp the read reached (the last action seen), for resuming. Null when nothing was read. */
	reachedAt: string | null;
}

const toQuery = (account: string, after: string | null, skip: number) =>
	`/v2/history/get_actions?account=${encodeURIComponent(account)}&filter=${encodeURIComponent('*:transfer')}&sort=asc&limit=${XPR_PAGE_SIZE}&skip=${skip}` +
	(after ? `&after=${encodeURIComponent(after.replace(/Z$/, ''))}` : '');

/**
 * Reads the account's transfers, oldest first, handing each page to onPage. Throws
 * XprUnavailableError when no server can answer a page (the pages already handed over stand).
 */
export async function readXprHistory(rawAccount: unknown, opts: ReadXprHistoryOptions = {}): Promise<ReadXprHistoryResult> {
	const account = normalizeXprAccountName(rawAccount);
	if (!account) throw new Error('not an XPR account name');
	const now = opts.now ?? Date.now;
	const started = now();
	const counts: XprReadCounts = { actions: 0, kept: 0, ignored: 0 };
	const usable = (r: XprResponse) => r.status === 200 && isObj(r.json) && Array.isArray(r.json.actions) && hyperionIsCurrent(r.json, opts.now);

	let cursor: string | null = opts.after ?? null;
	// Global sequences already taken at the cursor's instant: the next page starts at that instant again.
	let seenAtCursor = new Set<string>();
	let skip = 0;
	let reachedAt: string | null = null;

	for (;;) {
		if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) return { counts, complete: false, reachedAt };

		const r = await xprHyperionGet(toQuery(account, cursor, skip), usable, opts);
		const actions = (r.json as { actions: unknown[] }).actions;

		const fresh: unknown[] = [];
		for (const a of actions) {
			const seq = isObj(a) ? String(a.global_sequence ?? '') : '';
			if (!seq || !seenAtCursor.has(seq)) fresh.push(a);
		}
		counts.actions += fresh.length;

		const transfers: XprTransfer[] = [];
		for (const a of fresh) {
			const t = transferOfAction(a, account);
			if (t) transfers.push(t);
		}
		counts.kept += transfers.length;
		counts.ignored += fresh.length - transfers.length;
		if (transfers.length) await opts.onPage?.({ transfers, counts: { ...counts } });

		if (actions.length < XPR_PAGE_SIZE) return { counts, complete: true, reachedAt: lastTimestamp(actions) ?? reachedAt };

		const lastAt = lastTimestamp(actions);
		if (!lastAt || (cursor !== null && lastAt < cursor)) return { counts, complete: false, reachedAt };
		reachedAt = lastAt;

		if (lastAt === cursor) {
			// A whole page at one instant: read further into that instant, until the server's cap.
			skip += XPR_PAGE_SIZE;
			if (skip + XPR_PAGE_SIZE > HYPERION_QUERY_CAP) return { counts, complete: false, reachedAt };
			continue;
		}
		// Move the window to the last instant; what was taken at it is not taken twice.
		seenAtCursor = new Set(actions.filter((a) => lastTimestamp([a]) === lastAt).map((a) => String(isObj(a) ? a.global_sequence ?? '' : '')));
		cursor = lastAt;
		skip = 0;
	}
}

function lastTimestamp(actions: readonly unknown[]): string | null {
	const a = actions[actions.length - 1];
	if (!isObj(a)) return null;
	const ms = antelopeTimeMs(a.timestamp);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
