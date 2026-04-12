// ─────────────────────────────────────────────────────────────────────────────
// Pass 3 — Income & interest classification
//
// Handles anything still unclassified after passes 1 and 2 that looks like:
//   • Ordinary income (staking, rewards, earn programs, yield)
//   • Airdrops
//   • Loan interest paid to protocols
//
// Also flags unpriced income events for review.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ReviewItem, RawImportTx, RawOnchainTx } from './types';
import { INCOME_KEYWORDS, LOAN_INTEREST_KEYWORDS } from './constants';

const taxYear = (ts: string) => {
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

function matchesKeywords(text: string, keywords: string[]): boolean {
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw));
}

// ── Import transactions ───────────────────────────────────────────────────────

export function classifyIncomePass3(
	importRows: RawImportTx[],
	alreadyClassified: Set<string>,
): { results: ClassificationResult[]; reviewItems: ReviewItem[] } {
	const results: ClassificationResult[] = [];
	const reviewItems: ReviewItem[] = [];

	for (const row of importRows) {
		const key = `import:${row.id}`;
		if (alreadyClassified.has(key)) continue;

		// Only look at inbound rows — outbound are handled in other passes
		if (row.direction !== 'in') continue;

		const kind = row.kind ?? '';
		const notes = row.notes ?? '';
		const combinedText = `${kind} ${notes}`;

		// Airdrop keyword check first
		if (matchesKeywords(combinedText, ['airdrop'])) {
			const result: ClassificationResult = {
				sourceType: 'import',
				sourceId: row.id,
				category: 'airdrop',
				confidence: 0.85,
				assetSymbol: row.asset_symbol,
				amountUsd: row.native_usd,
				taxYear: taxYear(row.timestamp_utc),
			};
			results.push(result);

			if (!row.native_usd) {
				reviewItems.push({
					sourceType: 'import',
					sourceId: row.id,
					reason: 'airdrop_unpriced',
					reasonDetail: `Airdrop of ${row.asset_symbol ?? 'tokens'} on ${row.timestamp_utc.slice(0, 10)} has no USD value. This is ordinary income — enter the fair market value at the time of receipt.`,
					snapshotJson: JSON.stringify({ symbol: row.asset_symbol, timestamp: row.timestamp_utc, kind }),
				});
			}
			continue;
		}

		// Loan interest paid — checked BEFORE income keywords because "interest paid"
		// is a substring match for "interest" which appears in INCOME_KEYWORDS
		if (matchesKeywords(combinedText, LOAN_INTEREST_KEYWORDS)) {
			results.push({
				sourceType: 'import',
				sourceId: row.id,
				category: 'loan-interest-paid',
				confidence: 0.8,
				assetSymbol: row.asset_symbol,
				amountUsd: row.native_usd,
				taxYear: taxYear(row.timestamp_utc),
			});
			continue;
		}

		// Income keyword check
		if (matchesKeywords(combinedText, INCOME_KEYWORDS)) {
			results.push({
				sourceType: 'import',
				sourceId: row.id,
				category: 'income',
				subCategory: kind.toLowerCase().replace(/\s+/g, '-') || 'reward',
				confidence: 0.8,
				assetSymbol: row.asset_symbol,
				amountUsd: row.native_usd,
				taxYear: taxYear(row.timestamp_utc),
			});
			continue;
		}
	}

	return { results, reviewItems };
}

// ── On-chain transactions (gas fee separation) ────────────────────────────────

export function classifyFeesPass3(
	onchainRows: RawOnchainTx[],
	alreadyClassified: Set<string>,
): ClassificationResult[] {
	const results: ClassificationResult[] = [];

	for (const row of onchainRows) {
		const key = `onchain:${row.id}`;
		if (alreadyClassified.has(key)) continue;

		// Transactions where value is purely a gas/fee payment (value=0, non-token)
		if (row.tx_type === 'fee' || row.tx_type === 'gas') {
			results.push({
				sourceType: 'onchain',
				sourceId: row.id,
				category: 'fee',
				confidence: 0.9,
				assetSymbol: row.token_symbol ?? 'ETH',
				amountUsd: row.usd_value,
				taxYear: new Date(row.timestamp).getUTCFullYear(),
			});
		}
	}

	return results;
}
