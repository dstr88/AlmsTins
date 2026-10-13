// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 — Transfer matching + Loan detection
//
// Step A: Transfer matching
//   Looks for outgoing transfers paired with incoming transfers of the same
//   coin, similar amount, within the time window.  Matched pairs are marked
//   as 'transfer' and linked to each other.  Unmatched outgoing transfers are
//   added to the review queue.
//
// Step B: Loan detection
//   Incoming transactions from known lending protocol addresses are flagged as
//   'loan-proceeds' (high confidence) or 'possible_loan' (review queue).
//   Outgoing to lending protocols are flagged as 'collateral-deposit' or
//   'loan-repayment'.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ReviewItem, RawImportTx, RawOnchainTx, SourceType } from './types';
import {
	LENDING_PROTOCOL_ADDRESSES,
	TRANSFER_AMOUNT_TOLERANCE,
	TRANSFER_MATCH_WINDOW_MINUTES,
	TRANSFER_MATCH_WINDOW_CEX_MINUTES,
} from './constants';

type AnyTx = {
	id: string;
	sourceType: SourceType;
	timestamp: string;
	assetSymbol: string | null;
	amount: number | null;        // absolute value
	direction: 'in' | 'out';
	addressFrom?: string | null;
	addressTo?: string | null;
	usdValue?: number | null;
};

const toMs = (ts: string) => new Date(ts).getTime();

function toAnyTx(row: RawImportTx): AnyTx | null {
	const dir = (row.direction ?? '').toLowerCase();
	if (dir !== 'in' && dir !== 'out') return null;
	const qty = row.amount !== null ? Math.abs(row.amount) : null;
	if (!qty) return null;
	return {
		id: row.id,
		sourceType: 'import',
		timestamp: row.timestamp_utc,
		assetSymbol: row.asset_symbol,
		amount: qty,
		direction: dir as 'in' | 'out',
		usdValue: row.native_usd,
	};
}

function onchainDirection(row: RawOnchainTx, walletAddresses: Set<string>): 'in' | 'out' | null {
	const from = (row.from_address ?? '').toLowerCase();
	const to = (row.to_address ?? '').toLowerCase();
	if (walletAddresses.has(from)) return 'out';
	if (walletAddresses.has(to)) return 'in';
	return null;
}

function toAnyTxOnchain(row: RawOnchainTx, walletAddresses: Set<string>): AnyTx | null {
	const dir = onchainDirection(row, walletAddresses);
	if (!dir) return null;
	const rawVal = row.value ?? '0';
	const qty = parseFloat(rawVal) || 0;
	if (!qty) return null;
	return {
		id: row.id,
		sourceType: 'onchain',
		timestamp: row.timestamp,
		assetSymbol: row.token_symbol,
		amount: Math.abs(qty),
		direction: dir,
		addressFrom: row.from_address,
		addressTo: row.to_address,
		usdValue: row.usd_value,
	};
}

// ── Transfer matching ─────────────────────────────────────────────────────────

export function matchTransfers(
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	walletAddresses: Set<string>,
	alreadyClassified: Set<string>, // "sourceType:sourceId" keys
): { results: ClassificationResult[]; reviewItems: ReviewItem[] } {
	const results: ClassificationResult[] = [];
	const reviewItems: ReviewItem[] = [];

	// Build candidate pools — only unclassified 'send'/'receive'/'transfer' direction rows
	const isUnclassified = (key: string) => !alreadyClassified.has(key);

	const allTxs: AnyTx[] = [];

	for (const row of importRows) {
		const key = `import:${row.id}`;
		if (!isUnclassified(key)) continue;
		// Only look at rows that are clearly transfers (send/receive kind or
		// unclassified direction that could be a transfer)
		const kind = (row.kind ?? '').toLowerCase();
		const isPossibleTransfer =
			kind.includes('send') ||
			kind.includes('receive') ||
			kind.includes('withdrawal') ||
			kind.includes('deposit') ||
			kind.includes('transfer') ||
			(!row.kind && (row.direction === 'in' || row.direction === 'out'));
		if (!isPossibleTransfer) continue;
		const tx = toAnyTx(row);
		if (tx) allTxs.push(tx);
	}

	for (const row of onchainRows) {
		const key = `onchain:${row.id}`;
		if (!isUnclassified(key)) continue;
		const tx = toAnyTxOnchain(row, walletAddresses);
		if (tx) allTxs.push(tx);
	}

	const outgoing = allTxs.filter((t) => t.direction === 'out');
	const incoming = allTxs.filter((t) => t.direction === 'in');
	const matchedIds = new Set<string>();

	for (const out of outgoing) {
		if (!out.assetSymbol || !out.amount) continue;
		const outMs = toMs(out.timestamp);

		let bestMatch: AnyTx | null = null;
		let bestTimeDiff = Infinity;

		for (const inc of incoming) {
			if (matchedIds.has(inc.id)) continue;
			if (!inc.assetSymbol || !inc.amount) continue;
			if (inc.assetSymbol.toUpperCase() !== out.assetSymbol.toUpperCase()) continue;

			// Amount: incoming can be up to tolerance% less (gas / bridge fees)
			const ratio = inc.amount / out.amount;
			if (ratio > 1 + TRANSFER_AMOUNT_TOLERANCE || ratio < 1 - TRANSFER_AMOUNT_TOLERANCE) continue;

			const incMs = toMs(inc.timestamp);
			const diffMs = Math.abs(incMs - outMs);
			const diffMin = diffMs / 60_000;
			// Use a wider window when both sides are CEX imports — CSV timestamps
			// can be delayed by hours (e.g. LTC sent to Coinbase posts later).
			const windowMin =
				out.sourceType === 'import' && inc.sourceType === 'import'
					? TRANSFER_MATCH_WINDOW_CEX_MINUTES
					: TRANSFER_MATCH_WINDOW_MINUTES;
			if (diffMin > windowMin) continue;

			// Prefer the closest in time
			if (diffMs < bestTimeDiff) {
				bestTimeDiff = diffMs;
				bestMatch = inc;
			}
		}

		if (bestMatch) {
			matchedIds.add(out.id);
			matchedIds.add(bestMatch.id);

			results.push({
				sourceType: out.sourceType,
				sourceId: out.id,
				category: 'transfer',
				confidence: 0.85,
				linkedTxId: bestMatch.id,
				linkedSourceType: bestMatch.sourceType,
				assetSymbol: out.assetSymbol,
				amountUsd: out.usdValue,
				taxYear: new Date(out.timestamp).getUTCFullYear(),
			});
			results.push({
				sourceType: bestMatch.sourceType,
				sourceId: bestMatch.id,
				category: 'transfer',
				confidence: 0.85,
				linkedTxId: out.id,
				linkedSourceType: out.sourceType,
				assetSymbol: bestMatch.assetSymbol,
				amountUsd: bestMatch.usdValue,
				taxYear: new Date(bestMatch.timestamp).getUTCFullYear(),
			});
		} else {
			// Unmatched outgoing — needs review
			reviewItems.push({
				sourceType: out.sourceType,
				sourceId: out.id,
				reason: 'unmatched_transfer',
				reasonDetail: `Sent ${out.amount} ${out.assetSymbol ?? '?'} on ${out.timestamp.slice(0, 10)} — no matching incoming transfer found. Was this sent to another of your wallets, a gift, or a payment?`,
				snapshotJson: JSON.stringify({ amount: out.amount, symbol: out.assetSymbol, timestamp: out.timestamp }),
			});
		}
	}

	return { results, reviewItems };
}

