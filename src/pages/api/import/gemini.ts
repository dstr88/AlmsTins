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
			if (char === '\r' && next === '\n') {
				i += 1;
			}
			current.push(field.trim());
			field = '';
			if (current.length > 1 || current.some((value) => value !== '')) {
				rows.push(current);
			}
			current = [];
			continue;
		}

		field += char;
	}

	if (field.length || current.length) {
		current.push(field.trim());
		if (current.length > 1 || current.some((value) => value !== '')) {
			rows.push(current);
		}
	}

	if (!rows.length) return [];

	// Gemini CSVs exported from Google Sheets have a title row (e.g. "Untitled spreadsheet - Sheet1")
	// before the actual headers. Skip any leading rows that aren't real headers
	// (real header row has "Date" and "Type" as the first two fields).
	while (rows.length && !(rows[0][0] === 'Date' && rows[0][2] === 'Type')) {
		rows.shift();
	}

	const headers = rows.shift() ?? [];

	return rows.map((row) => {
		const record: CsvRow = {};
		headers.forEach((header, index) => {
			// Unnamed columns (extra asset columns Gemini adds but doesn't label)
			// get synthetic keys so they don't overwrite each other
			const key = header || `_col_${index}`;
			record[key] = (row[index] ?? '').trim();
		});
		return record;
	});
};

const normalizeTimestamp = (date: string, time: string) => {
	if (!date) return '';
	const combined = time ? `${date}T${time}Z` : `${date}T00:00:00Z`;
	const d = new Date(combined);
	if (Number.isNaN(d.getTime())) return '';
	return d.toISOString();
};

// Parse Gemini amount values which may look like:
//   "0.0155391 BTC"   → 0.0155391
//   "(0.0155391 BTC)" → -0.0155391  (parentheses = negative)
//   "($177.01)"       → -177.01
//   "$180.00"         → 180.00
//   "$3,500.00"       → 3500.00
//   "0.0 BTC"         → 0
const parseGeminiAmount = (value: string | null | undefined): number | null => {
	if (!value || value.trim() === '') return null;
	const isNegative = value.includes('(');
	// Strip parentheses, $, commas, then strip trailing alpha units (BTC, ETH, LINK, etc.)
	const cleaned = value
		.replace(/[()$,]/g, '')
		.replace(/\s*[A-Z]+\s*$/, '')
		.trim();
	const num = Number(cleaned);
	if (!Number.isFinite(num) || cleaned === '') return null;
	return isNegative ? -Math.abs(num) : Math.abs(num);
};

// Given a trading pair symbol like BTCUSD, ETHUSD, SOLETH, return base + quote
const splitPair = (symbol: string): { base: string; quote: string } => {
	const s = symbol.toUpperCase().trim();
	// Known quote currencies
	for (const quote of ['USD', 'ETH', 'BTC', 'USDT', 'USDC']) {
		if (s.endsWith(quote) && s.length > quote.length) {
			return { base: s.slice(0, -quote.length), quote };
		}
	}
	// Single asset (BTC, ETH, LINK, MATIC, SOL, USD)
	return { base: s, quote: '' };
};

// Find the transaction amount for a given asset symbol.
// Gemini's CSV has one named column "BTC Amount BTC" (col 10), but for non-BTC assets
// (ETH, SOL, LINK, MATIC) it reuses the same positional slot with the value including
// the asset name, e.g. "0.028939 ETH". Additional assets are in unnamed extra columns.
// Strategy: scan all field values for one that ends with the target symbol and is non-zero.
const getAssetAmount = (row: CsvRow, assetSymbol: string): number | null => {
	const sym = assetSymbol.toUpperCase();
	// First try the named column (works for BTC)
	const namedVal = row[`${sym} Amount ${sym}`];
	if (namedVal) {
		const n = parseGeminiAmount(namedVal);
		if (n !== null) return n;
	}
	// Fallback: scan all fields for a value that ends with this symbol
	// e.g. "0.028939 ETH" or "(0.423628328 SOL)"
	for (const value of Object.values(row)) {
		if (!value || value === '0.0' || value === '0') continue;
		const stripped = value.replace(/[()$, ]/g, '').toUpperCase();
		if (stripped.endsWith(sym) && /\d/.test(stripped)) {
			const n = parseGeminiAmount(value);
			if (n !== null && n !== 0) return n;
		}
	}
	// Last resort: col 10 ("BTC Amount BTC") which Gemini overloads for all assets
	const btcCol = row['BTC Amount BTC'];
	if (btcCol) return parseGeminiAmount(btcCol);
	return null;
};

