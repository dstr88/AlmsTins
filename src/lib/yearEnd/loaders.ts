// ─────────────────────────────────────────────────────────────────────────────
// Tax pipeline loaders: the rows the passes read, for one tenant.
//
// The pipeline run (classify.ts) and the live ledger (tax/computeLedger.ts) read the same rows,
// so they read them here. Every query is scoped by tenant_id, including the wallets JOIN.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import type { ClassificationResult, RawImportTx, RawOnchainTx } from './types';

type DbRow = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const n = (v: unknown) => (typeof v === 'number' ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export async function loadImportTransactions(tenantId: string): Promise<RawImportTx[]> {
	const result = await db.execute({
		sql: `SELECT id, timestamp_utc, asset_symbol, direction, kind, amount,
		             to_amount, native_usd, tx_hash, source, notes, category, description,
		             account_id, wallet_id, import_batch_id
		      FROM import_transactions
		      WHERE tenant_id = ?
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});
	return result.rows.map((r: DbRow) => ({
		id: s(r.id),
		timestamp_utc: s(r.timestamp_utc),
		asset_symbol: str(r.asset_symbol),
		direction: str(r.direction),
		kind: str(r.kind),
		amount: n(r.amount),
		to_amount: n(r.to_amount),
		native_usd: n(r.native_usd),
		tx_hash: str(r.tx_hash),
		source: s(r.source),
		notes: str(r.notes),
		category: str(r.category),
		description: str(r.description),
		account_id: str(r.account_id),
		wallet_id: str(r.wallet_id),
		import_batch_id: str(r.import_batch_id),
	}));
}

export async function loadOnchainTransactions(tenantId: string): Promise<RawOnchainTx[]> {
	const result = await db.execute({
		sql: `SELECT t.id, t.timestamp, t.token_symbol, t.value,
		             t.from_address, t.to_address, t.tx_type,
		             t.usd_value, t.chain, w.address AS wallet_address,
		             t.wallet_id, t.token_decimals, t.hash
		      FROM transactions t
		      JOIN wallets w ON w.id = t.wallet_id AND w.tenant_id = t.tenant_id
		      WHERE t.tenant_id = ?
		      ORDER BY t.timestamp ASC`,
		args: [tenantId],
	});
	return result.rows.map((r: DbRow) => ({
		id: s(r.id),
		timestamp: s(r.timestamp),
		token_symbol: str(r.token_symbol),
		value: str(r.value),
		from_address: str(r.from_address),
		to_address: str(r.to_address),
		tx_type: str(r.tx_type),
		usd_value: n(r.usd_value),
		chain: s(r.chain),
		wallet_address: typeof r.wallet_address === 'string' ? r.wallet_address : undefined,
		wallet_id: str(r.wallet_id),
		// The column is read, so the field is always present: a null means "assume 18", as the lifecycle rebuild does.
		token_decimals: n(r.token_decimals),
		hash: str(r.hash),
	}));
}

export async function loadWalletAddresses(tenantId: string): Promise<Set<string>> {
	const result = await db.execute({
		sql: `SELECT address FROM wallets WHERE tenant_id = ?`,
		args: [tenantId],
	});
	return new Set(result.rows.map((r: DbRow) => s(r.address).toLowerCase()));
}

export async function loadManualClassifications(tenantId: string): Promise<Map<string, ClassificationResult>> {
	const result = await db.execute({
		sql: `SELECT source_type, source_id, category, sub_category, confidence,
		             linked_tx_id, linked_source_type, asset_symbol, amount_usd, tax_year
		      FROM tax_classifications
		      WHERE tenant_id = ? AND is_manual = 1`,
		args: [tenantId],
	});
	const map = new Map<string, ClassificationResult>();
	for (const r of result.rows as DbRow[]) {
		const key = `${s(r.source_type)}:${s(r.source_id)}`;
		map.set(key, {
			sourceType: s(r.source_type) as 'import' | 'onchain',
			sourceId: s(r.source_id),
			category: s(r.category) as ClassificationResult['category'],
			subCategory: typeof r.sub_category === 'string' ? r.sub_category : undefined,
			confidence: n(r.confidence) ?? 1.0,
			linkedTxId: typeof r.linked_tx_id === 'string' ? r.linked_tx_id : undefined,
			linkedSourceType: typeof r.linked_source_type === 'string'
				? (r.linked_source_type as 'import' | 'onchain')
				: undefined,
			assetSymbol: typeof r.asset_symbol === 'string' ? r.asset_symbol : null,
			amountUsd: n(r.amount_usd),
			taxYear: typeof r.tax_year === 'number' ? r.tax_year : null,
		});
	}
	return map;
}

export async function loadResolvedReviewKeys(tenantId: string): Promise<Set<string>> {
	const result = await db.execute({
		sql: `SELECT source_type, source_id, reason FROM tax_review_items WHERE tenant_id = ? AND resolved = 1`,
		args: [tenantId],
	});
	return new Set(result.rows.map((r: DbRow) => `${s(r.source_type)}:${s(r.source_id)}:${s(r.reason)}`));
}
