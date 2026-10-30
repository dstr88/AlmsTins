// ─────────────────────────────────────────────────────────────────────────────
// Passes 1 to 3b, in memory: classify every import and on-chain row it can.
//
// The pipeline run (classify.ts) writes the result to the database; the live ledger
// (tax/computeLedger.ts) feeds it to the pipeline adapter. Pure: no database. Manual
// classifications (is_manual = 1) are locked in first and never overwritten.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, RawImportTx, RawOnchainTx, ReviewItem } from './types';
import { classifyImportTxPass1, classifyOnchainTxPass1 } from './pass1';
import { matchTransfers, detectLoans } from './pass2';
import { classifyIncomePass3, classifyFeesPass3 } from './pass3';
import { classifyDeFiPass3b } from './pass3b';

export interface ClassifyAllResult {
	/** Manual classifications plus everything the passes classified. */
	classifications: Map<string, ClassificationResult>;
	/** The keys that were classified (manual and automatic). */
	classifiedKeys: Set<string>;
	reviewItems: ReviewItem[];
	counts: {
		pass1Easy: number;
		/** Results of the transfer pass: two per matched pair. */
		pass2TransferResults: number;
		pass2bLoans: number;
		pass3Income: number;
		pass3Fees: number;
		pass3bDefi: number;
	};
}

export function classifyAll(
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	walletAddresses: Set<string>,
	manualOverrides: Map<string, ClassificationResult>,
): ClassifyAllResult {
	// Start with manual overrides already locked in
	const classifications = new Map<string, ClassificationResult>(manualOverrides);
	const classifiedKeys = new Set<string>(manualOverrides.keys());
	const reviewItems: ReviewItem[] = [];

	// ── Pass 1: Easy classifications ──────────────────────────────────────
	let pass1Count = 0;
	for (const row of importRows) {
		const key = `import:${row.id}`;
		if (classifiedKeys.has(key)) continue;
		const result = classifyImportTxPass1(row);
		if (result) { classifications.set(key, result); classifiedKeys.add(key); pass1Count++; }
	}
	for (const row of onchainRows) {
		const key = `onchain:${row.id}`;
		if (classifiedKeys.has(key)) continue;
		const result = classifyOnchainTxPass1(row);
		if (result) { classifications.set(key, result); classifiedKeys.add(key); pass1Count++; }
	}

	// ── Pass 2A: Transfer matching ─────────────────────────────────────────
	const { results: transferResults, reviewItems: transferReview } = matchTransfers(
		importRows, onchainRows, walletAddresses, classifiedKeys,
	);
	for (const r of transferResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	reviewItems.push(...transferReview);

	// ── Pass 2B: Loan detection ────────────────────────────────────────────
	const { results: loanResults, reviewItems: loanReview } = detectLoans(
		onchainRows, walletAddresses, classifiedKeys,
	);
	for (const r of loanResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	reviewItems.push(...loanReview);

	// ── Pass 3: Income & fees ──────────────────────────────────────────────
	const { results: incomeResults, reviewItems: incomeReview } = classifyIncomePass3(
		importRows, classifiedKeys,
	);
	for (const r of incomeResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	reviewItems.push(...incomeReview);

	const feeResults = classifyFeesPass3(onchainRows, classifiedKeys);
	for (const r of feeResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}

	// ── Pass 3b: DeFi event classification ────────────────────────────────
	const { results: defiResults, reviewItems: defiReview } = classifyDeFiPass3b(
		importRows, classifiedKeys,
	);
	for (const r of defiResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	reviewItems.push(...defiReview);

	return {
		classifications,
		classifiedKeys,
		reviewItems,
		counts: {
			pass1Easy: pass1Count,
			pass2TransferResults: transferResults.length,
			pass2bLoans: loanResults.length,
			pass3Income: incomeResults.length,
			pass3Fees: feeResults.length,
			pass3bDefi: defiResults.length,
		},
	};
}
