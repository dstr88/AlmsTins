/**
 * POST /api/import/kraken
 *
 * Ingests a Kraken Ledger History CSV export.
 *
 * Kraken CSV columns (Ledger History):
 *   "txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"
 *
 * Key normalisation steps:
 *  1. Strip vendor-prefixed asset symbols  (XXBT → BTC, XETH → ETH, ZUSD → USD)
 *  2. Pair trade rows by refid so we can attach the USD value to the crypto leg
 *  3. Derive direction from the amount sign (positive = in, negative = out)
 *  4. Map Kraken "type" to our internal kind string
 */

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

// ── CSV parser (identical to Coinbase — no preamble stripping needed) ─────────

const parseCsv = (input: string): CsvRow[] => {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		const next = input[i + 1];

		if (char === '"') {
			if (inQuotes && next === '"') { field += '"'; i++; }
			else { inQuotes = !inQuotes; }
			continue;
		}
		if (char === ',' && !inQuotes) {
			current.push(field.trim()); field = ''; continue;
		}
		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && next === '\n') i++;
			current.push(field.trim()); field = '';
			if (current.length > 1 || current.some((v) => v !== '')) rows.push(current);
			current = []; continue;
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
		headers.forEach((h, i) => { record[h] = (row[i] ?? '').trim(); });
		return record;
	});
};

// ── Asset symbol normalisation ────────────────────────────────────────────────
// Kraken prefixes crypto with X (XXBT, XETH) and fiat with Z (ZUSD, ZEUR).
// Some newer assets have no prefix (SOL, DOT, USDC).

const KRAKEN_SYMBOL_MAP: Record<string, string> = {
	XXBT: 'BTC', XBT:  'BTC',
	XETH: 'ETH',
	XLTC: 'LTC',
	XXLM: 'XLM',
	XXRP: 'XRP',
	XZEC: 'ZEC',
	XXMR: 'XMR',
	XDAO: 'DAO',
	XICN: 'ICN',
	XMLN: 'MLN',
	XREP: 'REP',
	XREPV2: 'REPV2',
	ZUSD: 'USD',
	ZEUR: 'EUR',
	ZGBP: 'GBP',
	ZCAD: 'CAD',
	ZJPY: 'JPY',
	ZAUD: 'AUD',
};

const FIAT_SYMBOLS = new Set(['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK']);

function normalizeKrakenSymbol(raw: string): string {
	const upper = raw.trim().toUpperCase();
	if (KRAKEN_SYMBOL_MAP[upper]) return KRAKEN_SYMBOL_MAP[upper];
	// Generic X-prefix strip for unlisted coins (e.g. XETC → ETC)
	if (upper.startsWith('X') && upper.length <= 5 && upper.length > 1) return upper.slice(1);
	return upper;
}

function isFiat(symbol: string): boolean {
	return FIAT_SYMBOLS.has(symbol);
}

// ── Timestamp normalisation ───────────────────────────────────────────────────
// Kraken format: "2024-01-15 14:23:45" — no timezone (treat as UTC)

function normalizeTimestamp(raw: string): string {
	if (!raw) return '';
	// Replace space separator with T and append Z
	const iso = raw.replace(' ', 'T') + (raw.includes('T') || raw.includes('Z') ? '' : 'Z');
	const d = new Date(iso);
	return isNaN(d.getTime()) ? '' : d.toISOString();
}

// ── Number parsing ────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
	if (!raw) return null;
	const n = Number(raw.replace(/[$,]/g, ''));
	return isFinite(n) ? n : null;
}

// ── Kind mapping ──────────────────────────────────────────────────────────────

function resolveKind(type: string, symbol: string): string {
	const t = type.toLowerCase().trim();
	if (t === 'staking')    return 'Staking Income';
	if (t === 'deposit')    return 'deposit';
	if (t === 'withdrawal') return 'withdrawal';
	if (t === 'trade')      return 'trade';
	if (t === 'transfer')   return 'transfer';
	if (t === 'spend')      return 'spend';
	if (t === 'receive')    return 'receive';
	if (t === 'margin')     return 'margin';
	if (t === 'rollover')   return 'rollover';
	if (t === 'settled')    return 'settled';
	if (t === 'adjustment') return 'adjustment';
	return t;
}

// ── Row hash ──────────────────────────────────────────────────────────────────

function buildRowHash(txid: string, refid: string, time: string, asset: string, amount: string): string {
	const payload = JSON.stringify(['kraken', txid, refid, time, asset, amount]);
	return createHash('sha256').update(payload).digest('hex');
}

