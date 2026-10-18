/**
 * transferLinks.ts: pair each transfer-out with the transfer-in it landed as. Pure: no database,
 * no I/O. The lot ledger turns a pair into a move (the coins keep their date and cost); a row
 * left unpaired is the caller's to classify (an unmatched send, an untracked arrival).
 *
 * Link precedence, strongest first. Each rule runs over every row before the next one starts, so
 * a stronger link always wins a row, and inside a rule rows are taken in (time, id) order:
 *
 *   1. hash         the same transaction hash (normalized: a 64-digit hex hash compares without
 *                   case or 0x). Link 'hash'.
 *   2. confirmed    a link the owner entered by hand (a row's linkedTxId) or a transfer_matches
 *                   row with status 'confirmed'. Link 'confirmed'.
 *   3. suggested    a transfer_matches row with status 'auto' or 'suggested'. Link 'heuristic'.
 *   4. window       the closest same-asset arrival within 6 hours after the send and within 1% of
 *                   the send's quantity, at any size (arrivalMatch.ts, the lifecycle rebuild's
 *                   guards, plus the 1% itself: its own floor of 0.01 units lets a send of 0.001
 *                   take an arrival of 0.0109). Link 'heuristic'.
 *
 * A pair must have the same normalized asset, an out row and an in row, and different wallet keys,
 * except a pair linked by hash and a pair of the Crypto.com internal kinds (crypto_to_exchange_transfer,
 * exchange_to_crypto_transfer). A transfer_matches row with status 'rejected' is the owner saying
 * these two are not a transfer: that pair is never linked, by any rule. A row joins at most one
 * link. Only rows the source labels as transfers are candidates (see TransferRow.source).
 *
 * A false link hides a sale, so every 'heuristic' link, and every link between two different
 * owners, is the ledger's to raise for review; this module only labels them.
 */

import type { OwnerIndex } from '../walletIdentity';
import { normalizeWalletAddress, parseWalletKey } from '../walletKey';
import { AMOUNT_TOLERANCE, LINK_WINDOW_MINUTES, selectArrivalMatch, type ArrivalCandidate } from './arrivalMatch';
import { normalizeAsset, normalizeTxHash, parseInstant } from './normalize';

/** How a pair was made, and how far to trust it. The ledger's move carries this as `link`. */
export type TransferLinkKind = 'hash' | 'confirmed' | 'heuristic';

/** Which rule made the pair. */
export type TransferLinkVia = 'hash' | 'manual' | 'confirmed_match' | 'auto_match' | 'suggested_match' | 'arrival_window';

export interface TransferRow {
	/**
	 * Unique across the rows, and the key transfer_matches rows refer to. A repeated id keeps its
	 * first row (by time) and ignores the rest.
	 */
	id: string;
	/** 'out': the coins left `wallet`. 'in': they arrived. */
	direction: 'in' | 'out';
	asset: string;
	/** Absolute quantity in whole units. */
	qty: number;
	at: string;
	/** The wallet key of this leg (walletOfRow). */
	wallet: string;
	/**
	 * Where the row came from, which decides if it can be a transfer leg at all:
	 *   import      an exchange import row: a leg only if pass 1 called it a transfer (`category`)
	 *   chain_sync  a chain-synced send or receive (bitcoin, solana, avalanche_cchain): always a leg
	 *   onchain     a transactions row: a leg if it touches a tracked address (fromAddress, toAddress)
	 */
	source: 'import' | 'chain_sync' | 'onchain';
	hash?: string | null;
	/** Pass 1 category of an import row. */
	category?: string | null;
	/** The importer's kind, for the Crypto.com internal transfers. */
	kind?: string | null;
	fromAddress?: string | null;
	toAddress?: string | null;
	/** A link the owner entered by hand: the id of the other leg. */
	linkedTxId?: string | null;
}

/** A transfer_matches row, by the ids of the rows it names. */
export interface TransferMatchRow {
	outId: string;
	inId: string;
	status: 'auto' | 'suggested' | 'confirmed' | 'rejected' | string;
	confidence?: number | null;
}

