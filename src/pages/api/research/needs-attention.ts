import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

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

	// ── 1 + 2: Unmatched transfers (no accepted match on either side) ─────────
	const unmatchedResult = await db.execute({
		sql: `SELECT
		        t.id, t.source, t.account_id, t.timestamp_utc,
		        t.direction, t.asset_symbol, t.amount, t.to_currency, t.to_amount,
		        t.native_usd, t.kind, t.tx_hash, t.description,
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
		                                      AND al.address = (
		                                        'cex:' || t.source || ':' || COALESCE(t.account_id,'')
		                                      )
		      WHERE t.tenant_id = ?
		        AND t.asset_symbol IS NOT NULL
		        AND m_out.id IS NULL
		        AND m_in.id  IS NULL
		        AND (
		          -- OUT with no known internal destination
		          (t.direction = 'out' AND t.kind NOT IN (
		            'crypto_earn_program_created',
		            'card_top_up',
		            'crypto_to_van_sell_order',
		            'Sell',
		            'sell',
		            'crypto_vaulting_purchase'
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
	});

	// ── 3: Suggested matches awaiting user confirmation ───────────────────────
	const suggestedResult = await db.execute({
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
	});

	// Distinct symbols represented in unmatched items (for chip row in UI)
	const symbols = [...new Set(
		(unmatchedResult.rows as any[])
			.map(r => String(r.asset_symbol ?? '').toUpperCase())
			.filter(Boolean)
	)].sort();

	return new Response(
		JSON.stringify({
			unmatched:  unmatchedResult.rows,
			suggested:  suggestedResult.rows,
			symbols,
			total: unmatchedResult.rows.length + suggestedResult.rows.length,
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
};
