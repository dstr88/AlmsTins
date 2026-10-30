/**
 * openingPositions.ts: the January 1, 2025 positions the ledger reconstructed, shaped for the
 * owner's Opening positions page and API. Pure: no database.
 *
 * For each coin the ledger placed the cost basis left at the end of 2024 in the wallets and
 * accounts that held the units. This lists, per coin and wallet, the units and cost, which of
 * the lots are in it and how each got there (the wallet it was bought in, a wallet that
 * received it from there, a placeholder with no basis, or the owner's own allocation), and
 * which coins need a look: the ones with a gap, and the ones whose saved allocation was refused.
 */

import { UNALLOCATED_WALLET, type Jan1Asset, type LedgerFinding, type LedgerResult } from './lotLedger';
import { walletDisplayOf } from './eventWallet';
import type { StoredAllocation } from './allocationOverride';

export interface OpeningLot {
	acquiredAt: string;
	qty: number;
	costUsd: number | null;
	basisSource: string;
	/** origin | fill | override | placeholder | unallocated (lotLedger.ts LotAllocation). */
	pass: string;
}

export interface OpeningWallet {
	walletKey: string;
	walletDisplay: string | null;
	units: number;
	costUsd: number | null;
	lots: OpeningLot[];
}

export interface OpeningUnusedLot {
	walletKey: string;
	walletDisplay: string | null;
	acquiredAt: string;
	qty: number;
	costUsd: number | null;
}

export interface OpeningGap {
	/** jan1_position_gap | allocation_override_rejected */
	reason: string;
	/** negative_balance | units_without_basis | basis_without_units | duplicate_asset | units_mismatch | ... (a code, never user text) */
	detail: string | null;
	walletKey: string | null;
	walletDisplay: string | null;
	qty: number | null;
	costUsd: number | null;
}

export interface OpeningAsset {
	asset: string;
	/** 'reconstruction' or 'override': what the positions below came from. */
	source: 'reconstruction' | 'override';
	overrideRejected: boolean;
	wallets: OpeningWallet[];
	/** The pooled lots left at the end of 2024, before they were placed. */
	unused: OpeningUnusedLot[];
	gaps: OpeningGap[];
	/** The allocation saved for this coin, if any (its rows, with the owner's notes). */
	savedAllocation: StoredAllocation['rows'] | null;
	/** Units and cost carried into 2025, summed over the wallets. */
	totalUnits: number;
	totalCostUsd: number | null;
}

export interface OpeningPositions {
	/** The boundary date. */
	from: string;
	assets: OpeningAsset[];
	/** Coins that needed the owner's attention: a gap, or an allocation that was refused. */
	needsReview: string[];
}

const REVIEW_REASONS = new Set(['jan1_position_gap', 'allocation_override_rejected']);
const walletKeyOrNull = (w: string | null): string | null => (w && w !== UNALLOCATED_WALLET ? w : null);
const sumCost = (xs: (number | null)[]): number | null => (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));

function gapOf(f: LedgerFinding): OpeningGap {
	const key = walletKeyOrNull(f.wallet);
	return { reason: f.reason, detail: f.detail, walletKey: key, walletDisplay: walletDisplayOf(key), qty: f.qty, costUsd: f.costUsd };
}

export function openingPositionsOf(result: LedgerResult, saved: readonly StoredAllocation[], from: string): OpeningPositions {
	const savedBy = new Map(saved.map((s) => [s.asset, s.rows]));
	const gapsBy = new Map<string, OpeningGap[]>();
	for (const f of result.findings) {
		if (!REVIEW_REASONS.has(f.reason)) continue;
		const list = gapsBy.get(f.asset) ?? [];
		list.push(gapOf(f));
		gapsBy.set(f.asset, list);
	}

	const byAsset = new Map<string, Jan1Asset>(result.jan1.map((j) => [j.asset, j]));
	const names = [...new Set([...byAsset.keys(), ...gapsBy.keys()])].sort();
	const assets: OpeningAsset[] = names.map((asset) => {
		const j = byAsset.get(asset);
		const wallets: OpeningWallet[] = (j?.positions ?? [])
			.filter((p) => p.wallet !== UNALLOCATED_WALLET)
			.map((p) => ({
				walletKey: p.wallet,
				walletDisplay: walletDisplayOf(p.wallet),
				units: p.units,
				costUsd: p.costUsd,
				lots: p.lots.map((l) => ({ acquiredAt: l.acquiredAt, qty: l.qty, costUsd: l.costUsd, basisSource: l.basisSource, pass: l.pass })),
			}));
		return {
			asset,
			source: j?.source ?? 'reconstruction',
			overrideRejected: j?.overrideRejected ?? (gapsBy.get(asset) ?? []).some((g) => g.reason === 'allocation_override_rejected'),
			wallets,
			unused: (j?.unused ?? []).map((u) => ({ walletKey: u.wallet, walletDisplay: walletDisplayOf(u.wallet), acquiredAt: u.acquiredAt, qty: u.qty, costUsd: u.costUsd })),
			gaps: gapsBy.get(asset) ?? [],
			savedAllocation: savedBy.get(asset) ?? null,
			totalUnits: wallets.reduce((a, w) => a + w.units, 0),
			totalCostUsd: sumCost(wallets.map((w) => w.costUsd)),
		};
	});
	return { from, assets, needsReview: assets.filter((a) => a.gaps.length > 0).map((a) => a.asset) };
}
