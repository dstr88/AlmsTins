import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

type CsvRow = Record<string, string>;

type NormalizedRow = {
	timestampUtc: string;
	description: string;
	currency: string;
	amount: number | null;
	toCurrency: string;
	toAmount: number | null;
	nativeCurrency: string;
	nativeAmount: number | null;
	nativeUsd: number | null;
	kind: string;
	txHash: string | null;
	direction: 'in' | 'out' | 'lost';
	assetSymbol: string | null;
	feeUsd: number | null;
};

// Venmo exports two CSV types:
//   1. "Transactions statement" — DateTime, Transaction Type, Asset In/Out columns
//   2. "Gains and losses statement" — Property Quantity, Date Acquired, Date Sold, etc.
// Both have 1-2 disclaimer rows before the actual headers.
const detectFormat = (headers: string[]): 'transactions' | 'gains' | 'unknown' => {
	if (headers.includes('DateTime') && headers.includes('Transaction Type')) return 'transactions';
	if (headers.includes('Property Symbol') && headers.includes('Date Acquired')) return 'gains';
	return 'unknown';
};

const parseCsv = (input: string): CsvRow[] => {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < input.length; i += 1) {
		const char = input[i];
		const next = input[i + 1];

		if (char === '"') {
			if (inQuotes && next === '"') {
				field += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (char === ',' && !inQuotes) {
			current.push(field.trim());
			field = '';
			continue;
		}

		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && next === '\n') i += 1;
			current.push(field.trim());
			field = '';
			if (current.length > 1 || current.some((v) => v !== '')) rows.push(current);
			current = [];
			continue;
		}

		field += char;
	}

	if (field.length || current.length) {
		current.push(field.trim());
		if (current.length > 1 || current.some((v) => v !== '')) rows.push(current);
	}

	if (!rows.length) return [];

	// Skip disclaimer/title rows until we find the real header row.
	// Venmo headers start with 'DateTime' (transactions) or 'Property Quantity' (gains).
	while (
		rows.length &&
		rows[0][0] !== 'DateTime' &&
		rows[0][0] !== 'Property Quantity'
	) {
		rows.shift();
	}

	const headers = rows.shift() ?? [];
	return rows.map((row) => {
		const record: CsvRow = {};
		headers.forEach((header, index) => {
			record[header] = (row[index] ?? '').trim();
		});
		return record;
	});
};

const normalizeTimestamp = (value: string) => {
	if (!value) return '';
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString();
};

const parseNumber = (value: string | null | undefined): number | null => {
	if (!value || value.trim() === '') return null;
	const cleaned = value.replace(/[$,]/g, '');
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
		'venmo',
		row.timestampUtc,
		row.description,
		row.currency,
		row.amount ?? '',
		row.toCurrency,
		row.toAmount ?? '',
		row.kind,
	]);
	return createHash('sha256').update(payload).digest('hex');
};

