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
	qty_mismatch:        'Token quantity mismatch',
};

/** Round to 8 decimal places to avoid IEEE-754 false mismatches. */
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

/** Minimum snapshot USD value for a token to be included in the recon check. */
const RECON_THRESHOLD_USD = 50;

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
				sourceType:   'onchain' | 'import' | 'reconciliation';
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

			// ── Token quantity reconciliation (snapshot vs lifecycle) ─────────────
			// Same logic as /api/portfolio/reconciliation — catches qty mismatches
			// that the dollar-flow check above won't surface.
			try {
				// 1. Lifecycle net quantities
				// Net = SUM(in events) − SUM(out events), excluding liability classes.
				// Transfer pairs (both legs imported) cancel naturally; no linked_transfer
				// special-casing needed — this avoids the double-counting that occurs when
				// BTC passes through multiple imported accounts (e.g. Coinbase OUT → Exodus IN).
				const lifecycleRows = await db.execute({
					sql: `SELECT
					        alg.asset_symbol,
					        COALESCE(SUM(
					            CASE WHEN ale.transaction_class NOT IN (
					                        'liability_increase',
					                        'liability_repayment',
					                        'liability_liquidation'
					                     )
					                 THEN CASE WHEN ale.direction = 'in'
					                           THEN  ABS(COALESCE(ale.amount, 0))
					                           WHEN ale.direction = 'out'
					                           THEN -ABS(COALESCE(ale.amount, 0))
					                           ELSE 0 END
					                 ELSE 0 END
					        ), 0) AS net_qty
					      FROM asset_lifecycle_groups alg
					      LEFT JOIN asset_lifecycle_events ale
					        ON ale.group_id   = alg.id
					       AND ale.tenant_id  = alg.tenant_id
					      WHERE alg.tenant_id = ?
					      GROUP BY alg.id, alg.asset_symbol`,
					args: [tenantId],
				});

				const txQtyMap = new Map<string, number>();
				for (const row of lifecycleRows.rows as Array<Record<string, unknown>>) {
					const sym = String(row.asset_symbol ?? '').toUpperCase();
					const qty = Number(row.net_qty ?? 0);
					if (!sym) continue;
					txQtyMap.set(sym, (txQtyMap.get(sym) ?? 0) + qty);
				}

				// 2. Snapshot quantities (latest per wallet+chain)
				const snapshotRows = await db.execute({
					sql: `WITH latest AS (
					        SELECT wallet_id, chain, MAX(captured_at) AS captured_at
					        FROM wallet_snapshots WHERE tenant_id = ?
					        GROUP BY wallet_id, chain
					      )
					      SELECT ws.payload_json
					      FROM wallet_snapshots ws
					      JOIN latest l
					        ON l.wallet_id   = ws.wallet_id
					       AND l.chain       = ws.chain
					       AND l.captured_at = ws.captured_at
					      JOIN wallets w ON w.id = ws.wallet_id
					      WHERE ws.tenant_id = ? AND w.tenant_id = ?`,
					args: [tenantId, tenantId, tenantId],
				});

				type SnapEntry = { qty: number; valueUsd: number };
				const snapMap = new Map<string, SnapEntry>();

				for (const row of snapshotRows.rows as Array<Record<string, unknown>>) {
					if (!row.payload_json) continue;
					let tokens: Array<{ symbol?: string; amount?: number | string; valueUsd?: number | null }>;
					try {
						tokens = JSON.parse(String(row.payload_json));
						if (!Array.isArray(tokens)) continue;
					} catch { continue; }

					for (const t of tokens) {
						const sym = (t.symbol ?? '').toString().trim().toUpperCase();
						if (!sym) continue;
						const qty = Number(t.amount ?? 0);
						const val = Number(t.valueUsd ?? 0);
						if (qty <= 0) continue;
						const e = snapMap.get(sym) ?? { qty: 0, valueUsd: 0 };
						e.qty      += qty;
						e.valueUsd += val;
						snapMap.set(sym, e);
					}
				}

				// 3. Append mismatched symbols as digest items
				const allSymbols = new Set([...txQtyMap.keys(), ...snapMap.keys()]);
				const today = new Date().toISOString().slice(0, 10);

				for (const symbol of allSymbols) {
					const snap         = snapMap.get(symbol);
					const snapValueUsd = snap?.valueUsd ?? 0;
					if (snapValueUsd < RECON_THRESHOLD_USD) continue;

					const txQty   = round8(txQtyMap.get(symbol) ?? 0);
					const snapQty = round8(snap?.qty ?? 0);
					const delta   = round8(snapQty - txQty);
					if (delta === 0) continue;

					const sign = delta > 0 ? '+' : '';
					items.push({
						sourceType:   'reconciliation',
						sourceId:     symbol,
						reason:       'qty_mismatch',
						description:  `${symbol}: lifecycle shows ${txQty}, snapshot reports ${snapQty} (${sign}${delta})`,
						asset:        symbol,
						amountUsd:    snapValueUsd,
						date:         today,
						counterparty: null,
					});
				}

				console.log(`[cron/monthly-digest] ${tenantId} — recon check: ${allSymbols.size} symbols, ${items.filter(i => i.reason === 'qty_mismatch').length} mismatches`);
			} catch (reconErr) {
				// Non-fatal — log and continue so the rest of the digest still saves
				console.error(`[cron/monthly-digest] Recon check failed for ${tenantId}:`, reconErr);
			}

			// ── Upsert digest row ────────────────────────────────────────────────
			await db.execute({
				sql: `INSERT INTO monthly_digests (id, tenant_id, year_month, item_count, items_json, computed_at, dismissed_at)
				      VALUES (?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL)
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