// ── Loan detection ────────────────────────────────────────────────────────────

export function detectLoans(
	onchainRows: RawOnchainTx[],
	walletAddresses: Set<string>,
	alreadyClassified: Set<string>,
): { results: ClassificationResult[]; reviewItems: ReviewItem[] } {
	const results: ClassificationResult[] = [];
	const reviewItems: ReviewItem[] = [];

	for (const row of onchainRows) {
		const key = `onchain:${row.id}`;
		if (alreadyClassified.has(key)) continue;

		const from = (row.from_address ?? '').toLowerCase();
		const to = (row.to_address ?? '').toLowerCase();

		const fromIsLender = LENDING_PROTOCOL_ADDRESSES.has(from);
		const toIsLender = LENDING_PROTOCOL_ADDRESSES.has(to);

		if (!fromIsLender && !toIsLender) continue;

		const dir = onchainDirection(row, walletAddresses);
		if (!dir) continue;

		const year = new Date(row.timestamp).getUTCFullYear();

		if (dir === 'in' && fromIsLender) {
			// Money coming FROM a lending protocol → loan proceeds (or interest earned)
			// Use medium confidence because some protocols send interest, not just loans
			results.push({
				sourceType: 'onchain',
				sourceId: row.id,
				category: 'loan-proceeds',
				subCategory: 'aave',
				confidence: 0.75,
				assetSymbol: row.token_symbol,
				amountUsd: row.usd_value,
				taxYear: year,
			});
			// Also queue for review since we're not 100% certain
			reviewItems.push({
				sourceType: 'onchain',
				sourceId: row.id,
				reason: 'possible_loan',
				reasonDetail: `Received ${row.token_symbol ?? 'tokens'} from a lending protocol (${from.slice(0, 10)}…). Auto-classified as loan proceeds — borrowing is NOT a taxable event (you owe it back). Note: if you later swapped or sold these borrowed tokens, THAT disposal is a separate taxable event captured elsewhere. Correct this classification if it was interest earned (ordinary income) rather than a borrow.`,
				snapshotJson: JSON.stringify({ amount: row.value, symbol: row.token_symbol, timestamp: row.timestamp, from }),
			});
		} else if (dir === 'out' && toIsLender) {
			// Money going TO a lending protocol → collateral deposit or repayment
			results.push({
				sourceType: 'onchain',
				sourceId: row.id,
				category: 'collateral-deposit',
				subCategory: 'aave',
				confidence: 0.7,
				assetSymbol: row.token_symbol,
				amountUsd: row.usd_value,
				taxYear: year,
			});
			reviewItems.push({
				sourceType: 'onchain',
				sourceId: row.id,
				reason: 'possible_collateral_deposit',
				reasonDetail: `Sent ${row.token_symbol ?? 'tokens'} to a lending protocol (${to.slice(0, 10)}…). Auto-classified as collateral deposit or loan repayment — moving assets into Aave/Compound as collateral is NOT a taxable disposition (you still own them). Only a forced liquidation of your collateral would be taxable. Confirm below or correct if this was a different type of transaction.`,
				snapshotJson: JSON.stringify({ amount: row.value, symbol: row.token_symbol, timestamp: row.timestamp, to }),
			});
		}
	}

	return { results, reviewItems };
}
