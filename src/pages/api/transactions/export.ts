import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import {
	getImportTransactionColumns,
	selectImportColumn,
	selectImportNotes,
} from '@/lib/importTransactionsSchema';

type UnifiedRow = {
	id: string;
	source: string;
	import_batch_id: string | null;
	timestamp_utc: string;
	description: string | null;
	currency: string | null;
	amount: number | null;
	to_currency: string | null;
	to_amount: number | null;
	native_currency: string | null;
	native_amount: number | null;
	native_usd: number | null;
	kind: string | null;
	tx_hash: string | null;
	direction: string | null;
	asset_symbol: string | null;
	notes: string | null;
	category: string | null;
	group_id: string | null;
	fee_usd: number | null;
	fee_native: number | null;
	fee_currency: string | null;
	fee_paid: string | null;
	onchain_value: string | null;
	onchain_decimals: number | null;
	onchain_chain: string | null;
};

type DbRow = Record<string, unknown>;

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');
const toStringOrNull = (value: unknown) => (typeof value === 'string' ? value : value === null ? null : null);
const toNumberOrNull = (value: unknown) => (typeof value === 'number' ? value : value === null ? null : null);

const toUnifiedRow = (row: unknown): UnifiedRow | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: toStringOrEmpty(r.id),
		source: toStringOrEmpty(r.source),
		import_batch_id: toStringOrNull(r.import_batch_id),
		timestamp_utc: toStringOrEmpty(r.timestamp_utc),
		description: toStringOrNull(r.description),
		currency: toStringOrNull(r.currency),
		amount: toNumberOrNull(r.amount),
		to_currency: toStringOrNull(r.to_currency),
		to_amount: toNumberOrNull(r.to_amount),
		native_currency: toStringOrNull(r.native_currency),
		native_amount: toNumberOrNull(r.native_amount),
		native_usd: toNumberOrNull(r.native_usd),
		kind: toStringOrNull(r.kind),
		tx_hash: toStringOrNull(r.tx_hash),
		direction: toStringOrNull(r.direction),
		asset_symbol: toStringOrNull(r.asset_symbol),
		notes: toStringOrNull(r.notes),
		category: toStringOrNull(r.category),
		group_id: toStringOrNull(r.group_id),
		fee_usd: toNumberOrNull(r.fee_usd),
		fee_native: toNumberOrNull(r.fee_native),
		fee_currency: toStringOrNull(r.fee_currency),
		fee_paid: toStringOrNull(r.fee_paid),
		onchain_value: toStringOrNull(r.onchain_value),
		onchain_decimals: toNumberOrNull(r.onchain_decimals),
		onchain_chain: toStringOrNull(r.onchain_chain),
	};
};

