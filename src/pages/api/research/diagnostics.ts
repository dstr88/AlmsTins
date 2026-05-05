import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getCache, setCache } from '@/lib/tursoCache';
import {
	getCoingeckoIdBySymbol,
	getUsdUnitPriceAtTimestampCoinGecko,
} from '@/lib/coingeckoHistorical';

export const prerender = false;

const CACHE_TTL     = 600;   // 10 min fresh
const STALE_MAX_AGE = 1800;  // serve stale up to 30 min

const memCache = new Map<string, { data: object; expiresAt: number }>();
const TURSO_KEY = (tenantId: string) => `t:${tenantId}:research:diagnostics:v1`;

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
	  AND (t.category IS NULL OR t.category NOT IN ('legacy_exchange','own_wallet','purchase','income','dust'))
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

	const memKey = `diagnostics:${tenantId}`;

	// In-memory cache — zero-latency hit
	const mem = memCache.get(memKey);
	if (mem && mem.expiresAt > Date.now()) {
		return new Response(JSON.stringify({ ...mem.data, cached: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Turso cache — stale-while-revalidate
	try {
		const turso = await getCache<object & { updatedAt?: string }>(TURSO_KEY(tenantId), {
			allowStale: true,
			staleMaxAgeSeconds: STALE_MAX_AGE,
		});
		if (turso) {
			memCache.set(memKey, { data: turso, expiresAt: Date.now() + CACHE_TTL * 1000 });
			return new Response(JSON.stringify({ ...turso, cached: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch { /* cache miss — fall through to live queries */ }

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
		snapshotPayloadResult,
		lifecycleNetResult,
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

		// 10. Latest wallet snapshot payloads — for missing-basis detection
		db.execute({
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
		}),

		// 11. Lifecycle net quantity per symbol
		db.execute({
			sql: `SELECT alg.asset_symbol,
			             COALESCE(SUM(
			               CASE WHEN ale.transaction_class NOT IN (
			                         'liability_increase','liability_repayment','liability_liquidation'
			                    )
			               THEN CASE WHEN ale.direction = 'in'  THEN  ABS(COALESCE(ale.amount, 0))
			                         WHEN ale.direction = 'out' THEN -ABS(COALESCE(ale.amount, 0))
			                         ELSE 0 END
			               ELSE 0 END
			             ), 0) AS net_qty
			      FROM asset_lifecycle_groups alg
			      LEFT JOIN asset_lifecycle_events ale
			        ON ale.group_id  = alg.id
			       AND ale.tenant_id = alg.tenant_id
			      WHERE alg.tenant_id = ?
			      GROUP BY alg.id, alg.asset_symbol`,
			args: [tenantId],
		}),
	]);

	// Check for failed exchange sources
	const sources = new Set((coverageResult.rows as any[]).map(r => String(r.source ?? '').toLowerCase()));
	const failedFound = FAILED_EXCHANGES.filter(ex => sources.has(ex.key));

	// ── Missing cost-basis detection ───────────────────────────────────────────
	// Build snapshot value map from latest wallet payloads
	const snapValueMap = new Map<string, { qty: number; valueUsd: number }>();
	for (const row of snapshotPayloadResult.rows) {
		if (!row.payload_json) continue;
		let tokens: Array<{ symbol?: string; amount?: number | string; valueUsd?: number | null }>;
		try {
			tokens = JSON.parse(String(row.payload_json));
			if (!Array.isArray(tokens)) continue;
		} catch { continue; }
		for (const t of tokens) {
			const sym = String(t.symbol ?? '').toUpperCase();
			if (!sym || FIAT_SYMBOLS.has(sym)) continue;
			const qty = Math.abs(Number(t.amount ?? 0));
			const usd = Math.abs(Number(t.valueUsd ?? 0));
			const prev = snapValueMap.get(sym) ?? { qty: 0, valueUsd: 0 };
			snapValueMap.set(sym, { qty: prev.qty + qty, valueUsd: prev.valueUsd + usd });
		}
	}

	// Build lifecycle net-qty map
	const lifecycleQtyMap = new Map<string, number>();
	for (const row of lifecycleNetResult.rows) {
		const sym = String((row as any).asset_symbol ?? '').toUpperCase();
		if (!sym) continue;
		const qty = Number((row as any).net_qty ?? 0);
		lifecycleQtyMap.set(sym, (lifecycleQtyMap.get(sym) ?? 0) + qty);
	}

	// Find symbols with wallet balance > $50 but no/zero lifecycle record
	const MISSING_BASIS_THRESHOLD = 50;
	const gapSymbols: Array<{ symbol: string; snapQty: number; snapValueUsd: number }> = [];
	for (const [sym, snap] of snapValueMap) {
		if (snap.valueUsd < MISSING_BASIS_THRESHOLD) continue;
		const netQty = lifecycleQtyMap.get(sym) ?? null;
		if (netQty !== null && netQty > 0.0001) continue; // lifecycle exists and has meaningful qty
		gapSymbols.push({ symbol: sym, snapQty: snap.qty, snapValueUsd: snap.valueUsd });
	}
	gapSymbols.sort((a, b) => b.snapValueUsd - a.snapValueUsd);

	// For gap symbols (cap 5), look up earliest import transaction and fetch a
	// CoinGecko historical price as an estimated cost basis per coin.
	const ESTIMATE_CAP = 5;
	type MissingBasisItem = {
		symbol:          string;
		snapQty:         number;
		snapValueUsd:    number;
		earliestDate:    string | null;
		estimatedPrice:  number | null;
		estimatedTotal:  number | null;
	};
	const missingBasis: MissingBasisItem[] = [];

	await Promise.all(
		gapSymbols.slice(0, ESTIMATE_CAP).map(async gap => {
			let earliestDate: string | null = null;
			let estimatedPrice: number | null = null;
			let estimatedTotal: number | null = null;
			try {
				const earliest = await db.execute({
					sql: `SELECT MIN(timestamp_utc) AS ts
					      FROM import_transactions
					      WHERE tenant_id = ? AND asset_symbol = ? AND direction = 'in'`,
					args: [tenantId, gap.symbol],
				});
				earliestDate = String((earliest.rows[0] as any)?.ts ?? '') || null;
				if (earliestDate) {
					const coinId = await getCoingeckoIdBySymbol(gap.symbol);
					if (coinId) {
						const priceResult = await getUsdUnitPriceAtTimestampCoinGecko({
							coinId,
							timestampUtcIso: earliestDate,
						});
						if (priceResult?.unitPriceUsd != null) {
							estimatedPrice = priceResult.unitPriceUsd;
							estimatedTotal = estimatedPrice * gap.snapQty;
						}
					}
				}
			} catch { /* non-fatal */ }
			missingBasis.push({ ...gap, earliestDate, estimatedPrice, estimatedTotal });
		}),
	);

	// Push remaining gap symbols (beyond ESTIMATE_CAP) without estimates
	for (const gap of gapSymbols.slice(ESTIMATE_CAP)) {
		missingBasis.push({ ...gap, earliestDate: null, estimatedPrice: null, estimatedTotal: null });
	}
	missingBasis.sort((a, b) => b.snapValueUsd - a.snapValueUsd);

	const payload = {
		ok: true,
		coverage:         coverageResult.rows,
		pre2019:          pre2019Result.rows[0] ?? { total: 0, no_hash: 0, value_usd: 0 },
		nonEvm:           nonEvmResult.rows,
		p2p:              p2pResult.rows[0]  ?? { cnt: 0, value_usd: 0 },
		priceGaps:        priceGapResult.rows,
		topUnresolved:    topUnresolvedResult.rows,
		orphanedIns:      orphanedInsResult.rows,
		fiatNoise:        Number((fiatAssetResult.rows[0] as any)?.cnt ?? 0),
		failedExchanges:  failedFound,
		suspiciousPrices: suspiciousPriceResult.rows,
		missingBasis,
		updatedAt:        new Date().toISOString(),
		cached:           false,
	};

	memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
	void setCache(TURSO_KEY(tenantId), payload, CACHE_TTL);

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
