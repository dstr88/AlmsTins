// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — Lot matching
//
// The pipeline classifies every row (passes 1 to 3b); this pass turns the classified rows into
// ledger events (tax/ledgerAdapters/pipeline.ts) and runs them through the ledger core
// (tax/lotLedger.ts), the same core the lifecycle engine uses. It then maps the core's lots and
// sale slices to the tax_lots and tax_disposals rows the pipeline persists.
//
//   - buy / income / airdrop / swap-in / loan proceeds open a lot.
//   - sell / swap-out / liquidation / burn / lost / nft-sale consume lots, oldest first (or by the
//     method), computing cost basis, proceeds, gain and the holding period by calendar date
//     (yearEnd/holdingPeriod.ts), not a fixed 365-day window.
//   - a transfer between the owner's own wallets or accounts is a MOVE: no disposal, no new lot.
//     A lot's date and cost stay with it. An explicit send nothing was found for consumes the
//     coins and is listed for review; it is not a sale.
//   - from 2025-01-01 (tenants in the per-wallet rollout, tax/basisMethod.ts) a sale takes lots only from the
//     wallet or account it was made from, oldest first; earlier years use one pool per coin.
//   - a sale the lots cannot cover becomes a disposal with lotId 'unmatched' for the rest, so no
//     part of a sale is ever dropped, and a sale never consumes a lot acquired after it.
//
// Two-row CEX swaps (e.g. Coinbase "Convert"): the direction='out' row is the disposal of the sold
// asset and the direction='in' row is the acquisition of the received one.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { TaxLot, TaxDisposal, ClassificationResult, RawImportTx, RawOnchainTx, TaxCategory } from './types';
import type { OwnerIndex } from '../walletIdentity';
import { EPSILON, runLotLedger, type AllocationOverride, type CostBasisMethod, type LedgerFinding, type LedgerResult, type LotOrigin } from '../tax/lotLedger';
import { pipelineToLedger, type PipelineAdapterInput } from '../tax/ledgerAdapters/pipeline';
import type { RefInfo } from '../tax/ledgerAdapters/shared';

/** What the pipeline reads besides its rows to tell a transfer from a sale. Every field is optional: a bare call reads rows by their own columns. */
export type FifoContext = Partial<Pick<PipelineAdapterInput, 'manualKeys' | 'wallets' | 'walletIdByTxHash' | 'transferMatches' | 'ownerIndex' | 'manualBasis'>> & {
	method?: CostBasisMethod;
	lotPins?: Map<string, { acquiredAt: string; amountHint: number }>;
	/** The UTC date from which each wallet has its own pool (tax/basisMethod.ts PER_WALLET_FROM), or null/omitted for one pool in every year. */
	perWalletFrom?: string | null;
	/** The owner's own January 1 allocations; they apply only with perWalletFrom. */
	allocationOverrides?: readonly AllocationOverride[];
};

const NO_OWNERS: OwnerIndex = { byKey: new Map(), byAddress: new Map() };

const LOT_TYPE: Record<LotOrigin, TaxLot['lotType']> = {
	purchase: 'purchase',
	income: 'income',
	airdrop: 'airdrop',
	swap_in: 'purchase',
	loan_proceeds: 'transfer',
	transfer_in_untracked: 'transfer',
	transfer_surplus: 'transfer',
	jan1_placeholder: 'purchase',
	other: 'purchase',
};

const sourceTypeOf = (info: RefInfo | undefined): TaxLot['sourceType'] => (info?.sourceType === 'onchain' ? 'onchain' : 'import');

/** The ledger's lots and sale slices as the rows the pipeline persists. */
export function ledgerToTaxRows(result: LedgerResult, refs: ReadonlyMap<string, RefInfo>): { lots: TaxLot[]; disposals: TaxDisposal[] } {
	const lotIds = new Map<string, string>();
	for (const l of result.lots) lotIds.set(l.id, randomUUID());

	const lots: TaxLot[] = result.lots.map((l) => {
		const info = refs.get(l.sourceRef);
		const remaining = l.remainingQty > EPSILON ? l.remainingQty : 0;
		return {
			id: lotIds.get(l.id) as string,
			assetSymbol: l.asset,
			acquiredAt: l.acquiredAt,
			quantity: l.qty,
			remainingQty: remaining,
			costBasisUsd: l.costUsd,
			pricePerUnit: l.costUsd !== null && l.qty > 0 ? l.costUsd / l.qty : null,
			sourceType: sourceTypeOf(info),
			sourceId: info?.sourceId ?? l.sourceRef,
			lotType: LOT_TYPE[l.origin] ?? 'purchase',
			originLotId: l.originLotId ? lotIds.get(l.originLotId) ?? null : null,
			// Set only once a lot is used up; a lot with units left carries no flag.
			...(remaining <= 0 ? { isExhausted: true } : {}),
		};
	});

	const disposals: TaxDisposal[] = [];
	for (const s of result.slices) {
		// Units an unmatched send consumed are not a disposal.
		if (!s.taxable) continue;
		const info = refs.get(s.sourceRef);
		disposals.push({
			id: randomUUID(),
			assetSymbol: s.asset,
			disposedAt: s.disposedAt,
			quantity: s.qty,
			proceedsUsd: s.proceeds,
			costBasisUsd: s.cost,
			gainLossUsd: s.gain,
			isShortTerm: s.term === 'short',
			category: s.category as TaxCategory,
			sourceType: sourceTypeOf(info),
			sourceId: info?.sourceId ?? s.sourceRef,
			lotId: s.lotId ? lotIds.get(s.lotId) ?? 'unmatched' : 'manual',
			notes: s.basisSource === 'manual' ? s.originNote : null,
		});
	}
	for (const u of result.unmatched) {
		if (!u.taxable) continue;
		const info = refs.get(u.sourceRef);
		disposals.push({
			id: randomUUID(),
			assetSymbol: u.asset,
			disposedAt: u.at,
			quantity: u.qty,
			proceedsUsd: u.proceeds,
			costBasisUsd: null,
			gainLossUsd: null,
			isShortTerm: false,
			category: u.category as TaxCategory,
			sourceType: sourceTypeOf(info),
			sourceId: info?.sourceId ?? u.sourceRef,
			lotId: 'unmatched',
			notes: 'No acquisition lot found — cost basis needs manual entry.',
		});
	}
	disposals.sort((a, b) => a.disposedAt.localeCompare(b.disposedAt) || a.sourceId.localeCompare(b.sourceId));
	return { lots, disposals };
}

export function runFifo(
	_tenantId: string,
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	classifications: Map<string, ClassificationResult>,
	context: FifoContext = {},
): { lots: TaxLot[]; disposals: TaxDisposal[]; findings: LedgerFinding[] } {
	const { events, refs } = pipelineToLedger({
		importRows,
		onchainRows,
		classifications,
		manualKeys: context.manualKeys,
		wallets: context.wallets,
		walletIdByTxHash: context.walletIdByTxHash,
		transferMatches: context.transferMatches,
		ownerIndex: context.ownerIndex ?? NO_OWNERS,
		manualBasis: context.manualBasis,
	});
	const result = runLotLedger(events, {
		perWalletFrom: context.perWalletFrom ?? null,
		allocationOverrides: context.allocationOverrides,
		method: context.method,
		lotPins: context.lotPins,
	});
	return { ...ledgerToTaxRows(result, refs), findings: result.findings };
}
