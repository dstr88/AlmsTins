/**
 * POST /api/import/snowtrace
 *
 * Ingests an Avalanche C-Chain transaction export from Snowtrace
 * (https://snowtrace.io → address page → download CSV button).
 *
 * Snowtrace wraps the CSV in a ZIP file (despite the .csv extension).
 * The ZIP is extracted before parsing — see detect.ts which handles
 * the decompression step before reaching this endpoint.
 *
 * CSV columns:
 *   Transaction Hash, Blockno, UnixTimestamp, DateTime (UTC), From, To,
 *   ContractAddress, Value_IN(AVAX), Value_OUT(AVAX), CurrentValue/AVAX,
 *   TxnFee(AVAX), TxnFee(USD), Historical $Price/AVAX, Status, ErrCode,
 *   Method, ChainId, Chain, Value(AVAX)
 */

import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { snapshotCexAccount } from '@/lib/cexSnapshot';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { detectAndAlertBounces } from '@/lib/bounceDetector';
import { logActivity } from '@/lib/activityLog';

type CsvRow = Record<string, string>;

// ── CSV parser ────────────────────────────────────────────────────────────────

// ── ZIP extraction ────────────────────────────────────────────────────────────
// Snowtrace exports a ZIP file (PK header) despite naming it .csv.

function extractCsvFromZip(buf: Buffer): string | null {
  if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) return null;
  try {
    const compression    = buf.readUInt16LE(8);
    const compressedSize = buf.readUInt32LE(18);
    const filenameLen    = buf.readUInt16LE(26);
    const extraLen       = buf.readUInt16LE(28);
    const dataOffset     = 30 + filenameLen + extraLen;
    if (compression === 0) return buf.slice(dataOffset).toString('utf-8');
    if (compression === 8) {
      return inflateRawSync(buf.slice(dataOffset, dataOffset + compressedSize)).toString('utf-8');
    }
  } catch { /* fall through */ }
  return null;
}

