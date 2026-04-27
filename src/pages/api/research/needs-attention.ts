import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { logNeedsAttention } from '@/lib/activityLog';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL      = 900;    // 15 min fresh window
const STALE_MAX_AGE  = 3600;   // serve stale up to 1 h while background-refreshing
const BG_TIMEOUT_MS  = 25_000; // background refresh timeout — Render's HTTP cutoff doesn't apply here
const SYNC_TIMEOUT_MS = 27_000; // cold-path timeout — must respond before Render's 30s HTTP cutoff

// Module-level in-memory cache — instant hits, no Turso round trip
const memCache = new Map<string, { data: object; expiresAt: number }>();
// Prevent duplicate concurrent background refreshes per tenant
const refreshing = new Set<string>();

const TURSO_KEY = (tenantId: string) => `t:${tenantId}:research:needs-attention:v2`;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`[needs-attention] ${label} timed out after ${ms}ms`)), ms)
		),
	]);
}

async function runQueries(tenantId: string, timeoutMs?: number): Promise<object> {
	const queryAll = Promise.all([

		// ── 0: Unmatched transactions — NOT EXISTS anti-join ──────────────────
		db.execute({
			sql: `SELECT
			        t.id, t.source, t.account_id, t.timestamp_utc,
			        t.direction, t.asset_symbol, t.amount, t.to_currency, t.to_amount,
			        t.native_usd, t.kind, t.tx_hash, t.description,
			        t.notes, t.category,
			        ea.name AS account_name
			      FROM import_transactions t
			      LEFT JOIN exchange_accounts ea ON ea.id = t.account_id
			                                    AND ea.tenant_id = t.tenant_id
			      WHERE t.tenant_id = ?
			        AND t.asset_symbol IS NOT NULL
			        AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange', 'own_wallet', 'purchase', 'income'))
			        AND NOT (t.category IS NOT NULL AND t.category != '' AND t.timestamp_utc < '2024-01-01')
			        AND NOT (t.direction = 'in' AND t.native_usd IS NOT NULL AND ABS(t.native_usd) < 10)
			        AND NOT (t.direction = 'out' AND t.to_currency IS NOT NULL AND t.to_currency IN (
			          'USD','EUR','GBP','AUD','CAD','SGD','HKD','JPY','CNY','CHF','NZD'
			        ))
			        AND (
			          (t.direction = 'out' AND t.kind NOT IN (
			            'crypto_earn_program_created','card_top_up','crypto_to_van_sell_order',
			            'Sell','sell','crypto_vaulting_purchase','crypto_exchange',
			            'crypto_exchange_fee','dust_conversion_debited','dust_conversion_credited',
			            'trade','Trade','conversion','Conversion','exchange','Exchange','Convert',
			            'crypto_viban_exchange','crypto_wallet_swap_debited','dynamic_coin_swap_debited',
			            'lockup_lock','lockup_swap_debited','finance.lockup.dpos_lock.crypto_wallet',
			            'card_cashback_reverted',
			            'trading.limit_order.cash_account.sell_lock',
			            'trading.limit_order.cash_account.sell_unlock'
			          ))
			          OR
			          (t.direction = 'in' AND t.kind IN (
			            'Deposit','deposit','credit','crypto_deposit',
			            'Receive','receive','Exchange Withdrawal','Pro Withdrawal'
			          ))
			        )
			        AND NOT EXISTS (
			          SELECT 1 FROM transfer_matches tm
			          WHERE tm.tenant_id = ? AND tm.out_tx_id = t.id AND tm.status != 'rejected'
			        )
			        AND NOT EXISTS (
			          SELECT 1 FROM transfer_matches tm2
			          WHERE tm2.tenant_id = ? AND tm2.in_tx_id = t.id AND tm2.status != 'rejected'
			        )
			      LIMIT 300`,
			args: [tenantId, tenantId, tenantId],
		}),

		// ── 1: Suggested matches ──────────────────────────────────────────────
		db.execute({
			sql: `SELECT
			        m.id AS match_id,
			        m.confidence_score,
			        m.signals_json,
			        m.asset_symbol,
			        m.out_amount,
			        m.in_amount,
			        m.fee_amount,
			        m.matched_at,
			        t_out.id            AS out_id,
			        t_out.source        AS out_source,
			        t_out.timestamp_utc AS out_ts,
			        t_out.description   AS out_desc,
			        ea_out.name         AS out_account_name,
			        t_in.id             AS in_id,
			        t_in.source         AS in_source,
			        t_in.timestamp_utc  AS in_ts,
			        t_in.description    AS in_desc,
			        ea_in.name          AS in_account_name
			      FROM transfer_matches m
			      JOIN import_transactions t_out ON t_out.id = m.out_tx_id
			      JOIN import_transactions t_in  ON t_in.id  = m.in_tx_id
			      LEFT JOIN exchange_accounts ea_out ON ea_out.id = t_out.account_id
			      LEFT JOIN exchange_accounts ea_in  ON ea_in.id  = t_in.account_id
			      WHERE m.tenant_id = ?
			        AND m.status = 'suggested'
			      ORDER BY m.confidence_score DESC
			      LIMIT 100`,
			args: [tenantId],
		}),

		// ── 2: Resolved (confirmed + auto) matches ────────────────────────────
		db.execute({
			sql: `SELECT
			        m.id AS match_id,
			        m.asset_symbol,
			        m.out_amount,
			        m.in_amount,
			        m.fee_amount,
			        m.confidence_score,
			        m.status,
			        COALESCE(m.confirmed_at, m.matched_at) AS resolved_at,
			        t_out.source        AS out_source,
			        t_out.timestamp_utc AS out_ts,
			        ea_out.name         AS out_account_name,
			        t_in.source         AS in_source,
			        t_in.timestamp_utc  AS in_ts,
			        ea_in.name          AS in_account_name
			      FROM transfer_matches m
			      JOIN import_transactions t_out ON t_out.id = m.out_tx_id
			      JOIN import_transactions t_in  ON t_in.id  = m.in_tx_id
			      LEFT JOIN exchange_accounts ea_out ON ea_out.id = t_out.account_id
			                                        AND ea_out.tenant_id = m.tenant_id
			      LEFT JOIN exchange_accounts ea_in  ON ea_in.id  = t_in.account_id
			                                        AND ea_in.tenant_id  = m.tenant_id
			      WHERE m.tenant_id = ?
			        AND m.status IN ('confirmed', 'auto')
			      ORDER BY COALESCE(m.confirmed_at, m.matched_at) DESC
			      LIMIT 100`,
			args: [tenantId],
		}),
	]);
	const [unmatchedResult, suggestedResult, resolvedResult] = timeoutMs
		? await withTimeout(queryAll, timeoutMs, 'db queries')
		: await queryAll;

	const unmatched = unmatchedResult.rows as any[];
	const unmatchedSorted = [...unmatched].sort((a, b) => {
		const sym = String(a.asset_symbol ?? '').localeCompare(String(b.asset_symbol ?? ''));
		if (sym !== 0) return sym;
		return String(b.timestamp_utc ?? '').localeCompare(String(a.timestamp_utc ?? ''));
	});
	const symbols = [...new Set(
		unmatchedSorted.map(r => String(r.asset_symbol ?? '').toUpperCase()).filter(Boolean)
	)].sort();
	const unmatchedCapped = unmatched.length >= 300;
	const total = unmatched.length + suggestedResult.rows.length;

	logNeedsAttention(tenantId, total, unmatched.length, suggestedResult.rows.length);

	return {
		unmatched: unmatchedSorted,
		suggested: suggestedResult.rows,
		resolved:  resolvedResult.rows,
		symbols,
		total,
		unmatchedCapped,
	};
}