function buildGroupId(symbol: string, dateStr: string): string {
	const payload = `kraken:${symbol}:${dateStr}`;
	return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}
	const { tenantId } = session;

	const formData = await request.formData();
	const file = formData.get('file');
	const accountIdRaw = formData.get('accountId');

	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file upload.' }), { status: 400 });
	}

	// ── Resolve exchange account ──────────────────────────────────────────────

	const accountId = typeof accountIdRaw === 'string' ? accountIdRaw.trim() : '';
	let resolvedAccountId = '';

	if (accountId) {
		const res = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE id = ? AND tenant_id = ? AND source = 'kraken' LIMIT 1`,
			args: [accountId, tenantId],
		});
		if (res.rows?.length) resolvedAccountId = accountId;
	}

	if (!resolvedAccountId) {
		const existing = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'kraken' ORDER BY created_at ASC LIMIT 1`,
			args: [tenantId],
		});
		const existingId = String(existing.rows?.[0]?.id ?? '');
		if (existingId) {
			resolvedAccountId = existingId;
		} else {
			const newId = randomUUID();
			await db.execute({
				sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, 'kraken', 'Account #1')`,
				args: [newId, tenantId],
			});
			resolvedAccountId = newId;
		}
	}

	// Migrate any orphaned rows to this account
	await db.execute({
		sql: `UPDATE import_transactions SET account_id = ? WHERE tenant_id = ? AND source = 'kraken' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});
	await db.execute({
		sql: `UPDATE import_raw_rows SET account_id = ? WHERE tenant_id = ? AND source = 'kraken' AND account_id IS NULL`,
		args: [resolvedAccountId, tenantId],
	});

	// ── Parse CSV ─────────────────────────────────────────────────────────────

	const content = await file.text();
	const csvRows = parseCsv(content);

	if (!csvRows.length) {
		return new Response(JSON.stringify({ error: 'No rows found in CSV.' }), { status: 400 });
	}

	// Validate we have the right CSV format
	const firstRow = csvRows[0];
	const hasKrakenHeaders =
		'txid' in firstRow || 'refid' in firstRow || 'type' in firstRow;
	if (!hasKrakenHeaders) {
		return new Response(
			JSON.stringify({
				error: 'This does not look like a Kraken Ledger CSV. Please export from Account → History → Ledgers and try again.',
			}),
			{ status: 400 },
		);
	}

	// ── First pass: collect all rows and group by refid ──────────────────────
	// We do this so trade pairs (crypto leg + USD leg) can cross-reference the
	// USD value and attach it to the crypto leg as native_usd.

	type ParsedRow = {
		txid:      string;
		refid:     string;
		time:      string;
		type:      string;
		asset:     string;     // raw Kraken symbol
		symbol:    string;     // normalised (BTC, ETH, …)
		amount:    number | null;
		fee:       number | null;
		rawRow:    CsvRow;
	};

	const parsed: ParsedRow[] = [];
	for (const row of csvRows) {
		const time = normalizeTimestamp(row['time'] || row['Time'] || '');
		if (!time) continue;

		const rawAsset = row['asset'] || row['Asset'] || '';
		const symbol   = normalizeKrakenSymbol(rawAsset);
		const amount   = parseNum(row['amount'] || row['Amount'] || '');
		const fee      = parseNum(row['fee']    || row['Fee']    || '');
		const txid     = row['txid']  || row['Txid']  || '';
		const refid    = row['refid'] || row['Refid'] || '';
		const type     = row['type']  || row['Type']  || '';

		parsed.push({ txid, refid, time, type, asset: rawAsset, symbol, amount, fee, rawRow: row });
	}

	// Build refid → USD amount map from fiat legs of trade pairs
	const refidUsd = new Map<string, number>();
	for (const r of parsed) {
		if (r.refid && isFiat(r.symbol) && r.amount !== null) {
			// USD leg is negative (spent) for buys, positive (received) for sells.
			// We want the absolute value to attach to the crypto leg.
			refidUsd.set(r.refid, Math.abs(r.amount));
		}
	}

	// ── Second pass: build DB statements ─────────────────────────────────────

	type DbStatement = { sql: string; args: unknown[] };
	const rawStatements:  DbStatement[] = [];
	const normStatements: DbStatement[] = [];
	const batchId = randomUUID();

	for (const r of parsed) {
		// Skip fiat-only rows (USD deposits/withdrawals are not crypto events)
		if (isFiat(r.symbol)) continue;
		// Skip empty or zero-amount rows
		if (r.amount === null || r.amount === 0) continue;

		const direction: 'in' | 'out' = r.amount > 0 ? 'in' : 'out';
		const absAmount = Math.abs(r.amount);

		// native_usd: from refid pairing (trade), else for staking/deposits treat as 0
		let nativeUsd: number | null = null;
		if (r.refid && refidUsd.has(r.refid)) {
			nativeUsd = refidUsd.get(r.refid) ?? null;
		}

		const kind     = resolveKind(r.type, r.symbol);
		const rowHash  = buildRowHash(r.txid, r.refid, r.time, r.asset, String(r.amount ?? ''));
		const datePart = r.time.slice(0, 10);
		const groupId  = buildGroupId(r.symbol, datePart);

		rawStatements.push({
			sql: `INSERT INTO import_raw_rows
				(id, tenant_id, source, account_id, import_batch_id, row_json, row_hash, imported_at)
				VALUES (?, ?, 'kraken', ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(r.rawRow), rowHash],
		});

		normStatements.push({
			sql: `INSERT INTO import_transactions
				(id, tenant_id, source, account_id, import_batch_id, timestamp_utc,
				 description, currency, amount, to_currency, to_amount,
				 native_currency, native_amount, native_usd,
				 kind, tx_hash, direction, asset_symbol, group_id, row_hash, created_at)
				VALUES (?, ?, 'kraken', ?, ?, ?,
				        ?, ?, ?, ?, ?,
				        ?, ?, ?,
				        ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(), tenantId, resolvedAccountId, batchId, r.time,
				r.type || null,                          // description
				r.symbol,                                // currency
				direction === 'out' ? -absAmount : absAmount,  // amount (signed)
				null, null,                              // to_currency, to_amount
				'USD', nativeUsd, nativeUsd,             // native_currency, native_amount, native_usd
				kind,                                    // kind
				r.txid || null,                          // tx_hash (Kraken txid serves as tx hash)
				direction,
				r.symbol,                                // asset_symbol
				groupId,
				rowHash,
			],
		});
	}

	// ── Execute in batches of 100 ─────────────────────────────────────────────

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

	void snapshotCexAccount(tenantId, resolvedAccountId, 'kraken', 'Kraken');
	void runTransferMatching(tenantId, resolvedAccountId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${insertedNormalized} imported, ${skippedDuplicates} skipped`, { inserted: insertedNormalized, skipped: skippedDuplicates }, { source: 'kraken' });

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
