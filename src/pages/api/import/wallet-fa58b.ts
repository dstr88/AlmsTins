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

const FIAT = new Set(['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'HKD', 'JPY', 'CNY', 'CHF', 'NZD']);

const isFiat = (symbol: string) => FIAT.has(symbol.toUpperCase());

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
	if (row.toCurrency && !toCurrencyIsFiat) {
		return { direction: 'in' as const, assetSymbol: row.toCurrency };
	}
	if (row.currency && !currencyIsFiat) {
		return { direction: 'out' as const, assetSymbol: row.currency };
	}

	return {
		direction: amountNeg ? ('out' as const) : ('in' as const),
		assetSymbol: row.toCurrency || row.currency || null,
	};
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
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

	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file upload.' }), { status: 400 });
	}

	const content = await file.text();
	const rows = parseCsv(content);
	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;
	const source = 'wallet_fa58b';

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

		const { direction, assetSymbol } = detectDirection(normalized);
		normalized.direction = direction;
		normalized.assetSymbol = assetSymbol;

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId(source, normalized.assetSymbol, normalized.timestampUtc);
		const rawResult = await db.execute({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, source, batchId, JSON.stringify(row), rowHash],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, import_batch_id, timestamp_utc, description, currency, amount, to_currency,
				to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, group_id, row_hash, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				source,
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
			],
		});

		insertedRaw += rawResult.rowsAffected ?? 0;
		insertedNormalized += normalizedResult.rowsAffected ?? 0;
		if ((rawResult.rowsAffected ?? 0) === 0 && (normalizedResult.rowsAffected ?? 0) === 0) {
			skippedDuplicates += 1;
		}
	}

	return new Response(
		JSON.stringify({
			batchId,
			insertedRaw,
			insertedNormalized,
			skippedDuplicates,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
};