const toUnifiedRows = (rows: unknown): UnifiedRow[] => {
	if (!Array.isArray(rows)) return [];
	const out: UnifiedRow[] = [];
	for (const row of rows) {
		const mapped = toUnifiedRow(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

const csvEscape = (value: string) => {
	if (value.includes('"') || value.includes(',') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
};

const normalizeSymbol = (symbol: string | null) => {
	if (!symbol) return '';
	const upper = symbol.toUpperCase();
	if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
	return upper;
};

const pickSymbol = (row: UnifiedRow) => {
	return normalizeSymbol(row.asset_symbol || row.to_currency || row.currency || '');
};

const pickTokenAmount = (row: UnifiedRow) => {
	const symbol = pickSymbol(row);
	if (symbol && row.to_currency && symbol === normalizeSymbol(row.to_currency)) return row.to_amount;
	if (symbol && row.currency && symbol === normalizeSymbol(row.currency)) return row.amount;
	return row.to_amount ?? row.amount;
};

const pickUsdAmount = (row: UnifiedRow) => row.native_usd ?? row.native_amount;

const resolveChain = (row: UnifiedRow) => {
	if (row.onchain_chain) return row.onchain_chain;
	if (row.source.startsWith('onchain_')) return row.source.replace('onchain_', '');
	return '';
};

const resolveFee = (row: UnifiedRow) => {
	if (row.fee_usd !== null && row.fee_usd !== undefined) return row.fee_usd;
	if (row.fee_native !== null && row.fee_native !== undefined) return row.fee_native;
	if (row.fee_paid) return row.fee_paid;
	return null;
};

export const GET: APIRoute = async ({ request, url }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const walletId = url.searchParams.get('walletId');

	if (walletId) {
		try {
			await requireWalletOwnedByTenant(walletId, tenantId);
		} catch (err) {
			if (err instanceof Response) return err;
			throw err;
		}
	}

	const rowsArgs: any[] = [tenantId, tenantId];
	const rowsWalletClause = walletId ? 'AND t.wallet_id = ?' : '';
	if (walletId) rowsArgs.push(walletId);

	let importColumns = new Set<string>();
	try {
		importColumns = await getImportTransactionColumns();
	} catch (error) {
		console.error('[transactions/export] Failed to load import_transactions schema', error);
	}

	const importNotes = selectImportNotes(importColumns);
	const importCategory = selectImportColumn(importColumns, 'category');
	const importGroupId = selectImportColumn(importColumns, 'group_id');
	const importFeeUsd = selectImportColumn(importColumns, 'fee_usd');
	const importFeeNative = selectImportColumn(importColumns, 'fee_native');
	const importFeeCurrency = selectImportColumn(importColumns, 'fee_currency');

	const result = await db.execute({
		sql: `SELECT id, source, import_batch_id, timestamp_utc, description, currency, amount, to_currency, to_amount,
			native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, ${importNotes}, ${importCategory}, ${importGroupId},
			${importFeeUsd}, ${importFeeNative}, ${importFeeCurrency}, NULL AS fee_paid,
			NULL AS onchain_value, NULL AS onchain_decimals, NULL AS onchain_chain
			FROM import_transactions
			WHERE tenant_id = ?
			UNION ALL
			SELECT
				t.id,
				'onchain_' || t.chain AS source,
				NULL AS import_batch_id,
				t.timestamp AS timestamp_utc,
				t.tx_type AS description,
				CASE
					WHEN t.token_symbol = 'native' AND t.chain = 'ethereum' THEN 'ETH'
					WHEN t.token_symbol = 'native' AND t.chain = 'polygon' THEN 'POL'
					WHEN t.token_symbol = 'native' AND t.chain = 'avalanche' THEN 'AVAX'
					ELSE t.token_symbol
				END AS currency,
				NULL AS amount,
				NULL AS to_currency,
				NULL AS to_amount,
				NULL AS native_currency,
				NULL AS native_amount,
				NULL AS native_usd,
				t.tx_type AS kind,
				t.hash AS tx_hash,
				CASE
					WHEN t.tx_type IN ('incoming', 'token_in') THEN 'in'
					WHEN t.tx_type IN ('outgoing', 'token_out') THEN 'out'
					ELSE NULL
				END AS direction,
				CASE
					WHEN t.token_symbol = 'native' AND t.chain = 'ethereum' THEN 'ETH'
					WHEN t.token_symbol = 'native' AND t.chain = 'polygon' THEN 'POL'
					WHEN t.token_symbol = 'native' AND t.chain = 'avalanche' THEN 'AVAX'
					ELSE t.token_symbol
				END AS asset_symbol,
				a.note AS notes,
				a.category AS category,
				NULL AS group_id,
				NULL AS fee_usd,
				NULL AS fee_native,
				CASE
					WHEN t.chain = 'ethereum' THEN 'ETH'
					WHEN t.chain = 'polygon' THEN 'POL'
					WHEN t.chain = 'avalanche' THEN 'AVAX'
					ELSE NULL
				END AS fee_currency,
				t.fee_paid AS fee_paid,
				t.value AS onchain_value,
				t.token_decimals AS onchain_decimals,
				t.chain AS onchain_chain
			FROM transactions t
			LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
			WHERE t.tenant_id = ? ${rowsWalletClause}
			ORDER BY timestamp_utc DESC`,
		args: rowsArgs,
	});

	const rows = toUnifiedRows(result.rows);
	const header = [
		'timestamp_utc',
		'source',
		'chain',
		'tx_hash',
		'direction',
		'symbol',
		'amount',
		'amount_usd',
		'fee',
		'notes',
		'category',
		'group_id',
		'import_batch_id',
	].join(',');

	const lines = rows.map((row) => {
		const values = [
			row.timestamp_utc,
			row.source,
			resolveChain(row),
			row.tx_hash ?? '',
			row.direction ?? '',
			pickSymbol(row),
			String(pickTokenAmount(row) ?? ''),
			String(pickUsdAmount(row) ?? ''),
			String(resolveFee(row) ?? ''),
			row.notes ?? '',
			row.category ?? '',
			row.group_id ?? '',
			row.import_batch_id ?? '',
		].map((value) => csvEscape(String(value ?? '')));
		return values.join(',');
	});

	const csv = `${header}\n${lines.join('\n')}`;
	const filename = walletId ? `all-transactions-${walletId}.csv` : 'all-transactions.csv';

	return new Response(csv, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
		},
	});
};
