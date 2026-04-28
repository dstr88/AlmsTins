import { db } from '@/lib/db';
import { logNeedsAttention } from '@/lib/activityLog';

export interface NeedsAttentionResult {
	unmatched:      Record<string, unknown>[];
	suggested:      Record<string, unknown>[];
	resolved:       Record<string, unknown>[];
	symbols:        string[];
	total:          number;
	unmatchedCapped: boolean;
}

export async function runNeedsAttentionQueries(tenantId: string): Promise<NeedsAttentionResult> {
	const [unmatchedResult, suggestedResult, resolvedResult] = await Promise.all([

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
			        AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange', 'own_wallet', 'purchase', 'income', 'dust'))
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

	const unmatched = unmatchedResult.rows as Record<string, unknown>[];
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
		unmatched:       unmatchedSorted,
		suggested:       suggestedResult.rows as Record<string, unknown>[],
		resolved:        resolvedResult.rows  as Record<string, unknown>[],
		symbols,
		total,
		unmatchedCapped,
	};
}
