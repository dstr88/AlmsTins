import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

const NON_EVM_ASSETS = new Set([
	'BTC','BCH','BSV','LTC','DOGE','ZEC','DASH','XMR',
	'XRP','XLM','EOS','ADA','DOT','KSM','ATOM','LUNA','LUNC',
	'SOL','PYTH','JTO','BONK','RAY','SRM',
	'TRX','BTT','ALGO','HBAR','VET','THETA','FIL','ICP',
	'NEO','WAVES','QTUM','XTZ','EGLD','FLOW','NEAR',
]);

const FIAT_SYMBOLS = new Set([
	'USD','EUR','GBP','AUD','CAD','SGD','HKD','JPY','CNY','CHF','NZD',
	'USDT','USDC','TUSD','USDM','BUSD','DAI','USDD','USDP','GUSD','PYUSD',
	'FRAX','LUSD','SUSD','HUSD','CUSD','CEUR','USDB',
]);

const FAILED_EXCHANGES = [
	{ key: 'ftx',        name: 'FTX',        year: 2022 },
	{ key: 'celsius',    name: 'Celsius',     year: 2022 },
	{ key: 'blockfi',    name: 'BlockFi',     year: 2022 },
	{ key: 'voyager',    name: 'Voyager',     year: 2022 },
	{ key: 'nexo',       name: 'Nexo',        year: 2022 },
	{ key: 'mt_gox',     name: 'Mt. Gox',     year: 2014 },
	{ key: 'quadrigacx', name: 'QuadrigaCX',  year: 2019 },
];

