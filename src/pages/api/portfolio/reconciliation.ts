/**
 * GET /api/portfolio/reconciliation
 *
 * Compares token quantities from two independent sources:
 *   1. asset_lifecycle_groups / asset_lifecycle_events  — "from transactions"
 *      Net qty = total acquired minus non-linked disposals.
 *   2. wallet_snapshots payload_json                     — "from snapshot"
 *      Net qty = sum of token amounts across all latest wallet snapshots.
 *
 * Tokens whose snapshot value is below `threshold` (default $50) are hidden.
 * A discrepancy is any non-zero delta after rounding to 8 decimal places.
 *
 * Query params:
 *   threshold  — minimum snapshot USD value to include (default 50)
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getCache, setCache } from '@/lib/tursoCache';

export const prerender = false;

const CACHE_TTL_SECONDS      = 3 * 60;
const STALE_MAX_AGE_SECONDS  = 10 * 60;
const DEFAULT_THRESHOLD_USD  = 50;

export interface ReconciliationItem {
	symbol:       string;
	txQty:        number;   // lifecycle net quantity
	snapQty:      number;   // snapshot quantity
	snapValueUsd: number;   // current market value (for display + threshold)
	match:        boolean;  // true when txQty === snapQty (8 d.p.)
	delta:        number;   // snapQty − txQty  (positive = snapshot has more)
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Round to 8 decimal places to avoid IEEE-754 false mismatches. */
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

export const GET: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const url       = new URL(request.url);
		const threshold = Number(url.searchParams.get('threshold') ?? DEFAULT_THRESHOLD_USD);

		const cacheKey = `t:${tenantId}:portfolio:reconciliation:v1`;
		const cached   = await getCache<{ items: ReconciliationItem[]; updatedAt: string }>(cacheKey, {
			allowStale:        true,
			staleMaxAgeSeconds: STALE_MAX_AGE_SECONDS,
		});
		if (cached.value) {
			const visible = cached.value.items.filter(i => i.snapValueUsd >= threshold);
			return json({ ok: true, items: visible, updatedAt: cached.value.updatedAt, cached: true, stale: cached.isStale, threshold });
		}

		// ── 1. Lifecycle net quantities ────────────────────────────────────────
		// Net = gross acquired − non-linked disposals.
		// linked_transfer = 1 means the OUT was matched to an on-chain wallet move
		// and should NOT be counted as a disposal for reconciliation purposes.
		const lifecycleRows = await db.execute({
			sql: `SELECT
			        alg.asset_symbol,
			        alg.total_quantity
			          - COALESCE(SUM(
			              CASE WHEN ale.direction = 'out' AND ale.linked_transfer = 0
			                   THEN ABS(COALESCE(ale.amount, 0))
			                   ELSE 0 END
			            ), 0) AS net_qty
			      FROM asset_lifecycle_groups alg
			      LEFT JOIN asset_lifecycle_events ale
			        ON ale.group_id   = alg.id
			       AND ale.tenant_id  = alg.tenant_id
			      WHERE alg.tenant_id = ?
			      GROUP BY alg.id, alg.asset_symbol, alg.total_quantity`,
			args: [tenantId],
		});

		const txQtyMap = new Map<string, number>();
		for (const row of lifecycleRows.rows) {
			const sym = String(row.asset_symbol ?? '').toUpperCase();
			const qty = Number(row.net_qty ?? 0);
			if (!sym) continue;
			txQtyMap.set(sym, (txQtyMap.get(sym) ?? 0) + qty);
		}

		// ── 2. Snapshot quantities ─────────────────────────────────────────────
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

		for (const row of snapshotRows.rows) {
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

		// ── 3. Build items (all symbols — threshold applied at read time) ──────
		const allSymbols = new Set([...txQtyMap.keys(), ...snapMap.keys()]);
		const allItems: ReconciliationItem[] = [];

		for (const symbol of allSymbols) {
			const snap         = snapMap.get(symbol);
			const snapValueUsd = snap?.valueUsd ?? 0;
			const txQty        = round8(txQtyMap.get(symbol) ?? 0);
			const snapQty      = round8(snap?.qty ?? 0);
			const delta        = round8(snapQty - txQty);

			allItems.push({ symbol, txQty, snapQty, snapValueUsd, match: delta === 0, delta });
		}

		// Sort: discrepancies first, then by snapshot value descending
		allItems.sort((a, b) => {
			if (!a.match && b.match) return -1;
			if (a.match && !b.match) return  1;
			return b.snapValueUsd - a.snapValueUsd;
		});

		const payload = { items: allItems, updatedAt: new Date().toISOString() };
		await setCache(cacheKey, payload, CACHE_TTL_SECONDS);

		const visible = allItems.filter(i => i.snapValueUsd >= threshold);
		return json({ ok: true, items: visible, updatedAt: payload.updatedAt, cached: false, stale: false, threshold });

	} catch (err) {
		console.error('[portfolio/reconciliation]', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
