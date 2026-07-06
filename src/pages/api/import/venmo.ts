import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { snapshotCexAccount } from '@/lib/cexSnapshot';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { detectAndAlertBounces } from '@/lib/bounceDetector';
import { logActivity } from '@/lib/activityLog';

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

// Venmo exports three CSV types:
//   1. "Transactions statement" — DateTime, Transaction Type, Asset In/Out columns
//   2. "Gains and losses statement" — Property Quantity, Date Acquired, Date Sold, etc.
//   3. "Monthly account statement" — Account Statement - (@username) header,
//      banking-style rows with Amount (total) / Amount (fee), plus a
//      Cryptocurrency summary section with beginning/ending balances.
// Types 1 & 2 have clean CSV rows; type 3 needs its own raw parser.
const detectFormat = (headers: string[]): 'transactions' | 'gains' | 'unknown' => {
	if (headers.includes('DateTime') && headers.includes('Transaction Type')) return 'transactions';
	if (headers.includes('Property Symbol') && headers.includes('Date Acquired')) return 'gains';
	return 'unknown';
};

const isMonthlyStatement = (raw: string): boolean =>
	raw.trimStart().startsWith('Account Statement -');

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
	// Hash on transaction identity only — NOT description, which differs between
	// the "transactions" and "gains" CSV formats for the same real event.
	// Using (timestamp, symbol, quantity, nativeUsd, direction) uniquely identifies
	// a Venmo crypto event without conflating separate buys/sells of the same amount.
	const payload = JSON.stringify([
		'venmo',
		row.timestampUtc,
		row.currency,
		row.amount ?? '',
		row.nativeUsd ?? '',
		row.direction,
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

// ── Monthly account statement parser ────────────────────────────────────────
// Format: Account Statement - (@username)
//         Account Activity
//         ,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),
//           Amount (tax),Amount (fee),...
//         (transaction rows)
//         Cryptocurrency summary
//         ,,Bitcoin,Ethereum,Litecoin,...
//         ,Available beginning,0.0,0.0,0.0,...
//         ,Available ending,0.00103443,0.0,0.0,...
//
// The crypto quantity for each purchase is derived from:
//   quantity = ending_balance[asset] - beginning_balance[asset]
// This is exact when there is one purchase per asset per month (always true here).
const parseMonthlyStatement = (raw: string): NormalizedRow[] => {
	const lines = raw.split('\n').map((l) => l.trimEnd());

	// ── 1. Parse the Cryptocurrency summary balances ─────────────────────────
	// Asset name row:  ,,Bitcoin,Ethereum,Litecoin,...
	// Beginning row:   ,Available beginning,0.0,0.0,0.0,...
	// Ending row:      ,Available ending,0.00103443,0.0,0.0,...
	const assetNameMap: Record<string, string> = {
		bitcoin: 'BTC', ethereum: 'ETH', litecoin: 'LTC',
		'bitcoin cash': 'BCH', solana: 'SOL', 'ethereum classic': 'ETC',
	};

	let assetOrder: string[] = [];
	const beginning: Record<string, number> = {};
	const ending: Record<string, number> = {};

	const summaryIdx = lines.findIndex((l) => l.startsWith('Cryptocurrency summary'));
	if (summaryIdx !== -1) {
		for (let i = summaryIdx + 1; i < Math.min(summaryIdx + 12, lines.length); i++) {
			const fields = lines[i].split(',').map((f) => f.trim());
			// Asset header row: first two fields empty, then asset names
			if (fields[0] === '' && fields[1] === '' && fields[2] && !fields[2].startsWith('Available')) {
				assetOrder = fields.slice(2).filter(Boolean).map((a) => assetNameMap[a.toLowerCase()] ?? a.toUpperCase());
			}
			if (fields[1] === 'Available beginning') {
				assetOrder.forEach((sym, idx) => {
					const val = parseFloat(fields[idx + 2] ?? '0');
					if (!isNaN(val)) beginning[sym] = val;
				});
			}
			if (fields[1] === 'Available ending') {
				assetOrder.forEach((sym, idx) => {
					const val = parseFloat(fields[idx + 2] ?? '0');
					if (!isNaN(val)) ending[sym] = val;
				});
				break; // first "Available ending" block is the quantity block (not USD estimates)
			}
		}
	}

	// ── 2. Find the transaction header row and parse transactions ─────────────
	const headerIdx = lines.findIndex((l) => l.includes(',ID,Datetime,Type,'));
	if (headerIdx === -1) return [];

	const headers = lines[headerIdx].split(',').map((h) => h.trim());
	const col = (row: string[], name: string) => {
		const idx = headers.indexOf(name);
		return idx >= 0 ? (row[idx] ?? '').trim() : '';
	};

	const results: NormalizedRow[] = [];

	for (let i = headerIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || line.startsWith('Cryptocurrency')) break;

		const fields = line.split(',').map((f) => f.trim());
		const id = col(fields, 'ID');
		const datetime = col(fields, 'Datetime');
		const txType = col(fields, 'Type');

		// Only rows with a numeric transaction ID and a timestamp
		if (!id || !/^\d{10,}$/.test(id) || !datetime) continue;

		// Only crypto transactions — skip P2P payments, bank transfers, etc.
		const typeLC = txType.toLowerCase();
		const isCryptoPurchase = typeLC.includes('purchase') && (
			typeLC.includes('bitcoin') || typeLC.includes('ethereum') ||
			typeLC.includes('litecoin') || typeLC.includes('solana') ||
			typeLC.includes('crypto')
		);
		const isCryptoSale = typeLC.includes('sale') || typeLC.includes('sold');
		if (!isCryptoPurchase && !isCryptoSale) continue;

		const timestampUtc = normalizeTimestamp(datetime);
		if (!timestampUtc) continue;

		// Determine asset symbol from transaction type
		let symbol = 'BTC';
		if (typeLC.includes('ethereum')) symbol = 'ETH';
		else if (typeLC.includes('litecoin')) symbol = 'LTC';
		else if (typeLC.includes('solana')) symbol = 'SOL';
		else if (typeLC.includes('bitcoin cash')) symbol = 'BCH';

		// USD cost from Amount (total), fee from Amount (fee)
		const amtRaw = col(fields, 'Amount (total)').replace(/[$+\-,\s]/g, '');
		const feeRaw = col(fields, 'Amount (fee)').replace(/[$+\-,\s]/g, '');
		const nativeUsd = parseFloat(amtRaw) || null;
		const feeUsd = parseFloat(feeRaw) || null;

		// Derive crypto quantity from balance change
		const balanceDelta = (ending[symbol] ?? 0) - (beginning[symbol] ?? 0);
		const quantity = balanceDelta > 0 ? balanceDelta : null;

		const direction: 'in' | 'out' = isCryptoPurchase ? 'in' : 'out';
		const signedQty = quantity !== null
			? (direction === 'out' ? -Math.abs(quantity) : Math.abs(quantity))
			: null;

		results.push({
			timestampUtc,
			description: txType,
			currency: symbol,
			amount: signedQty,
			toCurrency: '',
			toAmount: null,
			nativeCurrency: 'USD',
			nativeAmount: nativeUsd !== null ? Math.abs(nativeUsd) : null,
			nativeUsd: nativeUsd !== null ? Math.abs(nativeUsd) : null,
			kind: isCryptoPurchase ? 'crypto_purchase' : 'crypto_to_van_sell_order',
			txHash: id,
			direction,
			assetSymbol: symbol,
			feeUsd: feeUsd !== null ? Math.abs(feeUsd) : null,
		});
	}

	return results;
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
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

	// Monthly statements need a different parsing path
	const monthly = isMonthlyStatement(content);
	const normalizedRows: NormalizedRow[] = monthly
		? parseMonthlyStatement(content)
		: [];

	// For non-monthly formats use the standard CSV row parser
	const csvRows = monthly ? [] : parseCsv(content);
	if (!monthly && !csvRows.length) {
		return new Response(JSON.stringify({ error: 'No rows parsed from file.' }), { status: 400 });
	}

	const format = monthly ? 'monthly' : detectFormat(Object.keys(csvRows[0] ?? {}));
	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;

	// Build the list of normalized rows to insert
	const allNormalized: NormalizedRow[] = monthly
		? normalizedRows
		: csvRows.map((row) =>
				format === 'transactions'
					? normalizeTransactionRow(row)
					: format === 'gains'
						? normalizeGainsRow(row)
						: null,
		  ).filter((r): r is NormalizedRow => r !== null);

	for (const normalized of allNormalized) {
		if (!normalized) continue;

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId(normalized.assetSymbol, normalized.timestampUtc);

		const rawResult = await db.execute({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, 'venmo', ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(normalized), rowHash],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount,
				to_currency, to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction,
				asset_symbol, group_id, row_hash, fee_usd, created_at)
				VALUES (?, ?, 'venmo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
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

	void snapshotCexAccount(tenantId, resolvedAccountId, 'venmo', 'Venmo');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'venmo' });

	return new Response(
		JSON.stringify({ batchId, accountId: resolvedAccountId, format, insertedRaw, insertedNormalized, skippedDuplicates }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