const buildGroupId = (assetSymbol: string | null, timestampUtc: string) => {
	if (!assetSymbol) return null;
	const datePart = timestampUtc.slice(0, 10);
	const payload = `venmo:${assetSymbol}:${datePart}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
};

// ── Transaction-statement row → NormalizedRow ───────────────────────────────
// Columns: DateTime | Transaction Type | Asset In (Quantity) | Asset In (Currency)
//          | Asset Out (Quantity) | Asset Out (Currency)
//          | Transaction Fee (Quantity) | Transaction Fee (Currency) | Market Value (USD)
//
// Transaction types:
//   BUY           → pay USD, receive crypto          → direction: in  (crypto)
//   SELL          → pay crypto, receive USD           → direction: out (crypto)
//   TRANSFER-IN   → receive crypto from external addr → direction: in
//   TRANSFER-OUT  → send crypto to external addr      → direction: out
const normalizeTransactionRow = (row: CsvRow): NormalizedRow | null => {
	const timestampUtc = normalizeTimestamp(row['DateTime'] || '');
	if (!timestampUtc) return null;

	const txType = (row['Transaction Type'] || '').toUpperCase().trim();
	const assetInQty = parseNumber(row['Asset In (Quantity)']);
	const assetInCcy = (row['Asset In (Currency)'] || '').toUpperCase().trim();
	const assetOutQty = parseNumber(row['Asset Out (Quantity)']);
	const assetOutCcy = (row['Asset Out (Currency)'] || '').toUpperCase().trim();
	const feeQty = parseNumber(row['Transaction Fee (Quantity)']);
	const feeCcy = (row['Transaction Fee (Currency)'] || '').toUpperCase().trim();
	const marketValueUsd = parseNumber(row['Market Value (USD)']);

	// Fee in USD — convert only if fee currency is USD; otherwise record as null
	const feeUsd = feeCcy === 'USD' ? (feeQty !== null ? Math.abs(feeQty) : null) : null;

	switch (txType) {
		case 'BUY': {
			// Receive crypto (Asset In), pay USD (Asset Out)
			const symbol = assetInCcy !== 'USD' ? assetInCcy : assetOutCcy;
			return {
				timestampUtc,
				description: 'Buy',
				currency: symbol,
				amount: assetInQty !== null ? Math.abs(assetInQty) : null,
				toCurrency: 'USD',
				toAmount: assetOutQty !== null ? -Math.abs(assetOutQty) : null,
				nativeCurrency: 'USD',
				nativeAmount: marketValueUsd,
				nativeUsd: marketValueUsd,
				kind: 'crypto_purchase',
				txHash: null,
				direction: 'in',
				assetSymbol: symbol,
				feeUsd,
			};
		}
		case 'SELL': {
			// Pay crypto (Asset Out), receive USD (Asset In)
			const symbol = assetOutCcy !== 'USD' ? assetOutCcy : assetInCcy;
			return {
				timestampUtc,
				description: 'Sell',
				currency: symbol,
				amount: assetOutQty !== null ? -Math.abs(assetOutQty) : null,
				toCurrency: 'USD',
				toAmount: assetInQty !== null ? Math.abs(assetInQty) : null,
				nativeCurrency: 'USD',
				nativeAmount: marketValueUsd,
				nativeUsd: marketValueUsd,
				kind: 'crypto_to_van_sell_order',
				txHash: null,
				direction: 'out',
				assetSymbol: symbol,
				feeUsd,
			};
		}
		case 'TRANSFER-IN': {
			const symbol = assetInCcy !== 'USD' ? assetInCcy : assetOutCcy;
			return {
				timestampUtc,
				description: 'Transfer In',
				currency: symbol,
				amount: assetInQty !== null ? Math.abs(assetInQty) : null,
				toCurrency: '',
				toAmount: null,
				nativeCurrency: 'USD',
				nativeAmount: marketValueUsd,
				nativeUsd: marketValueUsd,
				kind: 'crypto_deposit',
				txHash: null,
				direction: 'in',
				assetSymbol: symbol,
				feeUsd,
			};
		}
		case 'TRANSFER-OUT': {
			const symbol = assetOutCcy !== 'USD' ? assetOutCcy : assetInCcy;
			return {
				timestampUtc,
				description: 'Transfer Out',
				currency: symbol,
				amount: assetOutQty !== null ? -Math.abs(assetOutQty) : null,
				toCurrency: '',
				toAmount: null,
				nativeCurrency: 'USD',
				nativeAmount: marketValueUsd,
				nativeUsd: marketValueUsd,
				kind: 'crypto_withdrawal',
				txHash: null,
				direction: 'out',
				assetSymbol: symbol,
				feeUsd,
			};
		}
		default:
			return null;
	}
};

// ── Gains-statement row → NormalizedRow ─────────────────────────────────────
// Columns: Property Quantity | Property Symbol | Date Acquired | Date Sold or Disposed
//          | Proceeds (USD) | Cost Basis (USD) | Gain (or Loss) in USD
//          | Gain/Loss Type | Tax Year
// These represent completed disposals — import as synthetic sell events so they
// feed into the capital-gains tins on the bookkeeping page.
const normalizeGainsRow = (row: CsvRow): NormalizedRow | null => {
	const soldAt = normalizeTimestamp(row['Date Sold or Disposed'] || '');
	if (!soldAt) return null;

	const symbol = (row['Property Symbol'] || '').toUpperCase().trim();
	if (!symbol) return null;

	const qty = parseNumber(row['Property Quantity']);
	const proceeds = parseNumber(row['Proceeds (USD)']);
	const costBasis = parseNumber(row['Cost Basis (USD)']);

	return {
		timestampUtc: soldAt,
		description: `Gain/Loss (${row['Gain/Loss Type'] || 'unknown'})`,
		currency: symbol,
		amount: qty !== null ? -Math.abs(qty) : null,
		toCurrency: 'USD',
		toAmount: proceeds,
		nativeCurrency: 'USD',
		nativeAmount: proceeds,
		nativeUsd: proceeds,
		kind: 'crypto_to_van_sell_order',
		txHash: null,
		direction: 'out',
		assetSymbol: symbol,
		feeUsd: null,
		// Store cost basis in notes via description (picked up by tax engine)
		...(costBasis !== null ? { description: `Gain/Loss (${row['Gain/Loss Type'] || 'unknown'}) | cost_basis:${costBasis}` } : {}),
	};
};

export const POST: APIRoute = async ({ request }) => {
	const { tenantId } = await requireTenantSession(request);
	const formData = await request.formData();
	const file = formData.get('file');
	const accountIdRaw = formData.get('accountId');

	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file upload.' }), { status: 400 });
	}

	const accountId = typeof accountIdRaw === 'string' ? accountIdRaw.trim() : '';
	let resolvedAccountId = '';
	if (accountId) {
		const accountResult = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE id = ? AND tenant_id = ? AND source = 'venmo' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) resolvedAccountId = accountId;
	}
	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'venmo'
				ORDER BY created_at ASC LIMIT 1`,
			args: [tenantId],
		});
		const existingId = String(existing.rows?.[0]?.id ?? '');
		if (existingId) {
			resolvedAccountId = existingId;
		} else {
			const newId = randomUUID();
			await db.execute({
				sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name)
					VALUES (?, ?, 'venmo', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions SET account_id = ?
			WHERE tenant_id = ? AND source = 'venmo' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows SET account_id = ?
			WHERE tenant_id = ? AND source = 'venmo' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	if (!rows.length) {
		return new Response(JSON.stringify({ error: 'No rows parsed from file.' }), { status: 400 });
	}

	const format = detectFormat(Object.keys(rows[0]));
	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;

	for (const row of rows) {
		const normalized =
			format === 'transactions'
				? normalizeTransactionRow(row)
				: format === 'gains'
					? normalizeGainsRow(row)
					: null;

		if (!normalized) continue;

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId(normalized.assetSymbol, normalized.timestampUtc);

		const rawResult = await db.execute({
			sql: `INSERT OR IGNORE INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, 'venmo', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(row), rowHash],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT OR IGNORE INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount,
				to_currency, to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction,
				asset_symbol, group_id, row_hash, fee_usd, created_at)
				VALUES (?, ?, 'venmo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			args: [
				randomUUID(),
				tenantId,
				resolvedAccountId,
				batchId,
				normalized.timestampUtc,
				normalized.description || null,
				normalized.currency || null,
				normalized.amount,
				normalized.toCurrency || null,
				normalized.toAmount,
				normalized.nativeCurrency || null,
				normalized.nativeAmount,
				normalized.nativeUsd,
				normalized.kind || null,
				normalized.txHash,
				normalized.direction,
				normalized.assetSymbol,
				groupId,
				rowHash,
				normalized.feeUsd,
			],
		});

		insertedRaw += rawResult.rowsAffected ?? 0;
		insertedNormalized += normalizedResult.rowsAffected ?? 0;
		if ((rawResult.rowsAffected ?? 0) === 0 && (normalizedResult.rowsAffected ?? 0) === 0) {
			skippedDuplicates += 1;
		}
	}

	return new Response(
		JSON.stringify({ batchId, accountId: resolvedAccountId, format, insertedRaw, insertedNormalized, skippedDuplicates }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
