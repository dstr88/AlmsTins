import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { logNeedsAttention } from '@/lib/activityLog';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL = 300; // 5 minutes

// Module-level in-memory cache — instant hits, no Turso round trip
const memCache = new Map<string, { data: object; expiresAt: number }>();

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const t0 = Date.now();
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	// ── In-memory cache: zero-latency hit ────────────────────────────────────
	const memKey = `needs-attention:${tenantId}`;
	const mem = memCache.get(memKey);
	if (mem && mem.expiresAt > Date.now()) {
		console.log(`[needs-attention] mem-cache hit (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify(mem.data), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ── Turso cache: one round trip, avoids DB queries ────────────────────────
	const cacheKey = `t:${tenantId}:research:needs-attention:v2`;
	const t1 = Date.now();
	const cached = await getCache<object>(cacheKey);
	console.log(`[needs-attention] turso-cache lookup (${Date.now() - t1}ms)`);
	if (cached !== null) {
		memCache.set(memKey, { data: cached, expiresAt: Date.now() + CACHE_TTL * 1000 });
		console.log(`[needs-attention] turso-cache hit total (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify(cached), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ── 3 queries in parallel ─────────────────────────────────────────────────
	// Unmatched: NOT EXISTS correlated subqueries use idx_transfer_matches_out_tx
	// and idx_transfer_matches_in_tx — no large result set transferred, only the
	// final ≤300 rows come over the wire.
	const t2 = Date.now();
	const [unmatchedResult, suggestedResult, resolvedResult] = await Promise.all([

	// ── 0: Unmatched transactions — NOT EXISTS anti-join ─────────────────────
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
		        AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange', 'own_wallet'))
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

	// ── 1: Suggested matches awaiting user confirmation ───────────────────────
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

	// ── 2: Resolved (confirmed + auto) matches ───────────────────────────────
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

	console.log(`[needs-attention] 3 parallel queries (${Date.now() - t2}ms) unmatched=${unmatchedResult.rows.length} suggested=${suggestedResult.rows.length} resolved=${resolvedResult.rows.length}`);

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

	const payload = {
		unmatched: unmatchedSorted,
		suggested: suggestedResult.rows,
		resolved:  resolvedResult.rows,
		symbols,
		total,
		unmatchedCapped,
	};

	memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
	void setCache(cacheKey, payload, CACHE_TTL);

	console.log(`[needs-attention] total (${Date.now() - t0}ms)`);
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
