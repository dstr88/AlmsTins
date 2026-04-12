// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — Global FIFO lot matching
//
// 1. Builds tax_lots from all buy / income / airdrop events across ALL sources
//    (exchanges + on-chain wallets).  Lots are sorted oldest-first (FIFO).
//
// 2. For each disposal (sell / swap / liquidation / burn / nft-sale) consumes
//    lots in FIFO order, computing:
//      - cost basis (from the lot)
//      - proceeds (from the disposal)
//      - gain / loss
//      - short-term flag (held < 365 days)
//
// Returns arrays of TaxLot and TaxDisposal ready for DB insert.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { TaxLot, TaxDisposal, ClassificationResult, RawImportTx, RawOnchainTx } from './types';

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

const taxYear = (ts: string) => new Date(ts).getFullYear();

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
		if (cat !== 'buy' && cat !== 'income' && cat !== 'airdrop') continue;

		const symbol = row.asset_symbol ?? row.to_currency ?? row.currency;
		if (!symbol) continue;

		// For buys: quantity is what was received (to_amount if swap, else amount)
		const qty = row.to_amount !== null ? Math.abs(row.to_amount) : (row.amount !== null ? Math.abs(row.amount) : null);
		if (!qty) continue;

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
			lotType: cat === 'buy' ? 'purchase' : cat === 'income' ? 'income' : 'airdrop',
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

		const symbol = row.asset_symbol ?? row.currency;
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
		const dispMs = new Date(disp.timestamp).getTime();

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

			const acqMs = new Date(lot.acquiredAt).getTime();
			const isShortTerm = dispMs - acqMs < MS_PER_YEAR;

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
				lot.isExhausted = true;
			}
		}
	}

	// Mark exhausted lots
	for (const lot of allLots) {
		if (lot.remainingQty <= 0) (lot as any).isExhausted = true;
	}

	return { lots: allLots, disposals: allDisposals };
}
