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

// Cash App CSV headers (also exported as .txt):
//   Transaction ID, Date, Transaction Type, Currency, Amount, Fee,
//   Net Amount, Asset Type, Asset Price, Asset Amount
//
// Transaction Types:
//   "Bitcoin Buy"      → buy BTC with USD   → direction: in  (receiving crypto)
//   "Bitcoin Sold"     → sell BTC for USD   → direction: out (disposing crypto)
//   "Bitcoin Sent"     → withdraw to wallet → direction: out
//   "Bitcoin Received" → deposit from wallet→ direction: in
//   Variations exist for Litecoin, Ethereum, etc.

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

	// Skip any leading rows that don't look like Cash App headers
	while (rows.length && rows[0][0] !== 'Transaction ID') {
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

// Parse Cash App amount strings: "-$97.75" → -97.75, "$57,157.86" → 57157.86
// Also handles asset amounts with units: "0.00171018 BTC" → 0.00171018
const parseAmount = (value: string | null | undefined): number | null => {
	if (!value || value.trim() === '') return null;
	const cleaned = value
		.replace(/[$,]/g, '')             // strip $ and commas
		.replace(/\s*[A-Z]{2,}\s*$/, '') // strip trailing asset symbol (BTC, ETH, LTC…)
		.trim();
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

// Cash App dates include a timezone abbreviation: "2024-09-09 17:50:12 PDT"
// Strip the tz abbreviation and treat as UTC offset based on common US zones.
const normalizeTimestamp = (value: string): string => {
	if (!value) return '';
	// Map common US timezone abbreviations to UTC offsets
	const tzOffsets: Record<string, string> = {
		PDT: '-07:00', PST: '-08:00',
		MDT: '-06:00', MST: '-07:00',
		CDT: '-05:00', CST: '-06:00',
		EDT: '-04:00', EST: '-05:00',
		UTC: '+00:00',
	};
	let normalized = value.trim();
	for (const [abbr, offset] of Object.entries(tzOffsets)) {
		if (normalized.endsWith(` ${abbr}`)) {
			normalized = normalized.slice(0, -(abbr.length + 1)).replace(' ', 'T') + offset;
			break;
		}
	}
	// If no tz found, treat as UTC
	if (!normalized.includes('T')) normalized = normalized.replace(' ', 'T') + 'Z';
	const d = new Date(normalized);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString();
};

// Determine asset symbol and direction from Cash App transaction type.
// "Bitcoin Buy" → { symbol: 'BTC', direction: 'in',  kind: 'crypto_purchase' }
// "Bitcoin Sold"→ { symbol: 'BTC', direction: 'out', kind: 'crypto_to_van_sell_order' }
// Also works for "Litecoin Buy", "Ethereum Buy", etc.
const classifyTransaction = (
	txType: string,
	assetType: string,
): { symbol: string; direction: 'in' | 'out'; kind: string } | null => {
	const t = txType.toLowerCase().trim();
	// Use Asset Type column as canonical symbol if present
	const symbol = assetType.trim().toUpperCase() || 'BTC';

	if (t.includes('buy') || t.includes('purchase') || t.includes('received')) {
		return { symbol, direction: 'in', kind: t.includes('received') ? 'crypto_deposit' : 'crypto_purchase' };
	}
	if (t.includes('sold') || t.includes('sell')) {
		return { symbol, direction: 'out', kind: 'crypto_to_van_sell_order' };
	}
	if (t.includes('sent') || t.includes('withdrawal') || t.includes('withdraw')) {
		return { symbol, direction: 'out', kind: 'crypto_withdrawal' };
	}
	if (t.includes('receive') || t.includes('deposit') || t.includes('incoming')) {
		return { symbol, direction: 'in', kind: 'crypto_deposit' };
	}
	return null;
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
		'cashapp',
		row.timestampUtc,
		row.description,
		row.currency,
		row.amount ?? '',
		row.kind,
	]);
	return createHash('sha256').update(payload).digest('hex');
};