// Find a transaction hash anywhere in the row (Gemini shifts columns for non-BTC assets)
const findTxHash = (row: CsvRow): string | null => {
	// Try the named column first
	const named = row['Tx Hash'];
	if (named && named.length > 20) return named;
	// Scan all fields for hex hashes (ETH/BTC) or base58 (Solana)
	for (const value of Object.values(row)) {
		if (!value) continue;
		if (/^[a-fA-F0-9]{40,}$/.test(value)) return value;   // ETH/BTC hex
		if (/^[1-9A-HJ-NP-Za-km-z]{44,}$/.test(value)) return value; // Solana base58
	}
	return null;
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
		'gemini',
		row.timestampUtc,
		row.description,
		row.currency,
		row.amount ?? '',
		row.toCurrency,
		row.toAmount ?? '',
		row.kind,
		row.txHash ?? '',
	]);
	return createHash('sha256').update(payload).digest('hex');
};

const buildGroupId = (source: string, assetSymbol: string | null, timestampUtc: string) => {
	if (!assetSymbol) return null;
	const datePart = timestampUtc.slice(0, 10);
	const payload = `${source}:${assetSymbol}:${datePart}`;
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
				WHERE id = ? AND tenant_id = ? AND source = 'gemini' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) {
			resolvedAccountId = accountId;
		}
	}
	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'gemini'
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
					VALUES (?, ?, 'gemini', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'gemini' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'gemini' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;
	let skippedFiat = 0;

	for (const row of rows) {
		const txType = (row['Type'] || '').trim();      // Credit | Buy | Debit
		const symbol = (row['Symbol'] || '').trim();    // USD | BTCUSD | BTC | SOLETH | …
		const spec = (row['Specification'] || '').trim();
		const txHash = findTxHash(row);

		// Skip pure fiat rows — USD deposits/withdrawals are not crypto events
		if (symbol === 'USD') {
			skippedFiat += 1;
			continue;
		}

		const timestampUtc = normalizeTimestamp(row['Date'] || '', row['Time (UTC)'] || '');
		if (!timestampUtc) continue;

		const { base, quote } = splitPair(symbol);
		// USD Amount column — skip if it contains a crypto symbol (some rows misplace crypto amounts here)
		const rawUsdAmount = row['USD Amount USD'] || '';
		const usdAmount = /[A-Za-z]{2,}/.test(rawUsdAmount) ? null : parseGeminiAmount(rawUsdAmount);
		const feeUsd = parseGeminiAmount(row['Fee (USD) USD']);

		let kind: string;
		let direction: 'in' | 'out';
		let currency: string;
		let amount: number | null;
		let toCurrency = '';
		let toAmount: number | null = null;
		let nativeUsd: number | null = null;

		if (txType === 'Buy') {
			// Buying base asset with quote (USD or ETH)
			const baseAmt = getAssetAmount(row, base);

			if (quote === 'USD') {
				// Standard fiat purchase — e.g. BTCUSD, ETHUSD, LINKUSD, MATICUSD
				kind = 'crypto_purchase';
				direction = 'in';
				currency = base;
				amount = baseAmt !== null ? Math.abs(baseAmt) : null;
				nativeUsd = usdAmount !== null ? Math.abs(usdAmount) : null;
			} else {
				// Crypto-to-crypto swap — e.g. SOLETH (pay ETH, receive SOL)
				const quoteAmt = getAssetAmount(row, quote);
				kind = 'crypto_exchange';
				direction = 'in';
				currency = base;
				amount = baseAmt !== null ? Math.abs(baseAmt) : null;
				toCurrency = quote;
				toAmount = quoteAmt !== null ? -Math.abs(quoteAmt) : null; // ETH spent (negative)
				nativeUsd = usdAmount !== null ? Math.abs(usdAmount) : null;
			}
		} else if (txType === 'Debit') {
			// Withdrawal of crypto to external address
			const assetAmt = getAssetAmount(row, base);
			kind = 'crypto_withdrawal';
			direction = 'out';
			currency = base;
			amount = assetAmt !== null ? -Math.abs(assetAmt) : null;
			nativeUsd = usdAmount !== null ? Math.abs(usdAmount) : null;
		} else if (txType === 'Credit') {
			// Incoming crypto — deposits, staking rewards, earn/interest, airdrops, etc.
			const assetAmt = getAssetAmount(row, base);
			direction = 'in';
			currency = base;
			amount = assetAmt !== null ? Math.abs(assetAmt) : null;
			nativeUsd = usdAmount !== null ? Math.abs(usdAmount) : null;

			// Map Gemini's Specification field to the canonical kind values used
			// elsewhere in the app so staking income, airdrops, etc. are handled
			// correctly (e.g. staking income must NOT reset the holding-period clock).
			const specLower = spec.toLowerCase();
			if (specLower.includes('staking') || specLower.includes('stake')) {
				kind = 'staking income';
			} else if (specLower.includes('airdrop')) {
				kind = 'airdrop';
			} else if (
				specLower.includes('interest') ||
				specLower.includes('earn') ||
				specLower.includes('reward') ||
				specLower.includes('learning')
			) {
				kind = 'learning reward';
			} else if (specLower.includes('deposit') || specLower.includes('transfer')) {
				kind = 'crypto_deposit';
			} else {
				kind = 'credit';
			}
		} else {
			// Unknown type — skip
			continue;
		}

		const normalizedRow: NormalizedRow = {
			timestampUtc,
			description: spec || txType,
			currency,
			amount,
			toCurrency,
			toAmount,
			nativeCurrency: 'USD',
			nativeAmount: nativeUsd,
			nativeUsd,
			kind,
			txHash,
			direction,
			assetSymbol: currency || null,
		};

		const rowHash = buildRowHash(normalizedRow);
		const groupId = buildGroupId('gemini', normalizedRow.assetSymbol, normalizedRow.timestampUtc);

		const rawResult = await db.execute({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				'gemini',
				resolvedAccountId,
				batchId,
				JSON.stringify(row),
				rowHash,
			],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount, to_currency,
				to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, group_id, row_hash,
				fee_usd, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				'gemini',
				resolvedAccountId,
				batchId,
				normalizedRow.timestampUtc,
				normalizedRow.description || null,
				normalizedRow.currency || null,
				normalizedRow.amount,
				normalizedRow.toCurrency || null,
				normalizedRow.toAmount,
				normalizedRow.nativeCurrency || null,
				normalizedRow.nativeAmount,
				normalizedRow.nativeUsd,
				normalizedRow.kind || null,
				normalizedRow.txHash,
				normalizedRow.direction,
				normalizedRow.assetSymbol,
				groupId,
				rowHash,
				feeUsd !== null ? Math.abs(feeUsd) : null,
			],
		});

		insertedRaw += rawResult.rowsAffected ?? 0;
		insertedNormalized += normalizedResult.rowsAffected ?? 0;
		if ((rawResult.rowsAffected ?? 0) === 0 && (normalizedResult.rowsAffected ?? 0) === 0) {
			skippedDuplicates += 1;
		}
	}

	void snapshotCexAccount(tenantId, resolvedAccountId, 'gemini', 'Gemini');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'gemini' });

	return new Response(
		JSON.stringify({
			batchId,
			accountId: resolvedAccountId,
			insertedRaw,
			insertedNormalized,
			skippedDuplicates,
			skippedFiat,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
