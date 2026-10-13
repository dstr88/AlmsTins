// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — Global FIFO lot matching
//
// 1. Builds tax_lots from all buy / income / airdrop / swap-in events across
//    ALL sources (exchanges + on-chain wallets).  Lots are sorted oldest-first.
//
// 2. For each disposal (sell / swap-out / liquidation / burn / nft-sale)
//    consumes lots in FIFO order, computing:
//      - cost basis (from the lot)
//      - proceeds (from the disposal)
//      - gain / loss
//      - short-term flag: IRS "more than 1 year" = calendar month comparison
//        (not a fixed 365-day window, which is wrong in leap years and on the
//        exact 12-month boundary).
//
// Two-row CEX swaps (e.g. Coinbase "Convert"):
//   direction='out' row  → disposal of the sold asset
//   direction='in'  row  → acquisition lot for the received asset
// Both are classified as 'swap' by pass1; buildAcquisitions and buildDisposals
// filter on direction to ensure each leg goes to exactly one side.
//
// Returns arrays of TaxLot and TaxDisposal ready for DB insert.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { TaxLot, TaxDisposal, ClassificationResult, RawImportTx, RawOnchainTx } from './types';

const taxYear = (ts: string) => new Date(ts).getUTCFullYear();

/**
 * IRS-correct short-term/long-term determination.
 *
 * The IRS rule is "more than 1 year" (calendar months), NOT "more than 365 days".
 * A disposal that occurs exactly 12 calendar months after acquisition is still
 * short-term — you need to be one day past the 12-month mark for long-term.
 *
 * Examples:
 *   Acquired Jan 1 2023, disposed Jan 1 2024  → exactly 12 months → short-term
 *   Acquired Jan 1 2023, disposed Jan 2 2024  → more than 12 months → long-term
 *   Acquired Jan 1 2024 (leap year), disposed Jan 1 2025 → exactly 12 months → short-term
 *   Acquired Jan 1 2024, disposed Jan 2 2025  → more than 12 months → long-term
 */
function isShortTermHold(acquiredAt: string, disposedAt: string): boolean {
	const acq  = new Date(acquiredAt);
	const disp = new Date(disposedAt);
	const oneYearLater = new Date(acq);
	oneYearLater.setUTCFullYear(acq.getUTCFullYear() + 1);
	// Held exactly 12 months or less → short-term; strictly after → long-term
	return disp <= oneYearLater;
}

type AcquisitionTx = {
	id: string;
	sourceType: 'import' | 'onchain';
	timestamp: string;
	assetSymbol: string;
	quantity: number;
	pricePerUnit: number | null;
	costBasisUsd: number | null;
	lotType: TaxLot['lotType'];
};

