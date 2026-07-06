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
	const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(value);
	const normalized = hasTimezone ? value : `${value.replace(' ', 'T')}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) return value;
	return date.toISOString();
};

const parseNumber = (value: string | null | undefined) => {
	if (!value) return null;
	const cleaned = value.replace(/,/g, '');
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

// Treat stablecoins the same as fiat for direction detection —
// we don't want phantom stablecoin balances showing up as holdings.
const FIAT_OR_STABLE = new Set([
	// Traditional fiat
	'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'HKD', 'JPY', 'CNY', 'CHF', 'NZD',
	// USD-pegged stablecoins commonly used on Crypto.com
	'USDT', 'USDC', 'TUSD', 'USDM', 'BUSD', 'DAI', 'USDD', 'USDP', 'GUSD', 'PYUSD',
	'FRAX', 'LUSD', 'SUSD', 'HUSD', 'CUSD', 'CEUR', 'USDB',
]);

const isFiat = (symbol: string) => FIAT_OR_STABLE.has(symbol.toUpperCase());

const detectDirection = (row: NormalizedRow) => {
	const description = row.description.toLowerCase();
	const kind = row.kind.toLowerCase();
	const hasBridgeWrongChain = description.includes('bridge') && description.includes('wrong chain');
	const isLost =
		description.includes('lost') ||
		kind.includes('lost') ||
		description.includes('burn') ||
		kind.includes('burn') ||
		hasBridgeWrongChain;
	if (isLost) {
		return {
			direction: 'lost' as const,
			assetSymbol: row.currency || row.toCurrency || null,
		};
	}

	const amount = row.amount ?? 0;
	const toAmount = row.toAmount ?? 0;
	const currencyIsFiat = row.currency ? isFiat(row.currency) : false;
	const toCurrencyIsFiat = row.toCurrency ? isFiat(row.toCurrency) : false;
	const amountNeg = amount < 0;
	const toAmountPos = toAmount > 0;

	if (currencyIsFiat && amountNeg && row.toCurrency && !toCurrencyIsFiat && toAmountPos) {
		return { direction: 'in' as const, assetSymbol: row.toCurrency };
	}
	if (!currencyIsFiat && row.currency && amountNeg && toCurrencyIsFiat && toAmountPos) {
		return { direction: 'out' as const, assetSymbol: row.currency };
	}
	// Only treat to_currency as 'in' when to_amount is non-negative.
	// A negative to_amount means the asset was debited (e.g. crypto_payment where both
	// currency and to_currency are the same crypto with negative amounts — a merchant payment).
	if (row.toCurrency && !toCurrencyIsFiat && !(toAmount < 0)) {
		return { direction: 'in' as const, assetSymbol: row.toCurrency };
	}
	// Single-asset row (reward, deposit, withdrawal, cashback, etc.) — use amount sign.
	// A positive amount means the asset was received ('in'); negative means sent ('out').
	if (row.currency && !currencyIsFiat) {
		return {
			direction: amountNeg ? ('out' as const) : ('in' as const),
			assetSymbol: row.currency,
		};
	}

	// Fallback — only record if the resolved symbol is a real crypto asset.
	// Pure fiat/stablecoin-only rows (e.g. crypto_deposit USDC with no toCurrency)
	// must be skipped so they don't create phantom stablecoin balances.
	const fallbackSym = row.toCurrency || row.currency || null;
	if (!fallbackSym || isFiat(fallbackSym)) {
		return { direction: 'in' as const, assetSymbol: null };
	}

	return {
		direction: amountNeg ? ('out' as const) : ('in' as const),
		assetSymbol: fallbackSym,
	};
};

// leg: '' for normal rows, 'out'/'in' for the two legs of a crypto↔crypto swap
const buildRowHash = (row: NormalizedRow, leg = '') => {
	const payload = JSON.stringify([
		'crypto_com',
		row.timestampUtc,
		row.description,
		row.currency,
		row.amount ?? '',
		row.toCurrency,
		row.toAmount ?? '',
		row.kind,
		row.txHash ?? '',
		leg,
	]);
	return createHash('sha256').update(payload).digest('hex');
};

const buildGroupId = (source: string, assetSymbol: string | null, timestampUtc: string) => {
	if (!assetSymbol) return null;
	const datePart = timestampUtc.slice(0, 10);
	const payload = `${source}:${assetSymbol}:${datePart}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
};

