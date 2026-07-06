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
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return new Date(`${value}T00:00:00Z`).toISOString();
	}
	const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(value);
	const normalized = hasTimezone ? value : `${value.replace(' ', 'T')}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) return value;
	return date.toISOString();
};

const parseNumber = (value: string | null | undefined) => {
	if (!value) return null;
	const cleaned = value.replace(/[$,]/g, '');
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

const resolveDirection = (kind: string) => {
	const normalized = kind.toLowerCase();
	if (normalized.includes('sell')) return 'out' as const;
	return 'in' as const;
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
		'robinhood',
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
				WHERE id = ? AND tenant_id = ? AND source = 'robinhood' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) {
			resolvedAccountId = accountId;
		}
	}
	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'robinhood'
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
					VALUES (?, ?, 'robinhood', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'robinhood' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'robinhood' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	const batchId = randomUUID();
	let insertedRaw = 0;
	let insertedNormalized = 0;
	let skippedDuplicates = 0;

	for (const row of rows) {
		const timestampUtc = normalizeTimestamp(row['Date'] || '');
		if (!timestampUtc) continue;
		const kind = row['Transaction'] || '';
		const direction = resolveDirection(kind);
		const quantity = parseNumber(row['Quantity']);
		const signedAmount =
			quantity === null ? null : direction === 'out' ? -Math.abs(quantity) : Math.abs(quantity);
		const totalUsd = parseNumber(row['Amount']);
		const normalized: NormalizedRow = {
			timestampUtc,
			description: row['Transaction'] || '',
			currency: row['Symbol'] || '',
			amount: signedAmount,
			toCurrency: '',
			toAmount: null,
			nativeCurrency: 'USD',
			nativeAmount: totalUsd,
			nativeUsd: totalUsd,
			kind: kind,
			txHash: null,
			direction,
			assetSymbol: row['Symbol'] || null,
		};

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId('robinhood', normalized.assetSymbol, normalized.timestampUtc);
		const rawResult = await db.execute({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				'robinhood',
				resolvedAccountId,
				batchId,
				JSON.stringify(row),
				rowHash,
			],
		});

		const normalizedResult = await db.execute({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount, to_currency,
				to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, group_id, row_hash, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				'robinhood',
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
			],
		});

		insertedRaw += rawResult.rowsAffected ?? 0;
		insertedNormalized += normalizedResult.rowsAffected ?? 0;
		if ((rawResult.rowsAffected ?? 0) === 0 && (normalizedResult.rowsAffected ?? 0) === 0) {
			skippedDuplicates += 1;
		}
	}

	void snapshotCexAccount(tenantId, resolvedAccountId, 'robinhood', 'Robinhood');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'robinhood' });

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