type DisposalTx = {
	id: string;
	sourceType: 'import' | 'onchain';
	timestamp: string;
	assetSymbol: string;
	quantity: number;
	proceedsUsd: number | null;
	category: TaxDisposal['category'];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCategory(classifications: Map<string, ClassificationResult>, key: string) {
	return classifications.get(key)?.category ?? 'unknown';
}

function importKey(id: string) { return `import:${id}`; }
function onchainKey(id: string) { return `onchain:${id}`; }

// ── Build acquisition rows ────────────────────────────────────────────────────

function buildAcquisitions(
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	classifications: Map<string, ClassificationResult>,
): AcquisitionTx[] {
	const acqs: AcquisitionTx[] = [];

	for (const row of importRows) {
		const cat = getCategory(classifications, importKey(row.id));

		// Two-row CEX swap: the incoming leg (direction='in', category='swap') is the
		// received asset and should create an acquisition lot just like a buy.
		// The outgoing leg (direction='out') is handled in buildDisposals.
		const isSwapIn = cat === 'swap' && row.direction === 'in';

		// Loan-proceeds: tokens received from a DeFi borrow (Aave, Compound, etc.).
		// The borrow itself is not taxable, but the borrowed tokens ARE property — if
		// you later sell or swap them, that disposal needs a cost basis.  FMV at the
		// time the loan proceeds hit the wallet is the correct basis (IRC § 1012).
		const isLoanIn = cat === 'loan-proceeds' && row.direction === 'in';

		// Unmatched transfer-in WITH a known price: tokens received from a source
		// outside the tracked import universe (e.g. Binance, a second hardware wallet).
		// The transfer itself is not taxable, but if no other lot exists for this asset
		// (because the purchase was never imported) we need a lot here so that future
		// disposals can match against something rather than landing as "unmatched".
		// We only create the lot when native_usd is non-null — silent null-price
		// transfers are flagged for review by pass5 instead (see missing_cost_basis).
		//
		// Exclusions:
		//   • Fiat symbols (USD, EUR, etc.) — never belong in the crypto lot pool
		//   • crypto_earn_program_withdrawn — principal returning from Crypto.com Earn;
		//     the original purchase lot already exists, creating another here
		//     would double-count and inflate cost basis.
		const FIAT_SYMBOLS = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
		const isUnmatchedTransferIn = cat === 'transfer'
			&& row.direction === 'in'
			&& row.native_usd !== null
			&& !!row.asset_symbol
			&& !FIAT_SYMBOLS.has(row.asset_symbol.toUpperCase())
			&& row.kind !== 'crypto_earn_program_withdrawn';

		if (cat !== 'buy' && cat !== 'income' && cat !== 'airdrop'
			&& !isSwapIn && !isLoanIn && !isUnmatchedTransferIn) continue;

		// asset_symbol is the only symbol field on RawImportTx.
		const symbol = row.asset_symbol;
		if (!symbol) continue;

		// Never put fiat currencies in the crypto lot pool — USD/EUR/etc. are not
		// capital assets and should not appear on Form 8949.
		const FIAT_LOT_SYMBOLS = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);
		if (FIAT_LOT_SYMBOLS.has(symbol.toUpperCase())) continue;

		// For buys/swap-in: quantity is what was received.
		// If to_amount is set it overrides amount (some CEX export the received qty there).
		const qty = row.to_amount !== null ? Math.abs(row.to_amount) : (row.amount !== null ? Math.abs(row.amount) : null);
		if (!qty) continue;

		// Cost basis = FMV at time of acquisition (native_usd).
		// For swap-in rows this is the FMV of the received tokens at the swap date —
		// the correct cost basis for future disposals of those tokens.
		// For loan-proceeds: FMV at borrow time = correct basis under IRC § 1012.
		const totalCost = row.native_usd !== null ? Math.abs(row.native_usd) : null;
		const ppu = totalCost !== null && qty > 0 ? totalCost / qty : null;

		acqs.push({
			id: row.id,
			sourceType: 'import',
			timestamp: row.timestamp_utc,
			assetSymbol: symbol.toUpperCase(),
			quantity: qty,
			pricePerUnit: ppu,
			costBasisUsd: totalCost,
			lotType: cat === 'income' ? 'income'
				: cat === 'airdrop' ? 'airdrop'
				: (isUnmatchedTransferIn || isLoanIn) ? 'transfer'
				: 'purchase',
		});
	}

	for (const row of onchainRows) {
		const cat = getCategory(classifications, onchainKey(row.id));
		if (cat !== 'buy' && cat !== 'income' && cat !== 'airdrop') continue;

		const symbol = row.token_symbol;
		if (!symbol) continue;

		const raw = row.value ?? '0';
		const qty = Math.abs(parseFloat(raw) || 0);
		if (!qty) continue;

		const totalCost = row.usd_value !== null ? Math.abs(row.usd_value ?? 0) : null;
		const ppu = totalCost !== null && qty > 0 ? totalCost / qty : null;

		acqs.push({
			id: row.id,
			sourceType: 'onchain',
			timestamp: row.timestamp,
			assetSymbol: symbol.toUpperCase(),
			quantity: qty,
			pricePerUnit: ppu,
			costBasisUsd: totalCost,
			lotType: cat === 'buy' ? 'purchase' : cat === 'income' ? 'income' : 'airdrop',
		});
	}

	return acqs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ── Build disposal rows ───────────────────────────────────────────────────────

function buildDisposals(
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	classifications: Map<string, ClassificationResult>,
): DisposalTx[] {
	const disposals: DisposalTx[] = [];
	const disposalCats = new Set(['sell', 'swap', 'liquidation', 'burn', 'lost', 'nft-sale']);

	for (const row of importRows) {
		const cat = getCategory(classifications, importKey(row.id));
		if (!disposalCats.has(cat)) continue;

		// Two-row CEX swap: the incoming leg is handled in buildAcquisitions.
		// Skip it here so a single swap doesn't create both a disposal AND a
		// spurious second disposal from the received side.
		if (cat === 'swap' && row.direction === 'in') continue;

		const symbol = row.asset_symbol;
		if (!symbol) continue;

		const qty = row.amount !== null ? Math.abs(row.amount) : null;
		if (!qty) continue;

		disposals.push({
			id: row.id,
			sourceType: 'import',
			timestamp: row.timestamp_utc,
			assetSymbol: symbol.toUpperCase(),
			quantity: qty,
			proceedsUsd: row.native_usd !== null ? Math.abs(row.native_usd) : null,
			category: cat as DisposalTx['category'],
		});
	}

	for (const row of onchainRows) {
		const cat = getCategory(classifications, onchainKey(row.id));
		if (!disposalCats.has(cat)) continue;

		const symbol = row.token_symbol;
		if (!symbol) continue;

		const raw = row.value ?? '0';
		const qty = Math.abs(parseFloat(raw) || 0);
		if (!qty) continue;

		disposals.push({
			id: row.id,
			sourceType: 'onchain',
			timestamp: row.timestamp,
			assetSymbol: symbol.toUpperCase(),
			quantity: qty,
			proceedsUsd: row.usd_value !== null ? Math.abs(row.usd_value ?? 0) : null,
			category: cat as DisposalTx['category'],
		});
	}

	return disposals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ── FIFO matching ─────────────────────────────────────────────────────────────

export function runFifo(
	tenantId: string,
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	classifications: Map<string, ClassificationResult>,
): { lots: TaxLot[]; disposals: TaxDisposal[] } {
	const acqs = buildAcquisitions(importRows, onchainRows, classifications);
	const disps = buildDisposals(importRows, onchainRows, classifications);

	// Build lot pool keyed by asset symbol
	const lotPool = new Map<string, TaxLot[]>();

	const allLots: TaxLot[] = acqs.map((acq) => ({
		id: randomUUID(),
		assetSymbol: acq.assetSymbol,
		acquiredAt: acq.timestamp,
		quantity: acq.quantity,
		remainingQty: acq.quantity,
		costBasisUsd: acq.costBasisUsd,
		pricePerUnit: acq.pricePerUnit,
		sourceType: acq.sourceType,
		sourceId: acq.id,
		lotType: acq.lotType,
		originLotId: null,
	}));

	for (const lot of allLots) {
		const pool = lotPool.get(lot.assetSymbol) ?? [];
		pool.push(lot);
		lotPool.set(lot.assetSymbol, pool);
	}

	const allDisposals: TaxDisposal[] = [];

	for (const disp of disps) {
		const pool = lotPool.get(disp.assetSymbol);
		if (!pool?.length) {
			// No lots found — record a disposal with null cost basis for review
			allDisposals.push({
				id: randomUUID(),
				assetSymbol: disp.assetSymbol,
				disposedAt: disp.timestamp,
				quantity: disp.quantity,
				proceedsUsd: disp.proceedsUsd,
				costBasisUsd: null,
				gainLossUsd: null,
				isShortTerm: false,
				category: disp.category,
				sourceType: disp.sourceType,
				sourceId: disp.id,
				lotId: 'unmatched',
				notes: 'No acquisition lot found — cost basis needs manual entry.',
			});
			continue;
		}

		let remaining = disp.quantity;

		// Use epsilon to guard against floating-point dust (e.g. 1e-14 remaining
		// after consuming several lot slices). Without this, a phantom near-zero
		// quantity triggers a spurious "No acquisition lot found" disposal row,
		// which pollutes the review queue and inflates the completeness score.
		const EPSILON = 1e-10;

		while (remaining > EPSILON && pool.length > 0) {
			const lot = pool[0];
			const consume = Math.min(remaining, lot.remainingQty);
			const fraction = consume / lot.quantity;
			const costSlice = lot.costBasisUsd !== null ? lot.costBasisUsd * fraction : null;
			const proceedsSlice = disp.proceedsUsd !== null ? (consume / disp.quantity) * disp.proceedsUsd : null;
			const gainLoss =
				proceedsSlice !== null && costSlice !== null ? proceedsSlice - costSlice : null;

			// IRS calendar-month holding period (see isShortTermHold above).
			const isShortTerm = isShortTermHold(lot.acquiredAt, disp.timestamp);

			allDisposals.push({
				id: randomUUID(),
				assetSymbol: disp.assetSymbol,
				disposedAt: disp.timestamp,
				quantity: consume,
				proceedsUsd: proceedsSlice,
				costBasisUsd: costSlice,
				gainLossUsd: gainLoss,
				isShortTerm,
				category: disp.category,
				sourceType: disp.sourceType,
				sourceId: disp.id,
				lotId: lot.id,
				notes: null,
			});

			lot.remainingQty -= consume;
			remaining -= consume;

			if (lot.remainingQty <= 0) {
				pool.shift();
				lot.isExhausted = true;  // now typed on TaxLot
			}
		}
	}

	// Final exhaustion pass (catches lots that hit exactly zero during the loop)
	for (const lot of allLots) {
		if (lot.remainingQty <= 0) lot.isExhausted = true;
	}

	// ── Invariant assertions ──────────────────────────────────────────────────
	// Verify the FIFO math produced internally consistent results.
	// Violations are warnings only — they don't block the write, but they
	// indicate a logic bug that needs investigation.

	const GLOBAL_EPSILON = 1e-10;

	// 1. No lot should have drifted below zero remaining quantity
	for (const lot of allLots) {
		if (lot.remainingQty < -GLOBAL_EPSILON) {
			console.warn(
				`[runFifo] INVARIANT VIOLATION: lot ${lot.id} (${lot.assetSymbol}) ` +
				`has negative remainingQty ${lot.remainingQty.toExponential(4)} — possible double-consumption`,
			);
		}
	}

	// 2. For each matched disposal source, slices should sum ≈ original quantity
	const slicesBySource = new Map<string, number>();
	for (const d of allDisposals) {
		if (d.lotId !== 'unmatched') {
			slicesBySource.set(d.sourceId, (slicesBySource.get(d.sourceId) ?? 0) + d.quantity);
		}
	}
	for (const disp of disps) {
		const totalConsumed = slicesBySource.get(disp.id) ?? 0;
		const isUnmatched = allDisposals.some(
			(d) => d.sourceId === disp.id && d.lotId === 'unmatched',
		);
		if (!isUnmatched && Math.abs(totalConsumed - disp.quantity) > GLOBAL_EPSILON) {
			console.warn(
				`[runFifo] INVARIANT VIOLATION: disposal ${disp.id} (${disp.assetSymbol}) ` +
				`quantity ${disp.quantity} but slices sum to ${totalConsumed} — ` +
				`diff ${Math.abs(totalConsumed - disp.quantity).toExponential(4)}`,
			);
		}
	}

	return { lots: allLots, disposals: allDisposals };
}