export const POST: APIRoute = async ({ request, locals }) => {
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
				WHERE id = ? AND tenant_id = ? AND source = 'crypto_com' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) {
			resolvedAccountId = accountId;
		}
	}
	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'crypto_com'
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
					VALUES (?, ?, 'crypto_com', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'crypto_com' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'crypto_com' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	const batchId = randomUUID();

	type DbStatement = { sql: string; args: unknown[] };
	const rawStatements: DbStatement[] = [];
	const normStatements: DbStatement[] = [];
	let skippedFiatRows = 0;

	// Build a statement object for one normalized row (no await — collected for batch execution)
	const buildNormStatement = (norm: NormalizedRow, leg = ''): DbStatement => {
		const rowHash = buildRowHash(norm, leg);
		const groupId = buildGroupId('crypto_com', norm.assetSymbol, norm.timestampUtc);
		return {
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount, to_currency,
				to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, group_id, row_hash, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(), tenantId, 'crypto_com', resolvedAccountId, batchId,
				norm.timestampUtc, norm.description || null, norm.currency || null,
				norm.amount, norm.toCurrency || null, norm.toAmount,
				norm.nativeCurrency || null, norm.nativeAmount, norm.nativeUsd,
				norm.kind || null, norm.txHash, norm.direction, norm.assetSymbol,
				groupId, rowHash,
			],
		};
	};

	for (const row of rows) {
		const timestampUtc = normalizeTimestamp(row['Timestamp (UTC)'] || '');
		if (!timestampUtc) continue;
		const normalized: NormalizedRow = {
			timestampUtc,
			description: row['Transaction Description'] || '',
			currency: row['Currency'] || '',
			amount: parseNumber(row['Amount']),
			toCurrency: row['To Currency'] || '',
			toAmount: parseNumber(row['To Amount']),
			nativeCurrency: row['Native Currency'] || '',
			nativeAmount: parseNumber(row['Native Amount']),
			nativeUsd: parseNumber(row['Native Amount (in USD)']),
			kind: row['Transaction Kind'] || '',
			txHash: row['Transaction Hash']?.trim() || null,
			direction: 'in',
			assetSymbol: null,
		};

		// Raw row — queue one statement per CSV row
		const rawHash = buildRowHash(normalized, '');
		rawStatements.push({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, 'crypto_com', resolvedAccountId, batchId, JSON.stringify(row), rawHash],
		});

		// Crypto↔crypto swap: both sides are real (non-stable) assets.
		// Queue two normalized rows — one 'out' for the sold asset, one 'in' for the received asset —
		// so both sides of the trade affect the correct balances.
		const isCryptoCryptoSwap =
			normalized.currency && !isFiat(normalized.currency) &&
			normalized.toCurrency && !isFiat(normalized.toCurrency) &&
			(normalized.amount ?? 0) < 0 &&
			(normalized.toAmount ?? 0) > 0;

		if (isCryptoCryptoSwap) {
			// OUT leg: the asset being sold
			normStatements.push(buildNormStatement(
				{ ...normalized, direction: 'out', assetSymbol: normalized.currency },
				'out',
			));
			// IN leg: the asset being received
			normStatements.push(buildNormStatement(
				{
					...normalized,
					direction: 'in',
					assetSymbol: normalized.toCurrency,
					currency: normalized.toCurrency,
					amount: normalized.toAmount,
					toCurrency: '',
					toAmount: null,
				},
				'in',
			));
		} else {
			const { direction, assetSymbol } = detectDirection(normalized);
			if (assetSymbol) {
				normStatements.push(buildNormStatement({ ...normalized, direction, assetSymbol }));
			} else {
				skippedFiatRows += 1; // pure fiat/stable row — nothing to track
			}
		}
	}

	// Execute all statements in batches of 100 to avoid Render request timeouts.
	// db.batch() sends each chunk as a single HTTP round-trip to Turso.
	const BATCH_SIZE = 100;
	let insertedRaw = 0;
	let insertedNormalized = 0;

	for (let i = 0; i < rawStatements.length; i += BATCH_SIZE) {
		const results = await db.batch(rawStatements.slice(i, i + BATCH_SIZE), 'write');
		insertedRaw += results.reduce((sum, r) => sum + (r.rowsAffected ?? 0), 0);
	}
	for (let i = 0; i < normStatements.length; i += BATCH_SIZE) {
		const results = await db.batch(normStatements.slice(i, i + BATCH_SIZE), 'write');
		insertedNormalized += results.reduce((sum, r) => sum + (r.rowsAffected ?? 0), 0);
	}

	const skippedDuplicates = (rawStatements.length - insertedRaw) + skippedFiatRows;

	void snapshotCexAccount(tenantId, resolvedAccountId, 'crypto_com', 'Crypto.com');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'crypto_com' });

	return new Response(
		JSON.stringify({
			batchId,
			accountId: resolvedAccountId,
			insertedRaw,
			insertedNormalized,
			skippedDuplicates,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
};
