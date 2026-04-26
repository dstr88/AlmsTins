import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { logNeedsAttention } from '@/lib/activityLog';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL = 90; // seconds

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

	// ── 3 queries in parallel (no unbounded count — use list length as badge) ──
	const [unmatchedResult, suggestedResult, resolvedResult] = await Promise.all([

	// ── 0: Unmatched transfers (no accepted match on either side) ────────────
	db.execute({
		sql: `SELECT
		        t.id, t.source, t.account_id, t.timestamp_utc,
		        t.direction, t.asset_symbol, t.amount, t.to_currency, t.to_amount,
		        t.native_usd, t.kind, t.tx_hash, t.description,
		        t.notes, t.category,
		        ea.name AS account_name,
		        al.label AS address_label
		      FROM import_transactions t
		      LEFT JOIN transfer_matches m_out ON m_out.tenant_id  = t.tenant_id
		                                      AND m_out.out_tx_id  = t.id
		                                      AND m_out.status    != 'rejected'
		      LEFT JOIN transfer_matches m_in  ON m_in.tenant_id   = t.tenant_id
		                                      AND m_in.in_tx_id    = t.id
		                                      AND m_in.status     != 'rejected'
		      LEFT JOIN exchange_accounts ea   ON ea.id = t.account_id
		                                      AND ea.tenant_id = t.tenant_id
		      LEFT JOIN address_labels al      ON al.tenant_id = t.tenant_id
		                                      AND al.address IN (
		                                        'cex:' || t.source || ':' || COALESCE(t.account_id,''),
		                                        COALESCE(t.tx_hash, '')
		                                      )
		      -- A user-supplied label means "I know what this is."
		      -- Matches by tx_hash (when available) or by tx_id: prefix (fallback for rows
		      -- where the exchange didn't provide a hash).
		      -- Only applies to transactions before 2024.
		      LEFT JOIN address_labels al_explained ON al_explained.tenant_id = t.tenant_id
		                                          AND (
		                                            (t.tx_hash IS NOT NULL AND al_explained.address = t.tx_hash)
		                                            OR al_explained.address = 'tx_id:' || t.id
		                                          )
		                                          AND al_explained.source     = 'user'
		                                          AND t.timestamp_utc         < '2024-01-01'
		      WHERE t.tenant_id = ?
		        AND t.asset_symbol IS NOT NULL
		        AND m_out.id IS NULL
		        AND m_in.id  IS NULL
		        AND al_explained.id IS NULL          -- skip pre-2024 transactions explained via address label
		        AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange', 'own_wallet'))  -- these labels always resolve regardless of date
		        AND NOT (t.category IS NOT NULL AND t.category != '' AND t.timestamp_utc < '2024-01-01') -- skip pre-2024 transactions with a user-set category
		        -- Small inbound amounts (< $10 USD) are almost always staking rewards /
		        -- interest that will never have a matching outbound. Suppress to reduce noise.
		        AND NOT (t.direction = 'in' AND t.native_usd IS NOT NULL AND ABS(t.native_usd) < 10)
		        -- Crypto-to-fiat conversions resolve on-platform; no matching deposit will ever appear
		        AND NOT (t.direction = 'out' AND t.to_currency IS NOT NULL AND t.to_currency IN (
		          'USD','EUR','GBP','AUD','CAD','SGD','HKD','JPY','CNY','CHF','NZD'
		        ))
		        AND (
		          -- OUT with no known internal destination.
		          -- Exclude completed trades/sells/swaps — these resolved on-platform
		          -- and will never have a matching deposit elsewhere.
		          (t.direction = 'out' AND t.kind NOT IN (
		            'crypto_earn_program_created',
		            'card_top_up',
		            'crypto_to_van_sell_order',
		            'Sell',
		            'sell',
		            'crypto_vaulting_purchase',
		            'crypto_exchange',
		            'crypto_exchange_fee',
		            'dust_conversion_debited',
		            'dust_conversion_credited',
		            'trade',
		            'Trade',
		            'conversion',
		            'Conversion',
		            'exchange',
		            'Exchange',
		            'Convert',
		            'crypto_viban_exchange',
		            'crypto_wallet_swap_debited',
		            'dynamic_coin_swap_debited',
		            'lockup_lock',
		            'lockup_swap_debited',
		            'finance.lockup.dpos_lock.crypto_wallet',
		            'card_cashback_reverted',
		            'trading.limit_order.cash_account.sell_lock',
		            'trading.limit_order.cash_account.sell_unlock'
		          ))
		          OR
		          -- IN with no known origin and unknown kind
		          (t.direction = 'in' AND t.kind IN (
		            'Deposit', 'deposit', 'credit', 'crypto_deposit',
		            'Receive', 'receive', 'Exchange Withdrawal',
		            'Pro Withdrawal'
		          ))
		        )
		      ORDER BY t.asset_symbol ASC, t.timestamp_utc DESC
		      LIMIT 300`,
		args: [tenantId],
	}),

	// ── 3: Suggested matches awaiting user confirmation ───────────────────────
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

	// ── 4: Resolved (confirmed + auto) matches ───────────────────────────────
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
	]); // end Promise.all

	// Distinct symbols represented in unmatched items (for chip row in UI)
	const symbols = [...new Set(
		(unmatchedResult.rows as any[])
			.map(r => String(r.asset_symbol ?? '').toUpperCase())
			.filter(Boolean)
	)].sort();

	// Total derived from list lengths. When unmatched hits the 300 cap, the UI
	// shows "300+" in the badge rather than a precise (expensive) count.
	const unmatchedCapped = unmatchedResult.rows.length >= 300;
	const total = unmatchedResult.rows.length + suggestedResult.rows.length;
	logNeedsAttention(tenantId, total, unmatchedResult.rows.length, suggestedResult.rows.length);

	const payload = {
		unmatched: unmatchedResult.rows,
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
