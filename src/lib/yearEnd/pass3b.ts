// ─────────────────────────────────────────────────────────────────────────────
// Pass 3b — DeFi event classification
//
// Handles transactions that look like DeFi-specific events not caught by the
// earlier passes.  These are fundamentally different from simple buys/sells
// because the IRS guidance is either absent or unsettled:
//
//   • LP deposits / withdrawals — depositing tokens into Uniswap/Curve/etc.
//     may be a taxable swap at the time of deposit.  We flag for review.
//
//   • Wrapped token swaps — wBTC→BTC, stETH→ETH, WETH→ETH conversions are
//     property exchanges and may realise a taxable gain.  IRS Rev. Rul. 2023-14
//     clarified staking but not wrapping.  Flag for review.
//
//   • Rebase income — tokens like OHM and AMPL increase holder balances via
//     rebasing.  Each positive rebase is treated as ordinary income at FMV by
//     most practitioners (same logic as staking rewards).
//
//   • Perpetual / margin funding rate payments — periodic payments between longs
//     and shorts.  Positive = income, negative = expense.
//
// Runs AFTER pass3 so that general keyword income detectors have already fired.
// Only unclassified rows are processed.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ReviewItem, RawImportTx } from './types';
import {
	DEFI_LP_KEYWORDS,
	WRAPPED_TOKEN_MAP,
	REBASE_TOKEN_SYMBOLS,
	DEFI_FUNDING_KEYWORDS,
} from './constants';

function matchesAny(text: string, keywords: string[]): boolean {
	const lower = text.toLowerCase();
	return keywords.some((kw) => lower.includes(kw));
}

const taxYear = (ts: string) => {
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

export function classifyDeFiPass3b(
	importRows: RawImportTx[],
	alreadyClassified: Set<string>,
): { results: ClassificationResult[]; reviewItems: ReviewItem[] } {
	const results: ClassificationResult[] = [];
	const reviewItems: ReviewItem[] = [];

	for (const row of importRows) {
		const key = `import:${row.id}`;
		if (alreadyClassified.has(key)) continue;

		const kind         = row.kind  ?? '';
		const notes        = row.notes ?? '';
		const combinedText = `${kind} ${notes}`;
		const symbol       = (row.asset_symbol ?? '').toUpperCase();

		// ── 1. Rebase income ─────────────────────────────────────────────────
		// Positive rebases increase your balance.  Common on OHM/AMPL platforms.
		// The inbound row is ordinary income at FMV, similar to staking rewards,
		// but the protocol-specific accounting differs — flag for confirmation.
		if (row.direction === 'in' && REBASE_TOKEN_SYMBOLS.has(symbol)) {
			results.push({
				sourceType:  'import',
				sourceId:    row.id,
				category:    'rebase-income',
				subCategory: symbol.toLowerCase(),
				confidence:  0.75,
				assetSymbol: row.asset_symbol,
				amountUsd:   row.native_usd,
				taxYear:     taxYear(row.timestamp_utc),
			});
			if (!row.native_usd) {
				reviewItems.push({
					sourceType:    'import',
					sourceId:      row.id,
					reason:        'rebase_income_unpriced',
					reasonDetail:  `Rebase income for ${symbol} is missing a USD value. Each positive rebase is likely ordinary income at fair market value at the time of receipt.`,
					snapshotJson:  JSON.stringify({ symbol, timestamp: row.timestamp_utc, kind }),
				});
			}
			continue;
		}

		// ── 2. LP deposit / withdrawal ────────────────────────────────────────
		// Depositing ETH+USDC into Uniswap is potentially a taxable swap (each
		// token deposited at current FMV).  Withdrawing is similarly ambiguous.
		// We classify and send to review — the user must confirm whether a
		// taxable event occurred.
		if (matchesAny(combinedText, DEFI_LP_KEYWORDS)) {
			const category = row.direction === 'out' ? 'lp-deposit' : 'lp-withdrawal';
			results.push({
				sourceType:  'import',
				sourceId:    row.id,
				category,
				confidence:  0.7,
				assetSymbol: row.asset_symbol,
				amountUsd:   row.native_usd,
				taxYear:     taxYear(row.timestamp_utc),
			});
			reviewItems.push({
				sourceType:   'import',
				sourceId:     row.id,
				reason:       'possible_lp_event',
				reasonDetail: `${category === 'lp-deposit' ? 'Depositing into' : 'Withdrawing from'} a liquidity pool may be a taxable swap event. The IRS has not issued specific guidance. Review this transaction with your tax advisor.`,
				snapshotJson: JSON.stringify({ symbol, timestamp: row.timestamp_utc, kind }),
			});
			continue;
		}

		// ── 3. Wrapped token swap ─────────────────────────────────────────────
		// Converting wBTC→BTC, stETH→ETH, CBETH→ETH, etc. is an exchange of
		// property and may realise a capital gain/loss.  IRS guidance is unsettled.
		// Flag all wrap/unwrap transactions for advisor review.
		if (WRAPPED_TOKEN_MAP.has(symbol)) {
			const underlying = WRAPPED_TOKEN_MAP.get(symbol)!;
			results.push({
				sourceType:  'import',
				sourceId:    row.id,
				category:    'wrapped-swap',
				subCategory: `${symbol.toLowerCase()}-${underlying.toLowerCase()}`,
				confidence:  0.7,
				assetSymbol: row.asset_symbol,
				amountUsd:   row.native_usd,
				taxYear:     taxYear(row.timestamp_utc),
			});
			reviewItems.push({
				sourceType:   'import',
				sourceId:     row.id,
				reason:       'wrapped_token_swap',
				reasonDetail: `Wrapping or unwrapping ${symbol} ↔ ${underlying} may be a taxable property exchange. IRS guidance is unsettled — confirm tax treatment with your advisor.`,
				snapshotJson: JSON.stringify({ symbol, underlying, timestamp: row.timestamp_utc, kind }),
			});
			continue;
		}

		// ── 4. Perpetual / margin funding rate ────────────────────────────────
		// Funding rate payments flow between longs and shorts periodically.
		// Positive (received) = ordinary income; negative (paid) = potential deduction.
		if (matchesAny(combinedText, DEFI_FUNDING_KEYWORDS)) {
			const isIncome = row.direction === 'in';
			results.push({
				sourceType:  'import',
				sourceId:    row.id,
				category:    isIncome ? 'income' : 'loan-interest-paid',
				subCategory: 'funding-rate',
				confidence:  0.75,
				assetSymbol: row.asset_symbol,
				amountUsd:   row.native_usd,
				taxYear:     taxYear(row.timestamp_utc),
			});
			reviewItems.push({
				sourceType:   'import',
				sourceId:     row.id,
				reason:       'funding_payment',
				reasonDetail: `Perpetual/margin funding rate ${isIncome ? 'receipt (income)' : 'payment (deduction)'}. Confirm treatment — funding receipts are typically ordinary income; payments may be deductible as investment expenses.`,
				snapshotJson: JSON.stringify({ symbol, direction: row.direction, timestamp: row.timestamp_utc, kind }),
			});
			continue;
		}
	}

	return { results, reviewItems };
}
