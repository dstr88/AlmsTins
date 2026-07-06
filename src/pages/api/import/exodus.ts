import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { snapshotCexAccount } from '@/lib/cexSnapshot';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { detectAndAlertBounces } from '@/lib/bounceDetector';
import { logActivity } from '@/lib/activityLog';

// Actual Exodus CSV columns (confirmed from real export):
// DATE, TYPE, FROMPORTFOLIO, TOPORTFOLIO,
// OUTAMOUNT, OUTCURRENCY, FEEAMOUNT, FEECURRENCY,
// FROMADDRESS, TOADDRESS,
// OUTTXID, OUTTXURL, INAMOUNT, INCURRENCY, INTXID, INTXURL,
// ORDERID, PERSONALNOTE

type CsvRow = Record<string, string>;

type NormalizedRow = {
	timestampUtc: string;
	description: string;
	currency: string | null;
	amount: number | null;
	toCurrency: string | null;
	toAmount: number | null;
	nativeCurrency: string | null;
	nativeAmount: number | null;
	nativeUsd: number | null;
	kind: string;
	txHash: string | null;
	direction: 'in' | 'out';
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
	const headers = rows.shift() ?? [];
	return rows.map((row) => {
		const record: CsvRow = {};
		headers.forEach((h, i) => { record[h.trim()] = (row[i] ?? '').trim(); });
		return record;
	});
};

const normalizeTimestamp = (value: string): string => {
	if (!value) return '';
	// Exodus exports ISO-8601: "2023-04-15T18:32:10.000Z"
	const hasTimezone = /z$|[+-]\d{2}:?\d{2}$/i.test(value);
	const normalized = hasTimezone ? value : `${value.replace(' ', 'T')}Z`;
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) return value;
	return date.toISOString();
};

const parseNumber = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const cleaned = value.replace(/[$,]/g, '');
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

const normalizeSymbol = (s: string): string => {
	const u = s.trim().toUpperCase();
	if (u === 'MATIC' || u === 'WMATIC') return 'POL';
	return u;
};

const buildRowHash = (source: string, row: NormalizedRow, suffix: string) => {
	const payload = JSON.stringify([
		source,
		row.timestampUtc,
		row.currency,
		row.amount ?? '',
		row.toCurrency ?? '',
		row.toAmount ?? '',
		row.kind,
		row.txHash ?? '',
		suffix,
	]);
	return createHash('sha256').update(payload).digest('hex');
};

