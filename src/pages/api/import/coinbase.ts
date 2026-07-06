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

// Strip Coinbase's preamble lines (e.g. "Transactions", "User,Name,UUID")
// so that parseCsv receives a clean CSV starting at the real header row.
const stripCoinbasePreamble = (input: string): string => {
	const lines = input.split(/\r?\n/);
	// The real header row contains both 'Timestamp' and 'Transaction Type'
	const headerIdx = lines.findIndex(
		(line) => line.includes('Timestamp') && line.includes('Transaction Type'),
	);
	if (headerIdx <= 0) return input; // no preamble found, leave as-is
	return lines.slice(headerIdx).join('\n');
};

const parseCsv = (input: string): CsvRow[] => {
	const cleaned = stripCoinbasePreamble(input);
	const rows: string[][] = [];
	let current: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < cleaned.length; i += 1) {
		const char = cleaned[i];
		const next = cleaned[i + 1];

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
	const cleaned = value.replace(/[$,]/g, '');
	const num = Number(cleaned);
	return Number.isFinite(num) ? num : null;
};

// Coinbase already puts a negative sign on every outflow (sends, converts,
// withdrawals, the "-" leg of staking-transfer pairs, etc.).
// Use the quantity sign as the primary signal; fall back to keyword matching
// only for "sell" rows that may have inconsistent signs.
const resolveDirection = (kind: string, quantity: number | null): 'in' | 'out' => {
	const normalized = kind.toLowerCase();
	// Explicit sell keyword → always out
	if (normalized.includes('sell')) return 'out';
	// Negative quantity → outflow (send, withdrawal, convert-from, staking-out leg, etc.)
	if (quantity !== null && quantity < 0) return 'out';
	return 'in';
};

const buildRowHash = (row: NormalizedRow) => {
	const payload = JSON.stringify([
		'coinbase',
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

	// If an accountId was provided, verify it exists for this tenant/source.
	// If it doesn't match (e.g. stale page after a delete), fall through and
	// pick the first existing account or create one — same as the no-ID path.
	if (accountId) {
		const accountResult = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE id = ? AND tenant_id = ? AND source = 'coinbase' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (accountResult.rows?.length) {
			resolvedAccountId = accountId;
		}
	}

	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts
				WHERE tenant_id = ? AND source = 'coinbase'
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
					VALUES (?, ?, 'coinbase', ?)`,
				args: [newId, tenantId, 'Account #1'],
			});
			resolvedAccountId = newId;
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'coinbase' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows
			SET account_id = ?
			WHERE tenant_id = ? AND source = 'coinbase' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	const content = await file.text();
	const rows = parseCsv(content);
	const batchId = randomUUID();

	type DbStatement = { sql: string; args: unknown[] };
	const rawStatements: DbStatement[] = [];
	const normStatements: DbStatement[] = [];

	for (const row of rows) {
		const timestampUtc = normalizeTimestamp(row['Timestamp'] || '');
		if (!timestampUtc) continue;
		const kind = row['Transaction Type'] || '';
		const kindLower = kind.toLowerCase();
		const quantity = parseNumber(row['Quantity Transacted']);

		// ── Coinbase staking custody rows ────────────────────────────────────────
		// Coinbase records staking movements as paired +/- rows that net to zero.
		// Retail Staking Transfer: the POSITIVE row is the asset entering staking
		// custody; skip the negative (internal debit).
		// Retail Unstaking Transfer: the POSITIVE row is the asset returning to the
		// liquid wallet; skip the negative (internal staking-pool debit).
		// Both positive legs are stored so computeHoldings can separate liquid vs
		// staked balances using the kind field.
		if (kindLower.includes('retail unstaking transfer')) {
			if (quantity === null || quantity <= 0) continue; // skip negative/zero leg
			// fall through — positive leg is the asset returning from staking to liquid
		}
		if (kindLower.includes('retail staking transfer')) {
			if (quantity === null || quantity <= 0) continue; // skip negative/zero leg
			// fall through — positive leg is the asset entering staking custody
		}

		const direction = resolveDirection(kind, quantity);
		const signedAmount =
			quantity === null ? null : direction === 'out' ? -Math.abs(quantity) : Math.abs(quantity);
		const totalUsd = parseNumber(row['Total (inclusive of fees and/or spread)']);
		const normalized: NormalizedRow = {
			timestampUtc,
			description: row['Notes'] || row['Transaction Type'] || '',
			currency: row['Asset'] || '',
			amount: signedAmount,
			toCurrency: '',
			toAmount: null,
			nativeCurrency: 'USD',
			nativeAmount: totalUsd,
			nativeUsd: totalUsd,
			kind: kind,
			txHash: null,
			direction,
			assetSymbol: row['Asset'] || null,
		};

		const rowHash = buildRowHash(normalized);
		const groupId = buildGroupId('coinbase', normalized.assetSymbol, normalized.timestampUtc);

		rawStatements.push({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, 'coinbase', resolvedAccountId, batchId, JSON.stringify(row), rowHash],
		});

		normStatements.push({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description, currency, amount, to_currency,
				to_amount, native_currency, native_amount, native_usd, kind, tx_hash, direction, asset_symbol, group_id, row_hash, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(), tenantId, 'coinbase', resolvedAccountId, batchId,
				normalized.timestampUtc, normalized.description || null, normalized.currency || null,
				normalized.amount, normalized.toCurrency || null, normalized.toAmount,
				normalized.nativeCurrency || null, normalized.nativeAmount, normalized.nativeUsd,
				normalized.kind || null, normalized.txHash, normalized.direction,
				normalized.assetSymbol, groupId, rowHash,
			],
		});
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

	const skippedDuplicates = rawStatements.length - insertedRaw;

	void snapshotCexAccount(tenantId, resolvedAccountId, 'coinbase', 'Coinbase');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'coinbase' });

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