// Snowtrace exports TSV (tab-separated) despite the .csv extension.
// This parser auto-detects the delimiter from the header line.
const parseCsv = (input: string): CsvRow[] => {
	const stripped = input.replace(/^\uFEFF/, '');   // strip BOM
	const firstLine = stripped.split('\n')[0] ?? '';
	const delimiter = firstLine.includes('\t') ? '\t' : ',';

	const rows: string[][] = [];
	let current: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < stripped.length; i++) {
		const char = stripped[i];
		const next = stripped[i + 1];

		if (char === '"') {
			if (inQuotes && next === '"') { field += '"'; i++; }
			else { inQuotes = !inQuotes; }
			continue;
		}
		if (char === delimiter && !inQuotes) {
			current.push(field.trim()); field = ''; continue;
		}
		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && next === '\n') i++;
			current.push(field.trim()); field = '';
			if (current.length > 1 || current.some(v => v !== '')) rows.push(current);
			current = []; continue;
		}
		field += char;
	}
	if (field.length || current.length) {
		current.push(field.trim());
		if (current.length > 1 || current.some(v => v !== '')) rows.push(current);
	}
	if (!rows.length) return [];
	const headers = rows.shift() ?? [];
	return rows.map(row => {
		const record: CsvRow = {};
		headers.forEach((h, i) => { record[h] = (row[i] ?? '').trim(); });
		return record;
	});
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseNum = (v: string): number | null => {
	if (!v || v === '') return null;
	const n = Number(v.replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
};

const normalizeTimestamp = (v: string): string => {
	if (!v) return '';
	// Snowtrace format: ISO 8601 "2025-11-25T05:07:39.000Z"
	// Also handle space-separated "2025-09-12 23:44:28" variants just in case
	const iso = v.includes('T') ? v : v.replace(' ', 'T') + 'Z';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? v : d.toISOString();
};

// ── Infer the user's own wallet address from the data ─────────────────────────
// For IN rows the user's address appears in "To"; for OUT rows in "From".

function inferWalletAddress(rows: CsvRow[]): string {
	const freq: Record<string, number> = {};
	for (const row of rows) {
		const inAmt  = parseNum(row['Value_IN(AVAX)']  ?? '');
		const outAmt = parseNum(row['Value_OUT(AVAX)'] ?? '');
		if (inAmt && inAmt > 0) {
			const addr = (row['To'] ?? '').toLowerCase();
			if (addr) freq[addr] = (freq[addr] ?? 0) + 1;
		}
		if (outAmt && outAmt > 0) {
			const addr = (row['From'] ?? '').toLowerCase();
			if (addr) freq[addr] = (freq[addr] ?? 0) + 1;
		}
	}
	const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
	return sorted[0]?.[0] ?? '';
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}
	const { tenantId } = session;

	const formData   = await request.formData();
	const fileField  = formData.get('file');
	const accountIdRaw = formData.get('accountId');

	if (!(fileField instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file upload.' }), { status: 400 });
	}

	// Snowtrace wraps the CSV in a ZIP file. Decompress if needed.
	const buf = Buffer.from(await fileField.arrayBuffer());
	const content = extractCsvFromZip(buf) ?? buf.toString('utf-8');

	const csvRows = parseCsv(content);

	if (!csvRows.length) {
		return new Response(JSON.stringify({
			error: 'No rows found. Make sure you downloaded the full CSV from Snowtrace without a date filter.',
		}), { status: 400 });
	}

	// Validate format
	const sample = csvRows[0];
	if (!('Transaction Hash' in sample) || !('Value_IN(AVAX)' in sample)) {
		return new Response(JSON.stringify({
			error: 'This does not look like a Snowtrace C-Chain CSV. Download from snowtrace.io → your address → the CSV export button.',
		}), { status: 400 });
	}

	// ── Resolve / create exchange account ────────────────────────────────────

	const walletAddress  = inferWalletAddress(csvRows);
	const accountId      = typeof accountIdRaw === 'string' ? accountIdRaw.trim() : '';
	let resolvedAccountId = '';

	if (accountId) {
		const res = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE id = ? AND tenant_id = ? AND source = 'avalanche_cchain' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (res.rows?.length) resolvedAccountId = accountId;
	}

	if (!resolvedAccountId) {
		// Match by wallet address if we've seen this wallet before
		if (walletAddress) {
			const res = await db.execute({
				sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'avalanche_cchain' AND lower(name) = ? LIMIT 1`,
				args: [tenantId, walletAddress],
			});
			if (res.rows?.length) resolvedAccountId = String(res.rows[0].id ?? '');
		}

		if (!resolvedAccountId) {
			const existing = await db.execute({
				sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'avalanche_cchain' ORDER BY created_at ASC LIMIT 1`,
				args: [tenantId],
			});
			const existingId = String(existing.rows?.[0]?.id ?? '');
			if (existingId) {
				resolvedAccountId = existingId;
			} else {
				const newId = randomUUID();
				const label = walletAddress
					? `Avalanche Wallet (${walletAddress.slice(0, 8)}…)`
					: 'Avalanche C-Chain Wallet #1';
				await db.execute({
					sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, 'avalanche_cchain', ?)`,
					args: [newId, tenantId, label],
				});
				resolvedAccountId = newId;
			}
		}
	}

	await db.execute({
		sql: `UPDATE import_transactions SET account_id = ? WHERE tenant_id = ? AND source = 'avalanche_cchain' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	// ── Store wallet address label so the UI can show "My Avalanche wallet" ──

	if (walletAddress) {
		await db.execute({
			sql: `INSERT INTO address_labels (id, tenant_id, address, label, source, created_at)
			      VALUES (lower(replace(gen_random_uuid()::text,'-','')), ?, ?, 'Avalanche C-Chain wallet', 'system', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [tenantId, walletAddress],
		});
	}

	// ── Parse rows ────────────────────────────────────────────────────────────

	const batchId = randomUUID();

	type NormRow = {
		txHash:      string | null;
		timestamp:   string;
		direction:   'in' | 'out';
		amount:      number;
		nativeUsd:   number | null;
		kind:        string;
		description: string;
		rowHash:     string;
	};

	const normRows: NormRow[] = [];

	for (const row of csvRows) {
		// Skip failed transactions (Status is "TRUE"/"FALSE" or "1"/"0")
		const status   = (row['Status']  ?? '').toUpperCase();
		const errCode  = (row['ErrCode'] ?? '').trim();
		const failed   = status === 'FALSE' || status === '0' || (errCode !== '' && errCode !== '0');
		if (failed) continue;

		const inAmt   = parseNum(row['Value_IN(AVAX)']       ?? '') ?? 0;
		const outAmt  = parseNum(row['Value_OUT(AVAX)']      ?? '') ?? 0;
		const price   = parseNum(row['Historical $Price/AVAX'] ?? '');

		// Skip zero-value contract calls (no AVAX moved)
		if (inAmt === 0 && outAmt === 0) continue;

		const direction: 'in' | 'out' = inAmt > 0 ? 'in' : 'out';
		const amount  = direction === 'in' ? inAmt : outAmt;
		const nativeUsd = price != null ? Math.round(amount * price * 100) / 100 : null;

		const timestamp = normalizeTimestamp(row['DateTime (UTC)'] ?? '');
		if (!timestamp) continue;

		const txHash  = row['Transaction Hash'] || null;
		const method  = row['Method'] || '';
		const from    = row['From']   || '';
		const to      = row['To']     || '';
		const kind    = method || (direction === 'in' ? 'deposit' : 'withdrawal');
		const description = from && to
			? `${from.slice(0, 10)}… → ${to.slice(0, 10)}…`
			: kind;

		const hashPayload = JSON.stringify(['avalanche_cchain', txHash ?? '', timestamp, direction, String(amount)]);
		const rowHash     = createHash('sha256').update(hashPayload).digest('hex');

		normRows.push({ txHash, timestamp, direction, amount, nativeUsd, kind, description, rowHash });
	}

	if (!normRows.length) {
		return new Response(JSON.stringify({
			error: 'No valid AVAX transactions found. The file may only have zero-value contract calls, or all transactions were filtered out.',
		}), { status: 400 });
	}

	// ── Build INSERT statements ───────────────────────────────────────────────

	const rawStatements  = normRows.map(r => ({
		sql: `INSERT INTO import_raw_rows
		      (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'avalanche_cchain', ?, ?)
ON CONFLICT DO NOTHING`,
		args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(r), r.rowHash],
	}));

	const normStatements = normRows.map(r => ({
		sql: `INSERT INTO import_transactions
		      (id, tenant_id, account_id, import_batch_id, timestamp_utc,
		       description, currency, amount,
		       to_currency, to_amount,
		       native_currency, native_amount, native_usd,
		       kind, tx_hash, direction, asset_symbol, row_hash, created_at)
		      VALUES (?, ?, ?, ?, ?,   ?, 'AVAX', ?,   NULL, NULL,   'USD', ?, ?,   ?, ?, ?, 'AVAX', ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [
			randomUUID(), tenantId, resolvedAccountId, batchId, r.timestamp,
			r.description,
			r.direction === 'out' ? -r.amount : r.amount,
			r.nativeUsd, r.nativeUsd,
			r.kind,
			r.txHash,
			r.direction,
			r.rowHash,
		],
	}));

	// ── Execute in batches ────────────────────────────────────────────────────

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

	void snapshotCexAccount(tenantId, resolvedAccountId, 'avalanche_cchain', 'Avalanche C-Chain');

	// Register the real on-chain address in the wallets table so the NFT
	// system and wallet-value sync can query it by actual address.
	if (walletAddress) {
		db.execute({
			sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
			      VALUES (?, ?, ?, ?, ?, 0, 'onchain')
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(),
				tenantId,
				walletAddress,
				`Avalanche Wallet (${walletAddress.slice(0, 8)}…)`,
				JSON.stringify(['ethereum', 'polygon', 'avalanche']),
			],
		}).catch(() => { /* already exists — fine */ });
	}

	// Run tenant-wide so Coinbase/other-exchange OUTs are also scanned
	// against the newly imported Snowtrace INs.
	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	const skippedDuplicates = rawStatements.length - insertedRaw;
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'snowtrace', chain: 'avalanche' });

	return new Response(
		JSON.stringify({
			batchId,
			accountId: resolvedAccountId,
			insertedRaw,
			insertedNormalized,
			skippedDuplicates: rawStatements.length - insertedRaw,
			walletAddress,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