const NEEDS_ATTENTION_BASE = `
	FROM import_transactions t
	LEFT JOIN transfer_matches m_out ON m_out.tenant_id = t.tenant_id AND m_out.out_tx_id = t.id AND m_out.status != 'rejected'
	LEFT JOIN transfer_matches m_in  ON m_in.tenant_id  = t.tenant_id AND m_in.in_tx_id  = t.id AND m_in.status  != 'rejected'
	WHERE t.tenant_id = ?
	  AND t.asset_symbol IS NOT NULL
	  AND m_out.id IS NULL AND m_in.id IS NULL
	  AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange','own_wallet'))
	  AND NOT (t.category IS NOT NULL AND t.category != '' AND t.timestamp_utc < '2024-01-01')
	  AND NOT (t.direction = 'in' AND t.native_usd IS NOT NULL AND ABS(t.native_usd) < 10)
	  AND NOT (t.direction = 'out' AND t.to_currency IS NOT NULL AND t.to_currency IN (
	    'USD','EUR','GBP','AUD','CAD','SGD','HKD','JPY','CNY','CHF','NZD'
	  ))
	  AND (
	    (t.direction = 'out' AND t.kind NOT IN (
	      'crypto_earn_program_created','card_top_up','crypto_to_van_sell_order','Sell','sell',
	      'crypto_vaulting_purchase','crypto_exchange','crypto_exchange_fee',
	      'dust_conversion_debited','dust_conversion_credited','trade','Trade',
	      'conversion','Conversion','exchange','Exchange','Convert',
	      'crypto_viban_exchange','crypto_wallet_swap_debited','dynamic_coin_swap_debited',
	      'lockup_lock','lockup_swap_debited','finance.lockup.dpos_lock.crypto_wallet',
	      'card_cashback_reverted',
	      'trading.limit_order.cash_account.sell_lock','trading.limit_order.cash_account.sell_unlock'
	    ))
	    OR
	    (t.direction = 'in' AND t.kind IN (
	      'Deposit','deposit','credit','crypto_deposit','Receive','receive','Exchange Withdrawal','Pro Withdrawal'
	    ))
	  )
`;

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const [
		coverageResult,
		pre2019Result,
		nonEvmResult,
		p2pResult,
		priceGapResult,
		topUnresolvedResult,
		orphanedInsResult,
		fiatAssetResult,
		suspiciousPriceResult,
	] = await Promise.all([
		// 1. Import coverage — which sources, date ranges
		db.execute({
			sql: `SELECT source,
			             COUNT(*) AS cnt,
			             MIN(timestamp_utc) AS earliest,
			             MAX(timestamp_utc) AS latest
			      FROM import_transactions WHERE tenant_id = ?
			      GROUP BY source ORDER BY earliest`,
			args: [tenantId],
		}),

		// 2. Pre-2019 records — how many, how many lack tx_hash
		db.execute({
			sql: `SELECT COUNT(*) AS total,
			             SUM(CASE WHEN tx_hash IS NULL THEN 1 ELSE 0 END) AS no_hash,
			             ROUND(SUM(ABS(COALESCE(native_usd,0))),0) AS value_usd
			      FROM import_transactions
			      WHERE tenant_id = ? AND timestamp_utc < '2019-01-01'
			        AND asset_symbol IS NOT NULL`,
			args: [tenantId],
		}),

		// 3. Unresolved non-EVM assets
		db.execute({
			sql: `SELECT t.asset_symbol,
			             COUNT(*) AS cnt,
			             ROUND(SUM(ABS(COALESCE(t.native_usd,0))),0) AS value_usd,
			             SUM(CASE WHEN t.tx_hash IS NOT NULL THEN 1 ELSE 0 END) AS has_hash
			      ${NEEDS_ATTENTION_BASE}
			        AND t.asset_symbol IN (${[...NON_EVM_ASSETS].map(() => '?').join(',')})
			      GROUP BY t.asset_symbol ORDER BY value_usd DESC`,
			args: [tenantId, ...[...NON_EVM_ASSETS]],
		}),

		// 4. P2P phone-number transfers
		db.execute({
			sql: `SELECT COUNT(*) AS cnt,
			             ROUND(SUM(ABS(COALESCE(native_usd,0))),0) AS value_usd
			      FROM import_transactions
			      WHERE tenant_id = ? AND kind = 'crypto_transfer'
			        AND (description LIKE 'To +%' OR description LIKE 'From +%')`,
			args: [tenantId],
		}),

		// 5. Price gaps — transactions with no USD value
		db.execute({
			sql: `SELECT source, COUNT(*) AS cnt
			      FROM import_transactions
			      WHERE tenant_id = ?
			        AND (native_usd IS NULL OR native_usd = 0)
			        AND direction IN ('in','out')
			        AND asset_symbol NOT IN (${[...FIAT_SYMBOLS].map(() => '?').join(',')})
			      GROUP BY source ORDER BY cnt DESC`,
			args: [tenantId, ...[...FIAT_SYMBOLS]],
		}),

		// 6. Top 8 unresolved items by dollar value
		db.execute({
			sql: `SELECT t.id, t.source, t.direction, t.asset_symbol,
			             t.amount, t.native_usd, t.kind, t.timestamp_utc, t.description
			      ${NEEDS_ATTENTION_BASE}
			      ORDER BY ABS(COALESCE(t.native_usd,0)) DESC
			      LIMIT 8`,
			args: [tenantId],
		}),

		// 7. Orphaned large INs — unexplained acquisitions over $500
		db.execute({
			sql: `SELECT t.asset_symbol,
			             COUNT(*) AS cnt,
			             ROUND(SUM(ABS(COALESCE(t.native_usd,0))),0) AS value_usd
			      ${NEEDS_ATTENTION_BASE}
			        AND t.direction = 'in'
			        AND ABS(COALESCE(t.native_usd,0)) >= 500
			      GROUP BY t.asset_symbol ORDER BY value_usd DESC`,
			args: [tenantId],
		}),

		// 8. Fiat symbols appearing as asset_symbol (noise)
		db.execute({
			sql: `SELECT COUNT(*) AS cnt
			      FROM import_transactions
			      WHERE tenant_id = ? AND asset_symbol IN (${[...FIAT_SYMBOLS].map(() => '?').join(',')})`,
			args: [tenantId, ...[...FIAT_SYMBOLS]],
		}),

		// 9. Suspicious implied price — price-per-coin wildly below the max seen
		//    for that symbol in this tenant's data (catches $1/BTC style data errors)
		db.execute({
			sql: `WITH prices AS (
			        SELECT asset_symbol,
			               MAX(ABS(native_usd) / ABS(amount)) AS max_price
			        FROM import_transactions
			        WHERE tenant_id = ?
			          AND native_usd IS NOT NULL AND native_usd != 0
			          AND amount     IS NOT NULL AND amount     != 0
			          AND asset_symbol NOT IN (${[...FIAT_SYMBOLS].map(() => '?').join(',')})
			        GROUP BY asset_symbol
			      )
			      SELECT t.id, t.asset_symbol, t.direction, t.amount, t.native_usd,
			             ROUND(ABS(t.native_usd) / ABS(t.amount), 8) AS implied_price,
			             ROUND(p.max_price, 8)                        AS max_price,
			             t.source, t.timestamp_utc, t.description
			      FROM import_transactions t
			      JOIN prices p ON p.asset_symbol = t.asset_symbol
			      WHERE t.tenant_id = ?
			        AND t.native_usd IS NOT NULL AND t.native_usd != 0
			        AND t.amount     IS NOT NULL AND t.amount     != 0
			        AND t.asset_symbol NOT IN (${[...FIAT_SYMBOLS].map(() => '?').join(',')})
			        AND ABS(t.native_usd) > 1
			        AND (ABS(t.native_usd) / ABS(t.amount)) < (p.max_price / 100)
			      ORDER BY (p.max_price / (ABS(t.native_usd) / ABS(t.amount))) DESC
			      LIMIT 20`,
			args: [
				tenantId, ...[...FIAT_SYMBOLS],
				tenantId, ...[...FIAT_SYMBOLS],
			],
		}),
	]);

	// Check for failed exchange sources
	const sources = new Set((coverageResult.rows as any[]).map(r => String(r.source ?? '').toLowerCase()));
	const failedFound = FAILED_EXCHANGES.filter(ex => sources.has(ex.key));

	return new Response(
		JSON.stringify({
			ok: true,
			coverage:      coverageResult.rows,
			pre2019:       pre2019Result.rows[0] ?? { total: 0, no_hash: 0, value_usd: 0 },
			nonEvm:        nonEvmResult.rows,
			p2p:           p2pResult.rows[0]  ?? { cnt: 0, value_usd: 0 },
			priceGaps:     priceGapResult.rows,
			topUnresolved: topUnresolvedResult.rows,
			orphanedIns:   orphanedInsResult.rows,
			fiatNoise:        Number((fiatAssetResult.rows[0] as any)?.cnt ?? 0),
			failedExchanges:  failedFound,
			suspiciousPrices: suspiciousPriceResult.rows,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
