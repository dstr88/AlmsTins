/**
 * GET /api/cron/monthly-digest
 *
 * Runs on the 1st of each month (Render Cron job).
 * For each tenant, queries the prior calendar month's flagged transactions
 * from tax_review_items and writes a summary to monthly_digests.
 *
 * Each item in items_json:
 * {
 *   sourceType: 'onchain' | 'import',
 *   sourceId:   string,
 *   reason:     string,
 *   description: string,   // plain English — "0.5 ETH sent to unknown 0xabc…def"
 *   asset:      string,
 *   amountUsd:  number | null,
 *   date:       string,    // YYYY-MM-DD
 *   counterparty: string | null,  // address or exchange name
 * }
 *
 * Protected by CRON_SECRET header (same pattern as sync-wallets).
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const prerender = false;

// Plain-English labels for each review reason
const REASON_LABELS: Record<string, string> = {
	unmatched_transfer:  'Unmatched transfer',
	missing_price:       'Missing USD price',
	low_confidence:      'Low-confidence classification',
	unknown_type:        'Unclassified transaction',
	missing_cost_basis:  'No purchase record found',
	airdrop_unpriced:    'Unpriced airdrop',
	possible_loan:       'Possible loan transaction',
};

export const GET: APIRoute = async ({ request }) => {
	// ── Auth ────────────────────────────────────────────────────────────────
	const secret   = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret')
		?? new URL(request.url).searchParams.get('secret');

	if (!secret || provided !== secret) {
		console.warn('[cron/monthly-digest] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	// ── Determine prior calendar month ──────────────────────────────────────
	const now       = new Date();
	// Allow ?month=YYYY-MM override for manual backfills
	const override  = new URL(request.url).searchParams.get('month');
	let yearMonth: string;
	if (override && /^\d{4}-\d{2}$/.test(override)) {
		yearMonth = override;
	} else {
		const prior  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const mm     = String(prior.getMonth() + 1).padStart(2, '0');
		yearMonth    = `${prior.getFullYear()}-${mm}`;
	}

	const [year, month] = yearMonth.split('-').map(Number);
	const fromDate = `${yearMonth}-01T00:00:00.000Z`;
	const lastDay  = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this
	const toDate   = `${yearMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

	console.log(`[cron/monthly-digest] Running for ${yearMonth} (${fromDate} → ${toDate})`);

	// ── Fetch all tenants ───────────────────────────────────────────────────
	const tenantsRes = await db.execute(
		`SELECT DISTINCT tenant_id FROM wallets UNION SELECT DISTINCT tenant_id FROM import_transactions`,
	);
	const tenantIds = tenantsRes.rows.map((r) => String(r.tenant_id));
	console.log(`[cron/monthly-digest] Processing ${tenantIds.length} tenants`);

	const results: Array<{ tenantId: string; itemCount: number; error?: string }> = [];

	for (const tenantId of tenantIds) {
		try {
			// ── Build wallet address set (own addresses = not suspicious) ────────
			const walletsRes = await db.execute({
				sql:  `SELECT address FROM wallets WHERE tenant_id = ? AND (wallet_type = 'onchain' OR wallet_type IS NULL)`,
				args: [tenantId],
			});
			const ownAddresses = new Set(
				(walletsRes.rows as Array<Record<string, unknown>>)
					.map((r) => String(r.address ?? '').toLowerCase())
					.filter(Boolean),
			);

			// ── Query unresolved tax_review_items for onchain txs in this month ─
			const onchainRes = await db.execute({
				sql: `SELECT
				        tri.source_id,
				        tri.reason,
				        tri.reason_detail,
				        t.timestamp,
				        t.from_address,
				        t.to_address,
				        t.value,
				        t.token_symbol,
				        t.fee_paid
				      FROM tax_review_items tri
				      JOIN transactions t ON t.id = tri.source_id
				      WHERE tri.tenant_id = ?
				        AND tri.source_type = 'onchain'
				        AND tri.resolved = 0
				        AND t.timestamp BETWEEN ? AND ?
				      ORDER BY t.timestamp ASC`,
				args: [tenantId, fromDate, toDate],
			});

			// ── Query unresolved tax_review_items for import txs in this month ──
			const importRes = await db.execute({
				sql: `SELECT
				        tri.source_id,
				        tri.reason,
				        tri.reason_detail,
				        it.timestamp_utc  AS timestamp,
				        it.asset_symbol,
				        it.amount,
				        it.native_usd,
				        it.direction,
				        it.description
				      FROM tax_review_items tri
				      JOIN import_transactions it ON it.id = tri.source_id
				      WHERE tri.tenant_id = ?
				        AND tri.source_type = 'import'
				        AND tri.resolved = 0
				        AND it.timestamp_utc BETWEEN ? AND ?
				      ORDER BY it.timestamp_utc ASC`,
				args: [tenantId, fromDate, toDate],
			});

			// ── Build item list ──────────────────────────────────────────────────
			type DigestItem = {
				sourceType:   'onchain' | 'import';
				sourceId:     string;
				reason:       string;
				description:  string;
				asset:        string | null;
				amountUsd:    number | null;
				date:         string;
				counterparty: string | null;
			};

			const items: DigestItem[] = [];

			for (const row of onchainRes.rows as Array<Record<string, unknown>>) {
				const from    = String(row.from_address  ?? '').toLowerCase();
				const to      = String(row.to_address    ?? '').toLowerCase();
				const symbol  = String(row.token_symbol  ?? 'ETH');
				const value   = Number(row.value         ?? 0);
				const date    = String(row.timestamp     ?? '').slice(0, 10);
				const reason  = String(row.reason        ?? 'unknown_type');
				const detail  = row.reason_detail ? String(row.reason_detail) : null;

				// Determine counterparty: the address that ISN'T ours
				const counterparty = ownAddresses.has(from) ? to : from;
				const isExternal   = !ownAddresses.has(counterparty);
				const shortAddr    = counterparty
					? `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}`
					: null;

				let description: string;
				if (detail) {
					description = detail;
					if (isExternal && shortAddr) description += ` — ${shortAddr}`;
				} else {
					const label = REASON_LABELS[reason] ?? reason;
					const dir   = ownAddresses.has(from) ? 'sent to' : 'received from';
					description = isExternal && shortAddr
						? `${label}: ${value} ${symbol} ${dir} unknown address ${shortAddr}`
						: `${label}: ${value} ${symbol}`;
				}

				items.push({
					sourceType:   'onchain',
					sourceId:     String(row.source_id ?? ''),
					reason,
					description,
					asset:        symbol,
					amountUsd:    null,
					date,
					counterparty: isExternal ? counterparty : null,
				});
			}

			for (const row of importRes.rows as Array<Record<string, unknown>>) {
				const symbol  = String(row.asset_symbol ?? '');
				const amount  = Number(row.amount       ?? 0);
				const usd     = row.native_usd != null ? Number(row.native_usd) : null;
				const date    = String(row.timestamp    ?? '').slice(0, 10);
				const reason  = String(row.reason       ?? 'unknown_type');
				const detail  = row.reason_detail ? String(row.reason_detail) : null;
				const dir     = String(row.direction    ?? '');
				const label   = REASON_LABELS[reason] ?? reason;

				let description: string;
				if (detail) {
					description = detail;
				} else {
					const dirLabel = dir === 'in' ? 'received' : dir === 'out' ? 'sent' : '';
					description = dirLabel
						? `${label}: ${amount} ${symbol} ${dirLabel}`
						: `${label}: ${amount} ${symbol}`;
				}

				items.push({
					sourceType:   'import',
					sourceId:     String(row.source_id ?? ''),
					reason,
					description,
					asset:        symbol || null,
					amountUsd:    usd,
					date,
					counterparty: null,
				});
			}

			// ── Upsert digest row ────────────────────────────────────────────────
			await db.execute({
				sql: `INSERT INTO monthly_digests (id, tenant_id, year_month, item_count, items_json, computed_at, dismissed_at)
				      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL)
				      ON CONFLICT(tenant_id, year_month) DO UPDATE SET
				        item_count   = excluded.item_count,
				        items_json   = excluded.items_json,
				        computed_at  = excluded.computed_at,
				        dismissed_at = NULL`,
				args: [
					randomUUID(),
					tenantId,
					yearMonth,
					items.length,
					JSON.stringify(items),
				],
			});

			console.log(`[cron/monthly-digest] ${tenantId} — ${yearMonth}: ${items.length} items`);
			results.push({ tenantId, itemCount: items.length });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[cron/monthly-digest] Failed for tenant ${tenantId}:`, msg);
			results.push({ tenantId, itemCount: 0, error: msg });
		}
	}

	return json({ ok: true, yearMonth, tenants: results.length, results }, 200);
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