const buildGroupId = (source: string, assetSymbol: string | null, timestampUtc: string) => {
	if (!assetSymbol) return null;
	const datePart = timestampUtc.slice(0, 10);
	const payload = `${source}:${assetSymbol}:${datePart}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
};

// Build one or two NormalizedRows from a single Exodus CSV row.
// 'exchange' type yields two rows (out leg + in leg).
const buildRows = (csvRow: CsvRow): NormalizedRow[] => {
	const ts = normalizeTimestamp(csvRow['DATE'] ?? '');
	if (!ts) return [];

	const type = (csvRow['TYPE'] ?? '').toLowerCase().trim();
	const outAmt    = parseNumber(csvRow['OUTAMOUNT']);
	const outCur    = normalizeSymbol(csvRow['OUTCURRENCY'] ?? '');
	const inAmt     = parseNumber(csvRow['INAMOUNT']);
	const inCur     = normalizeSymbol(csvRow['INCURRENCY'] ?? '');
	// Prefer the outgoing TX id, fall back to incoming
	const txId      = (csvRow['OUTTXID'] ?? csvRow['INTXID'] ?? '').trim() || null;

	const rows: NormalizedRow[] = [];

	if (type === 'exchange') {
		// Out leg: OUTCURRENCY leaving the wallet
		if (outAmt !== null && outCur) {
			rows.push({
				timestampUtc: ts,
				description: 'Exchange',
				currency: outCur,
				amount: -Math.abs(outAmt),
				toCurrency: inCur || null,
				toAmount: inAmt,
				nativeCurrency: null,
				nativeAmount: null,
				nativeUsd: null,
				kind: 'Exchange',
				txHash: txId,
				direction: 'out',
				assetSymbol: outCur || null,
			});
		}
		// In leg: INCURRENCY entering the wallet
		if (inAmt !== null && inCur) {
			rows.push({
				timestampUtc: ts,
				description: 'Exchange',
				currency: inCur,
				amount: Math.abs(inAmt),
				toCurrency: outCur || null,
				toAmount: outAmt,
				nativeCurrency: null,
				nativeAmount: null,
				nativeUsd: null,
				kind: 'Exchange',
				txHash: txId,
				direction: 'in',
				assetSymbol: inCur || null,
			});
		}
		return rows;
	}

	// received / deposit → in (uses INAMOUNT / INCURRENCY)
	if (type === 'received' || type === 'deposit') {
		if (inAmt !== null && inCur) {
			rows.push({
				timestampUtc: ts,
				description: type === 'deposit' ? 'Deposit' : 'Received',
				currency: inCur,
				amount: Math.abs(inAmt),
				toCurrency: null,
				toAmount: null,
				nativeCurrency: null,
				nativeAmount: null,
				nativeUsd: null,
				kind: type === 'deposit' ? 'Deposit' : 'Received',
				txHash: txId,
				direction: 'in',
				assetSymbol: inCur || null,
			});
		}
		return rows;
	}

	// sent / withdrawal → out (uses OUTAMOUNT / OUTCURRENCY)
	if (type === 'sent' || type === 'withdrawal') {
		if (outAmt !== null && outCur) {
			rows.push({
				timestampUtc: ts,
				description: type === 'withdrawal' ? 'Withdrawal' : 'Sent',
				currency: outCur,
				amount: -Math.abs(outAmt),
				toCurrency: null,
				toAmount: null,
				nativeCurrency: null,
				nativeAmount: null,
				nativeUsd: null,
				kind: type === 'withdrawal' ? 'Withdrawal' : 'Sent',
				txHash: txId,
				direction: 'out',
				assetSymbol: outCur || null,
			});
		}
		return rows;
	}

	// Fallback: use INAMOUNT if present (in), else OUTAMOUNT (out)
	if (inAmt !== null && inCur) {
		rows.push({
			timestampUtc: ts,
			description: csvRow['TYPE'] ?? '',
			currency: inCur,
			amount: Math.abs(inAmt),
			toCurrency: null,
			toAmount: null,
			nativeCurrency: null,
			nativeAmount: null,
			nativeUsd: null,
			kind: csvRow['TYPE'] ?? '',
			txHash: txId,
			direction: 'in',
			assetSymbol: inCur || null,
		});
	} else if (outAmt !== null && outCur) {
		rows.push({
			timestampUtc: ts,
			description: csvRow['TYPE'] ?? '',
			currency: outCur,
			amount: -Math.abs(outAmt),
			toCurrency: null,
			toAmount: null,
			nativeCurrency: null,
			nativeAmount: null,
			nativeUsd: null,
			kind: csvRow['TYPE'] ?? '',
			txHash: txId,
			direction: 'out',
			assetSymbol: outCur || null,
		});
	}

	return rows;
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
				WHERE id = ? AND tenant_id = ? AND source = 'exodus' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) resolvedAccountId = accountId;
	}

	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'exodus'
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
					VALUES (?, ?, 'exodus', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'exodus' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'exodus' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const csvRows = parseCsv(content);
	const batchId = randomUUID();

	type DbStatement = { sql: string; args: unknown[] };
	const rawStatements: DbStatement[] = [];
	const normStatements: DbStatement[] = [];

	for (const csvRow of csvRows) {
		const normalizedRows = buildRows(csvRow);
		const rawRowJson = JSON.stringify(csvRow);

		for (let i = 0; i < normalizedRows.length; i++) {
			const norm = normalizedRows[i];
			// Use a suffix to distinguish the two legs of an exchange row
			const suffix = normalizedRows.length > 1 ? String(i) : '';
			const rowHash = buildRowHash('exodus', norm, suffix);
			const groupId = buildGroupId('exodus', norm.assetSymbol, norm.timestampUtc);

			rawStatements.push({
				sql: `INSERT INTO import_raw_rows
					(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
				args: [randomUUID(), tenantId, 'exodus', resolvedAccountId, batchId, rawRowJson, rowHash],
			});

			normStatements.push({
				sql: `INSERT INTO import_transactions
					(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount,
					to_currency, to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction,
					asset_symbol, group_id, row_hash, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
				args: [
					randomUUID(), tenantId, 'exodus', resolvedAccountId, batchId,
					norm.timestampUtc, norm.description || null, norm.currency,
					norm.amount, norm.toCurrency, norm.toAmount,
					norm.nativeCurrency, norm.nativeAmount, norm.nativeUsd,
					norm.kind || null, norm.txHash, norm.direction,
					norm.assetSymbol, groupId, rowHash,
				],
			});
		}
	}

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

	const skippedDuplicates = rawStatements.length - insertedRaw;

	void snapshotCexAccount(tenantId, resolvedAccountId, 'exodus', 'Exodus');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'exodus' });

	return new Response(
		JSON.stringify({
			batchId,
			accountId: resolvedAccountId,
			insertedRaw,
			insertedNormalized,
			skippedDuplicates,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