export interface TransferLink {
	outId: string;
	inId: string;
	/** The normalized asset. */
	asset: string;
	qtyOut: number;
	qtyIn: number;
	outAt: string;
	inAt: string;
	outWallet: string;
	inWallet: string;
	link: TransferLinkKind;
	via: TransferLinkVia;
	/** Both wallets have an owner label, and the labels differ (NFC, case-folded). */
	ownersDiffer: boolean;
}

export interface TransferLinkResult {
	/** By time of the out leg, then id. */
	links: TransferLink[];
	/** Candidate out rows no rule paired, by time then id. */
	unlinkedOut: string[];
	/** Candidate in rows no rule paired, by time then id. */
	unlinkedIn: string[];
}

const CRYPTO_COM_INTERNAL = new Set(['crypto_to_exchange_transfer', 'exchange_to_crypto_transfer']);
const MIN_QTY = 1e-10;
// The band for the arrival window: 1% of the send. A hair over, so a decimal 1% (0.99 for 1) is not lost to float noise.
const BAND = AMOUNT_TOLERANCE * (1 + 1e-9);

const text = (v: unknown): string => (v == null ? '' : String(v)).trim();

interface Leg {
	row: TransferRow;
	id: string;
	direction: 'in' | 'out';
	asset: string;
	qty: number;
	/** NaN when the time cannot be read: such a leg is listed as unlinked but never paired. */
	ms: number;
	wallet: string;
	hash: string;
	kind: string;
	linkedTxId: string;
	/** An unreadable time, a bad quantity or no asset: listed, never paired. */
	usable: boolean;
}

// ── Owners ───────────────────────────────────────────────────────────────────

// Upper then lower case folds what lower case alone does not ('Straße' and 'STRASSE' are one name).
const foldOwner = (label: string) => label.normalize('NFC').trim().toUpperCase().toLowerCase();

/** The owner label of a wallet key: its own key, else any key of the same on-chain address. */
function ownerOfWallet(index: OwnerIndex, walletKey: string): string | null {
	const direct = index.byKey.get(walletKey);
	if (direct) return direct;
	const parsed = parseWalletKey(walletKey);
	if (parsed?.kind === 'chain' && parsed.address) return index.byAddress.get(normalizeWalletAddress(parsed.address)) ?? null;
	return null;
}

/** True only when both wallets have an owner label and the labels differ (NFC, case-folded). */
export function ownersDiffer(index: OwnerIndex, walletA: string, walletB: string): boolean {
	const a = ownerOfWallet(index, walletA);
	const b = ownerOfWallet(index, walletB);
	return !!a && !!b && foldOwner(a) !== foldOwner(b);
}

// ── Ordering ─────────────────────────────────────────────────────────────────

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** (time, id), with an unreadable time last. The last keys settle two rows that share an id. */
function cmpLeg(a: Leg, b: Leg): number {
	const aOk = Number.isFinite(a.ms);
	const bOk = Number.isFinite(b.ms);
	if (aOk !== bOk) return aOk ? -1 : 1;
	if (aOk && a.ms !== b.ms) return a.ms - b.ms;
	return cmpStr(a.id, b.id) || cmpStr(a.direction, b.direction) || cmpStr(a.asset, b.asset) || a.qty - b.qty || cmpStr(a.wallet, b.wallet) || cmpStr(a.hash, b.hash);
}

const pairKey = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

// ── Candidates ───────────────────────────────────────────────────────────────

function isCandidate(row: TransferRow, referenced: ReadonlySet<string>, owned: ReadonlySet<string>): boolean {
	if (row.direction !== 'in' && row.direction !== 'out') return false;
	if (text(row.linkedTxId) || referenced.has(text(row.id))) return true;
	const kind = text(row.kind);
	if (CRYPTO_COM_INTERNAL.has(kind)) return true;
	if (row.source === 'chain_sync') return true;
	if (row.source === 'import') return text(row.category) === 'transfer';
	const from = normalizeWalletAddress(row.fromAddress);
	const to = normalizeWalletAddress(row.toAddress);
	return (!!from && owned.has(from)) || (!!to && owned.has(to));
}

