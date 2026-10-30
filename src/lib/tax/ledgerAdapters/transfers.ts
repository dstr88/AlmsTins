/**
 * transfers.ts: turn transfer legs into ledger events. Pure: no database, no I/O.
 *
 * Both engines classify their own rows, then hand the ones that look like a leg of a transfer
 * (an exchange Send or Deposit, a chain-synced send or receive, an on-chain row that touches a
 * tracked address) to this module. The transfer resolver pairs them; a pair is one `move`, which
 * the ledger never books as a sale. A leg nothing was paired with becomes the event its engine
 * said it is when it stands alone (`unpaired`): an explicit send nothing was found for consumes
 * the coins and is listed for review, an on-chain out to an address Almstins does not track stays
 * a sale, and an arrival from a source that is not tracked opens a lot at its value on arrival.
 */

import type { OwnerIndex } from '../../walletIdentity';
import type { AcquireOrigin, LedgerEvent, ManualBasis } from '../lotLedger';
import { normalizeTxHash, parseInstant } from '../normalize';
import { ownersDiffer, resolveTransferLinks, type TransferLink, type TransferMatchRow, type TransferRow } from '../transferLinks';

/** What a leg is when no rule pairs it. */
export type Unpaired =
	/** An out the source called a transfer: the coins leave, nothing is sold, the owner is told. */
	| { kind: 'send'; valueUsd: number | null }
	/** An out that is a sale when it stands alone (on-chain to an address that is not tracked). */
	| { kind: 'dispose'; proceedsUsd: number | null; category: string }
	/** An in: coins that arrive from a source Almstins does not track, at their value on arrival. */
	| { kind: 'acquire'; costUsd: number | null; origin: AcquireOrigin }
	/** Nothing: the leg is left out (the engine never counted such an arrival). */
	| { kind: 'ignore' };

export interface TransferCandidate {
	/** The leg as the resolver reads it. `id` is the row's own id (transfer_matches rows refer to it). */
	row: TransferRow;
	/** Names the row on events, findings and slices. */
	sourceRef: string;
	unpaired: Unpaired;
	/** The basis the owner entered for the sale this leg would be. A pair carries it so the ledger can say it was ignored. */
	manualBasis?: ManualBasis;
}

export interface TransferEvents {
	events: LedgerEvent[];
	links: TransferLink[];
}

/** The event a leg is when nothing was paired with it; null for a leg that is left out. */
function unpairedEvent(c: TransferCandidate): LedgerEvent | null {
	const { row, sourceRef, unpaired } = c;
	const base = { id: row.id, asset: row.asset, wallet: row.wallet, at: row.at, qty: row.qty, sourceRef };
	switch (unpaired.kind) {
		case 'send':
			return { kind: 'sendUnmatched', ...base, valueUsd: unpaired.valueUsd };
		case 'dispose':
			return { kind: 'dispose', ...base, proceedsUsd: unpaired.proceedsUsd, taxable: true, category: unpaired.category, ...(c.manualBasis ? { manualBasis: c.manualBasis } : {}) };
		case 'acquire':
			return { kind: 'acquire', ...base, costUsd: unpaired.costUsd, origin: unpaired.origin };
		default:
			return null;
	}
}

/**
 * One transaction can have several tracked ends: a split (one wallet pays two of the owner's own
 * wallets) or a consolidation (two wallets pay a third). The resolver pairs one out with one in, which
 * would leave the extra ends unpaired (an arrival that opens a second lot, a send that is used up for
 * nothing). Legs that share a transaction hash and a coin, with more than one out or more than one in,
 * are paired here instead, oldest first, splitting quantities across them. What is left over once the
 * ins are covered is a fee (it rides on the last move's quantity out); more in than out is a surplus.
 */