const buildGroupId = (assetSymbol: string | null, timestampUtc: string) => {
	if (!assetSymbol) return null;
	const datePart = timestampUtc.slice(0, 10);
	const payload = `cashapp:${assetSymbol}:${datePart}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
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
				WHERE id = ? AND tenant_id = ? AND source = 'cashapp' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) resolvedAccountId = accountId;
	}
	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'cashapp'
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
					VALUES (?, ?, 'cashapp', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions SET account_id = ?
			WHERE tenant_id = ? AND source = 'cashapp' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows SET account_id = ?
			WHERE tenant_id = ? AND source = 'cashapp' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	if (!rows.length) {
		return new Response(JSON.stringify({ error: 'No rows parsed from file.' }), { status: 400 });
	}

	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;

	for (const row of rows) {
		const timestampUtc = normalizeTimestamp(row['Date'] || '');
		if (!timestampUtc) continue;

		const txType = row['Transaction Type'] || '';
		const assetType = row['Asset Type'] || '';
		const classified = classifyTransaction(txType, assetType);
		if (!classified) continue;

		const { symbol, direction, kind } = classified;

		// Asset Amount: "0.00171018 BTC" — the crypto quantity
		const assetAmount = parseAmount(row['Asset Amount']);
		// Amount: "-$97.75" — USD side (negative = spent)
		const usdAmount = parseAmount(row['Amount']);
		// Fee: "-$2.25"
		const feeRaw = parseAmount(row['Fee']);
		const feeUsd = feeRaw !== null ? Math.abs(feeRaw) : null;
		// Asset Price: "$57,157.86" — price per unit
		const assetPrice = parseAmount(row['Asset Price']);

		// USD value of the trade = abs of USD amount, or derive from price × qty
		const nativeUsd =
			usdAmount !== null
				? Math.abs(usdAmount)
				: assetPrice !== null && assetAmount !== null
					? assetPrice * Math.abs(assetAmount)
					: null;

		const signedAmount =
			assetAmount !== null
				? direction === 'out'
					? -Math.abs(assetAmount)
					: Math.abs(assetAmount)
				: null;

		const normalized: NormalizedRow = {
			timestampUtc,
			description: txType,
			currency: symbol,
			amount: signedAmount,
			toCurrency: direction === 'in' ? '' : 'USD',
			toAmount: direction === 'out' && usdAmount !== null ? Math.abs(usdAmount) : null,
			nativeCurrency: 'USD',
			nativeAmount: nativeUsd,
			nativeUsd,
			kind,
			txHash: row['Transaction ID'] || null,
			direction,
			assetSymbol: symbol,
			feeUsd,
		};

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId(normalized.assetSymbol, normalized.timestampUtc);

		const rawResult = await db.execute({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, 'cashapp', ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(row), rowHash],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount,
				to_currency, to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction,
				asset_symbol, group_id, row_hash, fee_usd, created_at)
				VALUES (?, ?, 'cashapp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(), tenantId, resolvedAccountId, batchId,
				normalized.timestampUtc, normalized.description || null,
				normalized.currency || null, normalized.amount,
				normalized.toCurrency || null, normalized.toAmount,
				normalized.nativeCurrency || null, normalized.nativeAmount,
				normalized.nativeUsd, normalized.kind || null,
				normalized.txHash, normalized.direction,
				normalized.assetSymbol, groupId, rowHash, normalized.feeUsd,
			],
		});

		insertedRaw += rawResult.rowsAffected ?? 0;
		insertedNormalized += normalizedResult.rowsAffected ?? 0;
		if ((rawResult.rowsAffected ?? 0) === 0 && (normalizedResult.rowsAffected ?? 0) === 0) {
			skippedDuplicates += 1;
		}
	}

	void snapshotCexAccount(tenantId, resolvedAccountId, 'cashapp', 'Cash App');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'cashapp' });

	return new Response(
		JSON.stringify({ batchId, accountId: resolvedAccountId, insertedRaw, insertedNormalized, skippedDuplicates }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