async function backgroundRefresh(tenantId: string, memKey: string): Promise<void> {
	if (refreshing.has(tenantId)) return;
	refreshing.add(tenantId);
	try {
		const payload = await runQueries(tenantId, BG_TIMEOUT_MS);
		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
		void setCache(TURSO_KEY(tenantId), payload, CACHE_TTL);
		console.log(`[needs-attention] background refresh complete for ${tenantId}`);
	} catch (err) {
		console.error(`[needs-attention] background refresh failed:`, err);
	} finally {
		refreshing.delete(tenantId);
	}
}

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const t0 = Date.now();
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const memKey = `needs-attention:${tenantId}`;

	// ── In-memory cache: zero-latency hit ────────────────────────────────────
	const mem = memCache.get(memKey);
	if (mem && mem.expiresAt > Date.now()) {
		console.log(`[needs-attention] mem-cache hit (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify(mem.data), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ── Turso cache: stale-while-revalidate ───────────────────────────────────
	try {
		const t1 = Date.now();
		const cacheRead = await withTimeout(
			getCache<object>(TURSO_KEY(tenantId), { allowStale: true, staleMaxAgeSeconds: STALE_MAX_AGE }),
			5_000,
			'turso-cache',
		);
		console.log(`[needs-attention] turso-cache lookup (${Date.now() - t1}ms) stale=${cacheRead?.isStale}`);

		if (cacheRead?.value !== null && cacheRead?.value !== undefined) {
			memCache.set(memKey, { data: cacheRead.value, expiresAt: Date.now() + CACHE_TTL * 1000 });
			if (cacheRead.isStale) {
				// Return stale immediately; refresh in background
				void backgroundRefresh(tenantId, memKey);
				console.log(`[needs-attention] serving stale + background refresh (${Date.now() - t0}ms)`);
			} else {
				console.log(`[needs-attention] turso-cache hit (${Date.now() - t0}ms)`);
			}
			return new Response(JSON.stringify(cacheRead.value), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch (err) {
		console.error(`[needs-attention] turso-cache error:`, err);
		// fall through to live queries
	}

	// ── No cache at all: run queries synchronously ────────────────────────────
	const t2 = Date.now();
	try {
		const payload = await runQueries(tenantId, SYNC_TIMEOUT_MS);
		console.log(`[needs-attention] live queries (${Date.now() - t2}ms)`);
		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
		void setCache(TURSO_KEY(tenantId), payload, CACHE_TTL);
		console.log(`[needs-attention] total (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error(`[needs-attention] db error after ${Date.now() - t2}ms:`, err);
		return new Response(
			JSON.stringify({ error: String(err), unmatched: [], suggested: [], resolved: [], symbols: [], total: 0, unmatchedCapped: false }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
