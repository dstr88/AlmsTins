import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { logNeedsAttention } from '@/lib/activityLog';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL = 300; // 5 minutes

export const prerender = false;

/**
 * Returns unresolved items that need the user's attention:
 *
 *  1. OUT transactions with no matching IN anywhere in the tenant
 *     (possible external send — user should confirm or label destination)
 *
 *  2. IN transactions with no matching OUT and no known source
 *     (coins appeared from an unknown place — needs cost basis or explanation)
 *
 *  3. Suggested matches that scored below auto-threshold — user should confirm
 */
export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const cacheKey = `t:${tenantId}:research:needs-attention:v1`;
	const cached   = await getCache<object>(cacheKey);
	if (cached !== null) {
		return new Response(JSON.stringify(cached), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ── 4 queries in parallel ────────────────────────────────────────────────
	// Strategy: avoid the expensive double-JOIN on transfer_matches.
	// Instead, fetch candidates (direction/kind filter only — no join) and all
	// matched IDs separately, then filter in JS with a Set lookup (O(1)).
	// The new (tenant_id, direction, kind) index makes query 0 a fast index seek.
	const [candidatesResult, matchedIdsResult, suggestedResult, resolvedResult] = await Promise.all([

	// ── 0: Candidate transactions — direction/kind filter, no transfer_matches join
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
		      ORDER BY t.asset_symbol ASC, t.timestamp_utc DESC
		      LIMIT 2000`,
		args: [tenantId],
	}),

	// ── 1: All matched transaction IDs (non-rejected) — one simple scan ───────
	db.execute({
		sql: `SELECT out_tx_id AS tx_id FROM transfer_matches WHERE tenant_id = ? AND status != 'rejected'
		      UNION ALL
		      SELECT in_tx_id  AS tx_id FROM transfer_matches WHERE tenant_id = ? AND status != 'rejected'`,
		args: [tenantId, tenantId],
	}),

	// ── 2: Suggested matches awaiting user confirmation ───────────────────────
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
		        -- out side
		        t_out.id            AS out_id,
		        t_out.source        AS out_source,
		        t_out.timestamp_utc AS out_ts,
		        t_out.description   AS out_desc,
		        ea_out.name         AS out_account_name,
		        -- in side
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

	// ── 3: Resolved (confirmed + auto) matches ───────────────────────────────
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

	// Filter candidates: exclude any tx that appears in a non-rejected match
	const matchedIds = new Set(
		(matchedIdsResult.rows as any[]).map(r => String(r.tx_id))
	);
	const unmatched = (candidatesResult.rows as any[])
		.filter(r => !matchedIds.has(String(r.id)))
		.slice(0, 300);

	// Distinct symbols represented in unmatched items (for chip row in UI)
	const symbols = [...new Set(
		unmatched.map(r => String(r.asset_symbol ?? '').toUpperCase()).filter(Boolean)
	)].sort();

	const unmatchedCapped = unmatched.length >= 300;
	const total = unmatched.length + suggestedResult.rows.length;
	logNeedsAttention(tenantId, total, unmatched.length, suggestedResult.rows.length);

	const payload = {
		unmatched,
		suggested: suggestedResult.rows,
		resolved:  resolvedResult.rows,
		symbols,
		total,
		unmatchedCapped,
	};

	void setCache(cacheKey, payload, CACHE_TTL);

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
