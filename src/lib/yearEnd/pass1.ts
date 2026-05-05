// ─────────────────────────────────────────────────────────────────────────────
// Pass 1 — Easy classifications
//
// Handles transactions where the source already tells us exactly what happened:
//   • CEX labels (Coinbase, Crypto.com kind field)
//   • On-chain Aave liquidations (tx_type = 'aave_liquidation')
//   • On-chain burns (to_address is a known burn address)
//
// Returns one ClassificationResult per row that was classified.
// Rows that can't be determined here are left for later passes.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, RawImportTx, RawOnchainTx } from './types';
import {
	BURN_ADDRESSES,
	COINBASE_AIRDROP_KINDS,
	COINBASE_BUY_KINDS,
	COINBASE_FEE_KINDS,
	COINBASE_INCOME_KINDS,
	COINBASE_SELL_KINDS,
	COINBASE_SWAP_KINDS,
	COINBASE_TRANSFER_IN_KINDS,
	COINBASE_TRANSFER_OUT_KINDS,
	CRYPTOCOM_BUY_KINDS,
	CRYPTOCOM_INCOME_KINDS,
	CRYPTOCOM_SELL_KINDS,
	CRYPTOCOM_SWAP_KINDS,
	CRYPTOCOM_TRANSFER_IN_KINDS,
	CRYPTOCOM_TRANSFER_OUT_KINDS,
} from './constants';
import type { TaxCategory } from './types';

const taxYear = (ts: string) => {
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
};

// ── Coinbase ──────────────────────────────────────────────────────────────────

function classifyCoinbaseKind(kind: string): { category: TaxCategory; sub?: string } | null {
	if (COINBASE_BUY_KINDS.has(kind)) return { category: 'buy' };
	if (COINBASE_SELL_KINDS.has(kind)) return { category: 'sell' };
	if (COINBASE_SWAP_KINDS.has(kind)) return { category: 'swap' };
	if (COINBASE_INCOME_KINDS.has(kind)) return { category: 'income', sub: kind.toLowerCase().replace(/\s+/g, '-') };
	if (COINBASE_AIRDROP_KINDS.has(kind)) return { category: 'airdrop' };
	if (COINBASE_TRANSFER_IN_KINDS.has(kind)) return { category: 'transfer' };
	if (COINBASE_TRANSFER_OUT_KINDS.has(kind)) return { category: 'transfer' };
	if (COINBASE_FEE_KINDS.has(kind)) return { category: 'fee' };
	return null;
}

// ── Crypto.com ────────────────────────────────────────────────────────────────

function classifyCryptoComKind(kind: string): { category: TaxCategory; sub?: string } | null {
	if (CRYPTOCOM_BUY_KINDS.has(kind)) return { category: 'buy' };
	if (CRYPTOCOM_SELL_KINDS.has(kind)) return { category: 'sell' };
	if (CRYPTOCOM_SWAP_KINDS.has(kind)) return { category: 'swap' };
	if (CRYPTOCOM_INCOME_KINDS.has(kind)) return { category: 'income', sub: kind };
	if (CRYPTOCOM_TRANSFER_IN_KINDS.has(kind)) return { category: 'transfer' };
	if (CRYPTOCOM_TRANSFER_OUT_KINDS.has(kind)) return { category: 'transfer' };
	return null;
}

// ── Generic fallback keyword matcher ─────────────────────────────────────────

function classifyByKeywords(kind: string): { category: TaxCategory; sub?: string } | null {
	const k = kind.toLowerCase();
	if (k.includes('buy') || k.includes('purchase')) return { category: 'buy' };
	if (k.includes('sell') || k.includes('cashout')) return { category: 'sell' };
	if (k.includes('swap') || k.includes('convert') || k.includes('exchange')) return { category: 'swap' };
	if (k.includes('airdrop')) return { category: 'airdrop' };
	if (k.includes('reward') || k.includes('earn') || k.includes('staking') || k.includes('interest')) {
		return { category: 'income', sub: k };
	}
	if (k.includes('send') || k.includes('withdrawal') || k.includes('transfer')) return { category: 'transfer' };
	if (k.includes('receive') || k.includes('deposit')) return { category: 'transfer' };
	return null;
}

// ── Public: classify import_transactions ──────────────────────────────────────

export function classifyImportTxPass1(row: RawImportTx): ClassificationResult | null {
	const kind = (row.kind ?? '').trim();
	if (!kind) return null;

	let result: { category: TaxCategory; sub?: string } | null = null;

	// Crypto.com "Card Rebate" transactions are a purchase discount (like credit-card
	// cash back), not taxable ordinary income.  Intercept them before the kind-based
	// classifier can assign category='income'.
	if (row.source === 'crypto_com') {
		const desc = (row.description ?? '').trimStart();
		if (/^card rebate/i.test(desc)) {
			return {
				sourceType: 'import',
				sourceId: row.id,
				category: 'card-rebate',
				subCategory: 'crypto-com-card-rebate',
				confidence: 1.0,
				assetSymbol: row.asset_symbol,
				amountUsd: row.native_usd,
				taxYear: taxYear(row.timestamp_utc),
			};
		}
	}

	if (row.source === 'coinbase') {
		result = classifyCoinbaseKind(kind);
	} else if (row.source === 'crypto_com') {
		result = classifyCryptoComKind(kind);
	}

	// Generic keyword fallback for other exchanges (Gemini, Robinhood, etc.)
	if (!result) {
		result = classifyByKeywords(kind);
	}

	if (!result) return null;

	return {
		sourceType: 'import',
		sourceId: row.id,
		category: result.category,
		subCategory: result.sub,
		confidence: 0.95,
		assetSymbol: row.asset_symbol,
		amountUsd: row.native_usd,
		taxYear: taxYear(row.timestamp_utc),
	};
}

// ── Public: classify on-chain transactions ────────────────────────────────────

export function classifyOnchainTxPass1(row: RawOnchainTx): ClassificationResult | null {
	// Aave liquidations are already labelled by the sync process
	if (row.tx_type === 'aave_liquidation') {
		return {
			sourceType: 'onchain',
			sourceId: row.id,
			category: 'liquidation',
			subCategory: 'aave',
			confidence: 1.0,
			assetSymbol: row.token_symbol,
			amountUsd: row.usd_value,
			taxYear: taxYear(row.timestamp),
		};
	}

	// Burns — coin sent to known null address
	const toAddr = (row.to_address ?? '').toLowerCase();
	if (BURN_ADDRESSES.has(toAddr)) {
		return {
			sourceType: 'onchain',
			sourceId: row.id,
			category: 'burn',
			confidence: 1.0,
			assetSymbol: row.token_symbol,
			amountUsd: row.usd_value,
			taxYear: taxYear(row.timestamp),
		};
	}

	return null;
}