function toLeg(row: TransferRow): Leg {
	const id = text(row.id);
	const asset = text(row.asset) ? normalizeAsset(text(row.asset)) : '';
	const ms = parseInstant(row.at);
	const qty = typeof row.qty === 'number' ? row.qty : Number.NaN;
	const wallet = text(row.wallet);
	return {
		row,
		id,
		direction: row.direction,
		asset,
		qty,
		ms: ms ?? Number.NaN,
		wallet,
		hash: normalizeTxHash(row.hash),
		kind: text(row.kind),
		linkedTxId: text(row.linkedTxId),
		usable: !!id && !!asset && !!wallet && ms !== null && Number.isFinite(qty) && qty > MIN_QTY,
	};
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Pair the candidate transfer legs among `rows` by the rules in the header.
 *
 * @param rows            every row the caller can tell is a transfer leg or might be; this
 *                        function drops the ones the source does not label as transfers
 * @param ownedIndex      the tracked on-chain addresses (walletOfRow.buildOwnedIndex)
 * @param transferMatches the tenant's transfer_matches rows, by row id
 * @param ownerIndex      owner labels by wallet key and address (walletIdentity.loadOwnerIndex)
 */
export function resolveTransferLinks(
	rows: readonly TransferRow[],
	ownedIndex: ReadonlySet<string>,
	transferMatches: readonly TransferMatchRow[],
	ownerIndex: OwnerIndex,
): TransferLinkResult {
	const referenced = new Set<string>();
	for (const r of rows) {
		const target = text(r.linkedTxId);
		if (target) referenced.add(target);
	}

	// Candidates in (time, id) order. A repeated id keeps its first row: a row joins one link.
	const seen = new Set<string>();
	const legs: Leg[] = rows
		.filter((r) => isCandidate(r, referenced, ownedIndex))
		.map(toLeg)
		.sort(cmpLeg)
		.filter((l) => {
			if (!l.id) return true;
			if (seen.has(l.id)) return false;
			seen.add(l.id);
			return true;
		});
	const byId = new Map(legs.filter((l) => l.id).map((l) => [l.id, l]));
	const outs = legs.filter((l) => l.usable && l.direction === 'out');
	const ins = legs.filter((l) => l.usable && l.direction === 'in');

	const rejected = new Set<string>();
	for (const m of transferMatches) if (m.status === 'rejected') rejected.add(pairKey(text(m.outId), text(m.inId)));

	const linked = new Set<string>();
	const links: TransferLink[] = [];

	const bothInternal = (a: Leg, b: Leg) => CRYPTO_COM_INTERNAL.has(a.kind) && CRYPTO_COM_INTERNAL.has(b.kind);

	/** Could `out` and `inn` be one transfer, under the rules every link follows? */
	const canPair = (out: Leg, inn: Leg, byHash: boolean): boolean =>
		out.usable &&
		inn.usable &&
		out.direction === 'out' &&
		inn.direction === 'in' &&
		out.id !== inn.id &&
		out.asset === inn.asset &&
		!linked.has(out.id) &&
		!linked.has(inn.id) &&
		!rejected.has(pairKey(out.id, inn.id)) &&
		(byHash || out.wallet !== inn.wallet || bothInternal(out, inn));

	const link = (out: Leg, inn: Leg, kind: TransferLinkKind, via: TransferLinkVia) => {
		linked.add(out.id);
		linked.add(inn.id);
		links.push({
			outId: out.id,
			inId: inn.id,
			asset: out.asset,
			qtyOut: out.qty,
			qtyIn: inn.qty,
			outAt: text(out.row.at),
			inAt: text(inn.row.at),
			outWallet: out.wallet,
			inWallet: inn.wallet,
			link: kind,
			via,
			ownersDiffer: ownersDiffer(ownerIndex, out.wallet, inn.wallet),
		});
	};

	// 1. Hash. Within a hash, an out takes the same-asset in closest to its quantity.
	const insByHash = new Map<string, Leg[]>();
	for (const inn of ins) {
		if (!inn.hash) continue;
		const list = insByHash.get(inn.hash) ?? [];
		list.push(inn);
		insByHash.set(inn.hash, list);
	}
	for (const out of outs) {
		if (!out.hash || linked.has(out.id)) continue;
		let best: Leg | null = null;
		for (const inn of insByHash.get(out.hash) ?? []) {
			if (!canPair(out, inn, true)) continue;
			if (!best || Math.abs(inn.qty - out.qty) < Math.abs(best.qty - out.qty)) best = inn;
		}
		if (best) link(out, best, 'hash', 'hash');
	}

	// 2. Confirmed: the owner's own links first, then confirmed transfer_matches.
	const byOut = (a: [Leg, Leg], b: [Leg, Leg]) => cmpLeg(a[0], b[0]) || cmpLeg(a[1], b[1]);
	const manual: [Leg, Leg][] = [];
	for (const l of legs) {
		if (!l.linkedTxId) continue;
		const other = byId.get(l.linkedTxId);
		if (!other) continue;
		if (l.direction === 'out' && other.direction === 'in') manual.push([l, other]);
		else if (l.direction === 'in' && other.direction === 'out') manual.push([other, l]);
	}
	for (const [out, inn] of manual.sort(byOut)) if (canPair(out, inn, false)) link(out, inn, 'confirmed', 'manual');

	const matchedPairs = (status: (s: string) => boolean): { pair: [Leg, Leg]; status: string; confidence: number }[] => {
		const out: { pair: [Leg, Leg]; status: string; confidence: number }[] = [];
		for (const m of transferMatches) {
			if (!status(m.status)) continue;
			const o = byId.get(text(m.outId));
			const i = byId.get(text(m.inId));
			if (o && i) out.push({ pair: [o, i], status: m.status, confidence: typeof m.confidence === 'number' && Number.isFinite(m.confidence) ? m.confidence : 0 });
		}
		return out;
	};
	for (const { pair } of matchedPairs((s) => s === 'confirmed').sort((a, b) => byOut(a.pair, b.pair))) {
		if (canPair(pair[0], pair[1], false)) link(pair[0], pair[1], 'confirmed', 'confirmed_match');
	}

	// 3. The matcher's own suggestions: automatic before suggested, then the more confident.
	const statusRank = (s: string) => (s === 'auto' ? 0 : 1);
	const suggested = matchedPairs((s) => s === 'auto' || s === 'suggested').sort(
		(a, b) => statusRank(a.status) - statusRank(b.status) || b.confidence - a.confidence || byOut(a.pair, b.pair),
	);
	for (const { pair, status } of suggested) {
		if (canPair(pair[0], pair[1], false)) link(pair[0], pair[1], 'heuristic', status === 'auto' ? 'auto_match' : 'suggested_match');
	}

	// 4. The arrival window: the lifecycle rebuild's guards, over every out still unpaired.
	const insByAsset = new Map<string, Leg[]>();
	for (const inn of ins) {
		const list = insByAsset.get(inn.asset) ?? [];
		list.push(inn);
		insByAsset.set(inn.asset, list);
	}
	const windowMs = LINK_WINDOW_MINUTES * 60_000;
	for (const out of outs) {
		if (linked.has(out.id)) continue;
		const pool = insByAsset.get(out.asset) ?? [];
		// The arrival cannot precede the send and must fall inside the window: find where it starts.
		let lo = 0;
		let hi = pool.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (pool[mid].ms < out.ms) lo = mid + 1;
			else hi = mid;
		}
		const candidates: ArrivalCandidate[] = [];
		const byCandidate = new Map<string, Leg>();
		for (let i = lo; i < pool.length && pool[i].ms <= out.ms + windowMs; i++) {
			if (!canPair(out, pool[i], false)) continue;
			if (Math.abs(pool[i].qty - out.qty) > out.qty * BAND) continue;
			candidates.push({ source_id: pool[i].id, direction: 'in', amount: pool[i].qty, timestamp_utc: new Date(pool[i].ms).toISOString() });
			byCandidate.set(pool[i].id, pool[i]);
		}
		const best = selectArrivalMatch(out.qty, out.ms, candidates, new Set(), LINK_WINDOW_MINUTES, BAND);
		const inn = best ? byCandidate.get(best.source_id) : undefined;
		if (inn) link(out, inn, 'heuristic', 'arrival_window');
	}

	const order = new Map(legs.map((l, i) => [l.id, i] as const));
	links.sort((a, b) => (order.get(a.outId) ?? 0) - (order.get(b.outId) ?? 0) || cmpStr(a.inId, b.inId));
	return {
		links,
		unlinkedOut: legs.filter((l) => l.direction === 'out' && !linked.has(l.id) && l.id).map((l) => l.id),
		unlinkedIn: legs.filter((l) => l.direction === 'in' && !linked.has(l.id) && l.id).map((l) => l.id),
	};
}