function splitMoves(group: TransferCandidate[], ownerIndex: OwnerIndex): { moves: LedgerEvent[]; used: Set<string> } {
	const byTime = (a: TransferCandidate, b: TransferCandidate) =>
		(parseInstant(a.row.at) ?? 0) - (parseInstant(b.row.at) ?? 0) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
	const outs = group.filter((c) => c.row.direction === 'out').sort(byTime);
	const ins = group.filter((c) => c.row.direction === 'in').sort(byTime);
	const totalOut = outs.reduce((a, c) => a + c.row.qty, 0);
	const totalIn = ins.reduce((a, c) => a + c.row.qty, 0);
	const left = outs.map((c) => c.row.qty);
	const moves: Extract<LedgerEvent, { kind: 'move' }>[] = [];
	// A leg the split did not use (a repeat of the same row, an out left over) stays what it was on its own.
	const used = new Set<string>();
	let oi = 0;
	for (const inn of ins) {
		let need = inn.row.qty;
		while (need > 1e-12 && oi < outs.length) {
			const out = outs[oi];
			const take = Math.min(need, left[oi]);
			moves.push({
				kind: 'move',
				id: `${out.row.id}>${inn.row.id}`,
				asset: out.row.asset,
				fromWallet: out.row.wallet,
				toWallet: inn.row.wallet,
				outAt: out.row.at,
				inAt: inn.row.at,
				qtyOut: take,
				qtyIn: take,
				link: 'hash',
				ownersDiffer: ownersDiffer(ownerIndex, out.row.wallet, inn.row.wallet),
				outRef: out.sourceRef,
				inRef: inn.sourceRef,
				...(out.manualBasis ? { manualBasis: out.manualBasis } : {}),
			});
			used.add(out.row.id);
			used.add(inn.row.id);
			left[oi] -= take;
			need -= take;
			if (left[oi] <= 1e-12) oi++;
		}
		// More arrived than any out covers: the extra rides on the last move in as a surplus.
		if (need > 1e-12 && moves.length) moves[moves.length - 1].qtyIn += need;
	}
	// More went out than arrived: the difference is a fee, carried on the last move out.
	if (totalOut > totalIn + 1e-12 && moves.length) moves[moves.length - 1].qtyOut += totalOut - totalIn;
	return { moves, used };
}

/**
 * Pair the legs and make events: a `move` for every pair, the leg's own event for every leg left over.
 *
 * @param candidates      every leg the engine reads as a transfer
 * @param ownedIndex      the tracked on-chain addresses (walletOfRow.buildOwnedIndex)
 * @param transferMatches the tenant's transfer_matches rows, plus any link the engine's own classifier made
 * @param ownerIndex      owner labels by wallet key and address (walletIdentity.loadOwnerIndex)
 */
export function transferEvents(
	candidates: readonly TransferCandidate[],
	ownedIndex: ReadonlySet<string>,
	transferMatches: readonly TransferMatchRow[],
	ownerIndex: OwnerIndex,
): TransferEvents {
	const { links } = resolveTransferLinks(
		candidates.map((c) => c.row),
		ownedIndex,
		transferMatches,
		ownerIndex,
	);
	const byId = new Map<string, TransferCandidate>();
	for (const c of candidates) if (!byId.has(c.row.id)) byId.set(c.row.id, c);

	const events: LedgerEvent[] = [];
	const paired = new Set<string>();

	// Transactions with more than one tracked out or in (a split, a consolidation) are paired as a group.
	const groups = new Map<string, TransferCandidate[]>();
	for (const c of candidates) {
		const hash = normalizeTxHash(c.row.hash);
		if (!hash || !c.row.asset) continue;
		const key = `${hash}\u0000${c.row.asset}`;
		const list = groups.get(key) ?? [];
		list.push(c);
		groups.set(key, list);
	}
	const grouped = new Set<string>();
	for (const group of groups.values()) {
		const outs = group.filter((c) => c.row.direction === 'out').length;
		const ins = group.length - outs;
		if (outs < 1 || ins < 1 || (outs === 1 && ins === 1)) continue;
		if (new Set(group.map((c) => c.row.id)).size !== group.length) continue;
		const { moves, used } = splitMoves(group, ownerIndex);
		events.push(...moves);
		for (const c of group) {
			grouped.add(c.row.id);
			if (used.has(c.row.id)) paired.add(c.row.id);
		}
	}

	for (const link of links) {
		if (grouped.has(link.outId) || grouped.has(link.inId)) continue;
		const out = byId.get(link.outId);
		const inn = byId.get(link.inId);
		if (!out || !inn) continue;
		paired.add(link.outId);
		paired.add(link.inId);
		events.push({
			kind: 'move',
			id: `${link.outId}>${link.inId}`,
			asset: link.asset,
			fromWallet: link.outWallet,
			toWallet: link.inWallet,
			outAt: link.outAt,
			inAt: link.inAt,
			qtyOut: link.qtyOut,
			qtyIn: link.qtyIn,
			link: link.link,
			ownersDiffer: link.ownersDiffer,
			outRef: out.sourceRef,
			inRef: inn.sourceRef,
			...(out.manualBasis ? { manualBasis: out.manualBasis } : {}),
		});
	}
	for (const c of candidates) {
		if (paired.has(c.row.id)) continue;
		const e = unpairedEvent(c);
		if (e) events.push(e);
	}
	return { events, links };
}
