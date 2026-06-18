/**
 * GET /api/yearEnd/summary?year=YYYY
 *
 * Returns a Schedule D–style tax summary for the authenticated tenant.
 *
 * Capital gain/loss computation is approximate: proceeds come from lifecycle
 * events (out-direction, taxable classes); cost basis comes from the
 * weighted_avg_cost_usd recorded on the lifecycle group at the time the event
 * was inserted.  Exact FIFO per-lot matching is done client-side on the
 * transactions page — this endpoint provides the high-level dashboard card.
 *
 * Response shape:
 * {
 *   ok: true,
 *   year: 2024,
 *   ordinaryIncome: { total: number, count: number, byAsset: {symbol, amount}[] },
 *   disposals:      { totalProceeds: number, count: number, unpricedCount: number },
 *   unpricedOnchain: number,   // onchain txs still missing native_usd
 * }
 */

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { getCache, setCache } from '../../../lib/tursoCache';
import { buildAnnualBreakdown, type CostBasisMethod, type AnnualBreakdownSource } from '../../../lib/annualBreakdown';
import { getTickersUSD } from '../../../lib/coinpaprikaProvider';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

const CACHE_TTL     = 10 * 60;  // 10 min fresh
const STALE_MAX_AGE = 60 * 60;  // serve stale up to 1 h

const memCache = new Map<string, { data: object; expiresAt: number }>();

// Transaction classes that are taxable disposals (capital events)
// 'liability_liquidation' = forced sell → capital event
const DISPOSAL_CLASSES = new Set([
	'other',                // plain crypto sell / swap
	'owned_acquisition',    // sells recorded as outgoing acquisitions from exchange
	'liability_liquidation',
]);

// Classes that are never capital events
const NON_DISPOSAL_CLASSES = new Set([
	'liability_increase',
	'liability_repayment',
	'collateral_deposit',
	'collateral_withdrawal',
	'interest_income',
]);

export const GET: APIRoute = async ({ request, url }) => {
	const session = await requireTenantSession(request);
	if (!session) return respond({ ok: false, error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	const t = getYearEndErrors(getLang(request));

	const yearParam   = url.searchParams.get('year');
	const year        = yearParam ? Number(yearParam) : new Date().getFullYear();
	const methodParam = url.searchParams.get('method');
	const method: CostBasisMethod =
		methodParam === 'hifo'    ? 'hifo'    :
		methodParam === 'lifo'    ? 'lifo'    :
		methodParam === 'spec_id' ? 'spec_id' : 'fifo';

	if (Number.isNaN(year) || year < 2009 || year > 2100) {
		return respond({ ok: false, error: t.invalidYear }, 400);
	}

	const memKey   = `tax-summary:${tenantId}:${year}:${method}`;
	const tursoKey = `t:${tenantId}:tax:summary:${year}:${method}:v1`;

	const mem = memCache.get(memKey);
	if (mem && mem.expiresAt > Date.now()) {
		return respond({ ...mem.data, cached: true });
	}
	try {
		const cached = await getCache<object>(tursoKey, { allowStale: true, staleMaxAgeSeconds: STALE_MAX_AGE });
		if (cached.value) {
			memCache.set(memKey, { data: cached.value, expiresAt: Date.now() + CACHE_TTL * 1000 });
			return respond({ ...cached.value, cached: true, stale: cached.isStale });
		}
	} catch { /* fall through to live queries */ }

	const from = `${year}-01-01T00:00:00.000Z`;
	const to   = `${year}-12-31T23:59:59.999Z`;

	try {
		// ── 1. Ordinary income — by asset (lifecycle events fallback) ────────
		const incomeRes = await db.execute({
			sql: `SELECT ale.asset_symbol, SUM(ale.native_usd) AS total_usd, COUNT(*) AS event_count
			      FROM asset_lifecycle_events ale
			      WHERE ale.tenant_id = ?
			        AND ale.transaction_class = 'interest_income'
			        AND ale.direction = 'in'
			        AND ale.timestamp_utc BETWEEN ? AND ?
			        AND ale.native_usd IS NOT NULL AND ale.native_usd > 0
			      GROUP BY ale.asset_symbol
			      ORDER BY total_usd DESC`,
			args: [tenantId, from, to],
		});

		const byAsset = incomeRes.rows.map((r) => ({
			symbol: String(r.asset_symbol ?? ''),
			amount: Number(r.total_usd ?? 0),
			count:  Number(r.event_count ?? 0),
		}));

		// ── 1b. Ordinary income — by category (from pipeline classifications) ─
		// Groups income and airdrop events by sub_category so the UI can show
		// "Staking Rewards", "Interest & Earn", "Airdrops", etc. with IRS line refs.
		type IncomeCategoryRow = {
			type:     string;
			label:    string;
			irsLine:  string;
			count:    number;
			total:    number;
		};

		function normalizeIncomeSubcat(category: string, sub: string | null): { label: string; irsLine: string } {
			if (category === 'airdrop') return { label: 'Airdrops', irsLine: 'Schedule 1 · Line 8z' };
			const s = (sub ?? '').toLowerCase();
			if (s.includes('staking') || s.includes('reward') || s.includes('inflation'))
				return { label: 'Staking Rewards', irsLine: 'Schedule 1 · Line 8z' };
			if (s.includes('interest') || s.includes('earn') || s.includes('yield'))
				return { label: 'Interest & Earn', irsLine: 'Schedule 1 · Line 2b / 8z' };
			if (s.includes('referral') || s.includes('cashback') || s.includes('bonus'))
				return { label: 'Referral & Cashback', irsLine: 'Schedule 1 · Line 8z' };
			if (s.includes('mining'))
				return { label: 'Mining Income', irsLine: 'Schedule C (self-employment)' };
			if (s.includes('learn') || s.includes('grant') || s.includes('token-grant'))
				return { label: 'Learn & Earn / Grants', irsLine: 'Schedule 1 · Line 8z' };
			return { label: 'Other Income', irsLine: 'Schedule 1 · Line 8z' };
		}

		let byCategory: IncomeCategoryRow[] = [];
		// Fix 3: when pipeline data is available, recompute byAsset from the same
		// source (tax_classifications) so the two income tables never diverge.
		// pipelineByAsset is null when the pipeline hasn't run yet → fall back to
		// the asset_lifecycle_events query already stored in byAsset above.
		let pipelineByAsset: typeof byAsset | null = null;
		try {
			const catRes = await db.execute({
				sql: `SELECT category, sub_category,
				             SUM(amount_usd) AS total_usd, COUNT(*) AS event_count
				      FROM tax_classifications
				      WHERE tenant_id = ?
				        AND category IN ('income', 'airdrop')
				        AND amount_usd IS NOT NULL AND amount_usd > 0
				        AND tax_year = ?
				      GROUP BY category, sub_category
				      ORDER BY total_usd DESC`,
				args: [tenantId, year],
			});

			// Merge rows with the same normalised label
			const catMap = new Map<string, IncomeCategoryRow>();
			for (const r of catRes.rows) {
				const cat = String(r.category ?? '');
				const sub = typeof r.sub_category === 'string' ? r.sub_category : null;
				const { label, irsLine } = normalizeIncomeSubcat(cat, sub);
				const existing = catMap.get(label);
				if (existing) {
					existing.count += Number(r.event_count ?? 0);
					existing.total += Number(r.total_usd   ?? 0);
				} else {
					catMap.set(label, {
						type:    sub ?? cat,
						label,
						irsLine,
						count:   Number(r.event_count ?? 0),
						total:   Number(r.total_usd   ?? 0),
					});
				}
			}
			byCategory = Array.from(catMap.values()).sort((a, b) => b.total - a.total);

			// Fix 3 — pipeline byAsset (same source as byCategory)
			if (catRes.rows.length > 0) {
				const assetRes = await db.execute({
					sql: `SELECT asset_symbol,
					             SUM(amount_usd) AS total_usd,
					             COUNT(*)        AS event_count
					      FROM tax_classifications
					      WHERE tenant_id = ?
					        AND category IN ('income', 'airdrop')
					        AND amount_usd IS NOT NULL AND amount_usd > 0
					        AND tax_year = ?
					      GROUP BY asset_symbol
					      ORDER BY total_usd DESC`,
					args: [tenantId, year],
				});
				pipelineByAsset = assetRes.rows.map((r) => ({
					symbol: String(r.asset_symbol ?? ''),
					amount: Number(r.total_usd    ?? 0),
					count:  Number(r.event_count  ?? 0),
				}));
			}
		} catch {
			// tax_classifications may not exist yet (pipeline not run) — ignore
		}

		// Use pipeline source when available; fall back to lifecycle events.
		const resolvedByAsset = pipelineByAsset ?? byAsset;

		const ordinaryIncome = {
			total:  resolvedByAsset.reduce((s, x) => s + x.amount, 0),
			count:  resolvedByAsset.reduce((s, x) => s + x.count,  0),
			byAsset: resolvedByAsset,
			byCategory,
			// Tell the client which data source was used so the UI can show a note
			incomeSource: pipelineByAsset ? 'pipeline' : 'lifecycle',
		};

		// ── 2. Disposal summary (outgoing taxable events) ─────────────────────
		// We sum proceeds (native_usd) from out-direction lifecycle events whose
		// class is a disposal.  This is a proceeds-only number; cost basis and
		// gain/loss are in the FIFO CSV export on the transactions page.
		const disposalRes = await db.execute({
			sql: `SELECT
			        COUNT(*) AS total_count,
			        SUM(CASE WHEN ale.native_usd IS NOT NULL AND ale.native_usd > 0 THEN ale.native_usd ELSE 0 END) AS total_proceeds,
			        SUM(CASE WHEN ale.native_usd IS NULL OR ale.native_usd <= 0 THEN 1 ELSE 0 END) AS unpriced_count,
			        SUM(CASE WHEN ale.transaction_class = 'liability_liquidation' THEN 1 ELSE 0 END) AS liquidation_count
			      FROM asset_lifecycle_events ale
			      WHERE ale.tenant_id = ?
			        AND ale.direction = 'out'
			        AND ale.linked_transfer = 0
			        AND ale.transaction_class NOT IN (
			            'liability_increase', 'liability_repayment',
			            'collateral_deposit', 'collateral_withdrawal', 'interest_income'
			        )
			        AND ale.timestamp_utc BETWEEN ? AND ?`,
			args: [tenantId, from, to],
		});

		const dRow = disposalRes.rows[0] ?? {};
		const disposals = {
			totalProceeds:   Number(dRow.total_proceeds   ?? 0),
			count:           Number(dRow.total_count       ?? 0),
			unpricedCount:   Number(dRow.unpriced_count    ?? 0),
			liquidationCount: Number(dRow.liquidation_count ?? 0),
		};

		// ── 3. Unpriced onchain transactions (the raw source rows) ────────────
		const unpricedRes = await db.execute({
			sql: `SELECT COUNT(*) AS cnt
			      FROM transactions
			      WHERE tenant_id = ?
			        AND (usd_value IS NULL OR usd_value <= 0)
			        AND timestamp BETWEEN ? AND ?`,
			args: [tenantId, from, to],
		});
		const unpricedOnchain = Number(unpricedRes.rows[0]?.cnt ?? 0);

		// ── 4. Year-over-year list for the selector (available tax years) ─────
		const yearsRes = await db.execute({
			sql: `SELECT DISTINCT substr(timestamp_utc, 1, 4) AS y
			      FROM asset_lifecycle_events
			      WHERE tenant_id = ?
			      ORDER BY y DESC`,
			args: [tenantId],
		});
		const availableYears = yearsRes.rows
			.map((r) => Number(r.y))
			.filter((y) => y >= 2009 && y <= 2100);

		// ── 5. FIFO gain/loss split (short-term vs long-term) ────────────────
		// buildAnnualBreakdown runs the full FIFO engine — same data the PDF uses.
		//
		// Cache: the carryforward loop and YoY chart each call buildAnnualBreakdown
		// for every prior year.  Without a memo, 5 years of history = 10+ sequential
		// FIFO runs on every page load.  The cache is request-scoped (lives only for
		// this response) so it never serves stale data between requests.

		// Load lot pins for Specific ID method — the selectLotIndex engine already
		// supports pins but summary.ts was never passing them in, so spec_id silently
		// fell back to FIFO on every request.  Fixed here.
		let lotPins: Map<string, { acquiredAt: string; amountHint: number }> | undefined;
		if (method === 'spec_id') {
			try {
				const pinsRes = await db.execute({
					sql: `SELECT disposal_source_id, lot_acquired_at, lot_amount_hint
					      FROM tax_lot_pins WHERE tenant_id = ?`,
					args: [tenantId],
				});
				lotPins = new Map(
					(pinsRes.rows as Record<string, unknown>[]).map((r) => [
						String(r.disposal_source_id),
						{ acquiredAt: String(r.lot_acquired_at), amountHint: Number(r.lot_amount_hint) },
					])
				);
			} catch {
				// tax_lot_pins may not exist yet — fall through to FIFO
			}
		}

		// Use 'auto' source: if the pipeline has run and tax_disposals has rows for
		// this tenant+year, buildAnnualBreakdown reads from the pipeline tables
		// (IRS calendar-month FIFO, accurate is_short_term flag).  Otherwise falls
		// back to the legacy lifecycle-events path.  Each year is independently
		// resolved, so prior years with no pipeline data still work correctly.
		const bdSource: AnnualBreakdownSource = 'auto';

		type BDResult = Awaited<ReturnType<typeof buildAnnualBreakdown>>;
		const bdCache = new Map<number, BDResult>();
		const getBd = async (y: number): Promise<BDResult> => {
			if (bdCache.has(y)) return bdCache.get(y)!;
			const result = await buildAnnualBreakdown(tenantId, y, method, lotPins, bdSource);
			bdCache.set(y, result);
			return result;
		};

		const bd = await getBd(year);
		const gains = {
			shortTermGain:  bd.totals.shortTermGain,
			longTermGain:   bd.totals.longTermGain,
			netGain:        bd.totals.shortTermGain + bd.totals.longTermGain,
			shortTermCount: bd.shortTerm.length,
			longTermCount:  bd.longTerm.length,
			/** 'pipeline' when tax_disposals was used; 'lifecycle' when FIFO was re-run. */
			dataSource:     bd.dataSource,
		};

		// ── 6. Per-asset breakdown ────────────────────────────────────────────
		type AssetRow = {
			asset: string;
			stGain: number; stLots: number;
			ltGain: number; ltLots: number;
			netGain: number;
		};
		const assetMap = new Map<string, AssetRow>();
		const getRow = (asset: string): AssetRow => {
			if (!assetMap.has(asset)) {
				assetMap.set(asset, { asset, stGain: 0, stLots: 0, ltGain: 0, ltLots: 0, netGain: 0 });
			}
			return assetMap.get(asset)!;
		};
		for (const lot of bd.shortTerm) {
			const row = getRow(lot.asset);
			row.stGain += lot.gainLossUsd ?? 0;
			row.stLots += 1;
		}
		for (const lot of bd.longTerm) {
			const row = getRow(lot.asset);
			row.ltGain += lot.gainLossUsd ?? 0;
			row.ltLots += 1;
		}
		const byAssetGains = Array.from(assetMap.values())
			.map((r) => ({ ...r, netGain: r.stGain + r.ltGain }))
			.sort((a, b) => Math.abs(b.netGain) - Math.abs(a.netGain)); // largest impact first

		// ── 6b. Per-asset lot detail — individual disposal rows for drill-down ──
		// Grouped by asset, sorted by sell date. Passed to the UI so clicking an
		// asset row expands the full Form 8949–style lot list without a second fetch.
		type LotDetail = {
			amount:      number;
			buyDate:     string;
			sellDate:    string;
			costUsd:     number | null;
			proceedsUsd: number | null;
			gainLossUsd: number | null;
			daysHeld:    number;
			term:        'short' | 'long';
		};
		const lotDetails: Record<string, LotDetail[]> = {};
		for (const lot of bd.shortTerm) {
			(lotDetails[lot.asset] ??= []).push({ ...lot, term: 'short' });
		}
		for (const lot of bd.longTerm) {
			(lotDetails[lot.asset] ??= []).push({ ...lot, term: 'long' });
		}
		// Sort each asset's lots chronologically by sell date
		for (const lots of Object.values(lotDetails)) {
			lots.sort((a, b) => a.sellDate.localeCompare(b.sellDate));
		}

		// ── 7. Tax-loss harvesting — open lots vs current market price ────────
		// Aggregate stillHolding by asset, fetch spot prices, flag underwater lots.
		type HarvestRow = {
			asset: string;
			totalQty: number;
			totalCost: number;
			currentPrice: number | null;
			currentValue: number | null;
			unrealizedGainLoss: number | null;
			shortTermQty: number;   // qty still in short-term window
			longTermQty: number;    // qty already long-term
			soonestLotDaysToLT: number | null; // days until oldest ST lot crosses 1yr
		};
		const harvestMap = new Map<string, HarvestRow>();
		for (const lot of bd.stillHolding) {
			if (!harvestMap.has(lot.asset)) {
				harvestMap.set(lot.asset, {
					asset: lot.asset,
					totalQty: 0, totalCost: 0,
					currentPrice: null, currentValue: null, unrealizedGainLoss: null,
					shortTermQty: 0, longTermQty: 0, soonestLotDaysToLT: null,
				});
			}
			const row = harvestMap.get(lot.asset)!;
			row.totalQty  += lot.amount;
			row.totalCost += lot.costUsd ?? 0;
			if (lot.daysHeld >= 365) {
				row.longTermQty += lot.amount;
			} else {
				row.shortTermQty += lot.amount;
				const daysLeft = 365 - lot.daysHeld;
				if (row.soonestLotDaysToLT === null || daysLeft < row.soonestLotDaysToLT) {
					row.soonestLotDaysToLT = daysLeft;
				}
			}
		}

		// Fetch current prices for all held assets
		let harvestLosses: HarvestRow[] = [];
		try {
			const heldAssets = Array.from(harvestMap.keys());
			if (heldAssets.length > 0) {
				const tickers = await getTickersUSD() as Array<{ symbol?: string; quotes?: { USD?: { price?: number } } }>;
				const priceMap = new Map<string, number>();
				for (const t of tickers) {
					const sym = String(t.symbol ?? '').toUpperCase();
					const price = t.quotes?.USD?.price;
					if (sym && typeof price === 'number' && price > 0) priceMap.set(sym, price);
				}
				for (const row of harvestMap.values()) {
					const price = priceMap.get(row.asset) ?? null;
					row.currentPrice = price;
					if (price !== null) {
						row.currentValue = price * row.totalQty;
						row.unrealizedGainLoss = row.currentValue - row.totalCost;
					}
				}
			}
			// Only include underwater lots (negative unrealized gain); sort worst first
			harvestLosses = Array.from(harvestMap.values())
				.filter((r) => r.unrealizedGainLoss !== null && r.unrealizedGainLoss < 0)
				.sort((a, b) => (a.unrealizedGainLoss ?? 0) - (b.unrealizedGainLoss ?? 0));
		} catch (e) {
			console.warn('[tax/summary] harvest price fetch failed', e);
		}

		// ── 8. Missing cost basis report ─────────────────────────────────────
		// Two failure modes:
		//   A) Disposed lot matched a buy but the buy had no USD price (costUsd null)
		//      → gain/loss is understated; proceeds are known but basis is $0
		//   B) Disposed lot had no matching buy at all (needsAttention)
		//      → entire event is unresolved; both basis AND proceeds may be wrong
		type MissingBasisRow = {
			asset:       string;
			date:        string;
			qty:         number;
			proceeds:    number | null;
			issue:       'no_cost_basis' | 'no_matching_buy';
			daysHeld:    number | null;
			term:        'short' | 'long' | null;
		};

		const missingBasis: MissingBasisRow[] = [];

		// Mode A — disposed lots with known proceeds but null cost basis
		for (const lot of [...bd.shortTerm, ...bd.longTerm]) {
			if (lot.costUsd === null || lot.costUsd === 0) {
				missingBasis.push({
					asset:    lot.asset,
					date:     lot.sellDate,
					qty:      lot.amount,
					proceeds: lot.proceedsUsd,
					issue:    'no_cost_basis',
					daysHeld: lot.daysHeld,
					term:     lot.daysHeld >= 365 ? 'long' : 'short',
				});
			}
		}

		// Mode B — orphaned sells (no matching buy found by FIFO)
		for (const item of bd.needsAttention) {
			missingBasis.push({
				asset:    item.asset,
				date:     item.sellDate,
				qty:      item.amount,
				proceeds: item.proceedsUsd,
				issue:    'no_matching_buy',
				daysHeld: null,
				term:     null,
			});
		}

		// Sort: orphaned first (worse problem), then by date descending
		missingBasis.sort((a, b) => {
			if (a.issue !== b.issue) return a.issue === 'no_matching_buy' ? -1 : 1;
			return b.date.localeCompare(a.date);
		});

		// ── 9. Capital loss carryforward ──────────────────────────────────────
		// Walk all prior years in chronological order. For each year with a net
		// loss, $3,000 is deductible against ordinary income; the rest carries
		// forward. Any year with a net gain absorbs any existing carryforward
		// before reporting taxable gain.
		//
		// Returns: per-year ledger + current carryforward balance available this year.
		type CarryRow = {
			year:            number;
			netGainLoss:     number;  // raw ST + LT for that year
			deducted:        number;  // amount deducted vs ordinary income (max $3k)
			absorbedByGain:  number;  // carryforward consumed by a gain year
			endingBalance:   number;  // remaining carryforward after this year
		};

		const carryLedger: CarryRow[] = [];
		let carryBalance = 0;

		// Only compute if there are prior years with data
		const priorYears = bd.availableYears
			.filter((y) => y < year)
			.sort((a, b) => a - b); // oldest first

		for (const y of priorYears) {
			try {
				const pbd = await getBd(y);
				const netGL = pbd.totals.shortTermGain + pbd.totals.longTermGain;

				let deducted       = 0;
				let absorbedByGain = 0;

				if (netGL < 0) {
					// Loss year: add to carryforward pool, deduct up to $3k this year
					const totalLoss = Math.abs(netGL) + carryBalance;
					deducted     = Math.min(3000, totalLoss);
					carryBalance = totalLoss - deducted;
				} else if (netGL > 0 && carryBalance > 0) {
					// Gain year: carryforward offsets the gain first
					absorbedByGain = Math.min(carryBalance, netGL);
					carryBalance   = carryBalance - absorbedByGain;
				}

				carryLedger.push({
					year:           y,
					netGainLoss:    netGL,
					deducted,
					absorbedByGain,
					endingBalance:  carryBalance,
				});
			} catch (e) {
				console.warn(`[tax/summary] carryforward: failed year ${y}`, e);
			}
		}

		// How much carryforward is available to offset THIS year's gains
		const carryforwardAvailable = carryBalance;

		// ── 10. Gain/loss cross-check (displayed gains vs tax_disposals) ──────
		// When bd.dataSource === 'lifecycle':  displayed gains are in-memory FIFO;
		//   cross-check compares them against the pipeline's persisted output.
		//   Divergence > $100 or > 1% signals a stale pipeline or logic mismatch.
		// When bd.dataSource === 'pipeline':  displayed gains ARE from tax_disposals;
		//   both sides of the check are identical, so it always passes (expected).
		//   The check still runs so the UI can show "pipeline ✓ self-consistent".
		type GainCrossCheck = {
			pipelineStGain:  number | null;
			pipelineLtGain:  number | null;
			pipelineNet:     number | null;
			displayedStGain: number;
			displayedLtGain: number;
			displayedNet:    number;
			stDiff:          number | null;
			ltDiff:          number | null;
			netDiff:         number | null;
			withinTolerance: boolean | null;  // null when pipeline has no data
			disposalCount:   number | null;
			/** When true, both sides read from the same pipeline source — check is an identity. */
			sameSource:      boolean;
		};
		let gainCrossCheck: GainCrossCheck = {
			pipelineStGain:  null,
			pipelineLtGain:  null,
			pipelineNet:     null,
			displayedStGain: gains.shortTermGain,
			displayedLtGain: gains.longTermGain,
			displayedNet:    gains.netGain,
			stDiff:          null,
			ltDiff:          null,
			netDiff:         null,
			withinTolerance: null,
			disposalCount:   null,
			sameSource:      bd.dataSource === 'pipeline',
		};
		try {
			const xcheckRes = await db.execute({
				sql: `SELECT
				        SUM(CASE WHEN is_short_term = 1 THEN COALESCE(gain_loss_usd, 0) ELSE 0 END) AS st_gain,
				        SUM(CASE WHEN is_short_term = 0 THEN COALESCE(gain_loss_usd, 0) ELSE 0 END) AS lt_gain,
				        SUM(COALESCE(gain_loss_usd, 0))                                              AS net_gain,
				        COUNT(*)                                                                      AS disposal_count
				      FROM tax_disposals
				      WHERE tenant_id = ?
				        AND substr(disposed_at, 1, 4) = ?
				        AND gain_loss_usd IS NOT NULL`,
				args: [tenantId, String(year)],
			});
			const xr = xcheckRes.rows[0];
			if (xr && xr.disposal_count !== null && Number(xr.disposal_count) > 0) {
				const pSt   = Number(xr.st_gain    ?? 0);
				const pLt   = Number(xr.lt_gain    ?? 0);
				const pNet  = Number(xr.net_gain   ?? 0);
				const stDiff  = gains.shortTermGain - pSt;
				const ltDiff  = gains.longTermGain  - pLt;
				const netDiff = gains.netGain        - pNet;

				// Tolerance: within $100 absolute OR within 1% of the larger of the two
				const absTol = 100;
				const pctTol = 0.01;
				const scale  = Math.max(Math.abs(gains.netGain), Math.abs(pNet), 1);
				const withinTolerance = Math.abs(netDiff) <= absTol || Math.abs(netDiff) / scale <= pctTol;

				if (!withinTolerance && bd.dataSource !== 'pipeline') {
					// Only warn when the two sides are different sources — same-source
					// identity checks always pass and would spam the log.
					console.warn(
						`[tax/summary] GAIN CROSS-CHECK FAIL year=${year} ` +
						`displayedNet=${gains.netGain.toFixed(2)} pipelineNet=${pNet.toFixed(2)} ` +
						`diff=${netDiff.toFixed(2)}`,
					);
				}

				gainCrossCheck = {
					pipelineStGain:  pSt,
					pipelineLtGain:  pLt,
					pipelineNet:     pNet,
					displayedStGain: gains.shortTermGain,
					displayedLtGain: gains.longTermGain,
					displayedNet:    gains.netGain,
					stDiff,
					ltDiff,
					netDiff,
					withinTolerance,
					disposalCount:   Number(xr.disposal_count),
					sameSource:      bd.dataSource === 'pipeline',
				};
			}
		} catch {
			// tax_disposals may not exist — ignore
		}

		// ── 10b. Income cross-check (displayed income vs tax_classifications) ───
		// When bd.dataSource === 'lifecycle':  compares in-memory income total
		//   against tax_classifications. Divergence signals a stale pipeline.
		// When bd.dataSource === 'pipeline':  both sides read tax_classifications;
		//   the check is an identity (always passes) — sameSource=true is set so
		//   the UI can hide the banner rather than showing a misleading "all good".
		// Threshold: $10 absolute or 5% relative (income is smaller than gains).
		type IncomeCrossCheck = {
			pipelineTotal:   number | null;
			displayedTotal:  number;
			diff:            number | null;
			withinTolerance: boolean | null;
			sameSource:      boolean;
		};
		let incomeCrossCheck: IncomeCrossCheck = {
			pipelineTotal:   null,
			displayedTotal:  bd.totals.totalIncome ?? 0,
			diff:            null,
			withinTolerance: null,
			sameSource:      bd.dataSource === 'pipeline',
		};
		try {
			const incXRes = await db.execute({
				sql: `SELECT SUM(COALESCE(amount_usd, 0)) AS total_income
				      FROM tax_classifications
				      WHERE tenant_id = ?
				        AND category IN ('income', 'airdrop')
				        AND amount_usd IS NOT NULL AND amount_usd > 0
				        AND tax_year = ?`,
				args: [tenantId, year],
			});
			const ixr = incXRes.rows[0];
			if (ixr && ixr.total_income !== null) {
				const pTotal  = Number(ixr.total_income ?? 0);
				const dTotal  = incomeCrossCheck.displayedTotal;
				const diff    = dTotal - pTotal;
				const scale   = Math.max(Math.abs(dTotal), Math.abs(pTotal), 1);
				const withinTolerance = Math.abs(diff) <= 10 || Math.abs(diff) / scale <= 0.05;
				if (!withinTolerance && bd.dataSource !== 'pipeline') {
					// Only warn when sources differ — same-source identity checks always pass
					console.warn(
						`[tax/summary] INCOME CROSS-CHECK FAIL year=${year} ` +
						`displayed=${dTotal.toFixed(2)} pipeline=${pTotal.toFixed(2)} ` +
						`diff=${diff.toFixed(2)}`,
					);
				}
				incomeCrossCheck = {
					pipelineTotal:  pTotal,
					displayedTotal: dTotal,
					diff,
					withinTolerance,
					sameSource:     bd.dataSource === 'pipeline',
				};
			}
		} catch {
			// tax_classifications may not exist — ignore
		}

		// ── 10c. Last pipeline run status ─────────────────────────────────────
		// Surfaces the most recent tax_pipeline_runs row so the UI can show
		// "last run X ago — success/failed" and prompt a rerun if data is stale.
		type PipelineRunStatus = {
			startedAt:   string;
			completedAt: string | null;
			status:      string;
			errorMsg:    string | null;
			totalClassified: number | null;
			totalUnknown:    number | null;
		};
		let lastPipelineRun: PipelineRunStatus | null = null;
		try {
			const runRes = await db.execute({
				sql: `SELECT started_at, completed_at, status, error_message,
				             total_classified, total_unknown
				      FROM tax_pipeline_runs
				      WHERE tenant_id = ?
				      ORDER BY started_at DESC
				      LIMIT 1`,
				args: [tenantId],
			});
			if (runRes.rows.length > 0) {
				const r = runRes.rows[0] as Record<string, unknown>;
				lastPipelineRun = {
					startedAt:       String(r.started_at       ?? ''),
					completedAt:     r.completed_at  ? String(r.completed_at)  : null,
					status:          String(r.status          ?? 'unknown'),
					errorMsg:        r.error_message ? String(r.error_message) : null,
					totalClassified: r.total_classified != null ? Number(r.total_classified) : null,
					totalUnknown:    r.total_unknown    != null ? Number(r.total_unknown)    : null,
				};
			}
		} catch {
			// tax_pipeline_runs may not exist — ignore
		}

		// ── 10d. Stale pipeline detection ────────────────────────────────────
		// If new import data arrived after the last successful pipeline run,
		// the tax_disposals / tax_lots we're serving are out of date.
		// We compare MAX(created_at) across import_transactions and
		// asset_lifecycle_events against the pipeline's completed_at.
		// pipelineStale is null when the pipeline has never run (no completedAt).
		type PipelineStaleInfo = {
			stale:           boolean;
			lastRunAt:       string | null;  // completed_at of last success run
			latestImportAt:  string | null;  // newest import row's created_at
			staleSinceMs:    number | null;  // ms between pipeline run and newest import
		};
		let pipelineStale: PipelineStaleInfo = {
			stale:          false,
			lastRunAt:      null,
			latestImportAt: null,
			staleSinceMs:   null,
		};
		try {
			// Only meaningful if pipeline has successfully run AND we're serving its data
			const lastSuccessAt = lastPipelineRun?.status === 'success'
				? lastPipelineRun.completedAt ?? lastPipelineRun.startedAt
				: null;

			if (lastSuccessAt) {
				// MAX across both primary data sources the pipeline reads from
				const [importMaxRes, lifecycleMaxRes] = await Promise.all([
					db.execute({
						sql: `SELECT MAX(created_at) AS latest FROM import_transactions WHERE tenant_id = ?`,
						args: [tenantId],
					}),
					db.execute({
						sql: `SELECT MAX(created_at) AS latest FROM asset_lifecycle_events WHERE tenant_id = ?`,
						args: [tenantId],
					}).catch(() => ({ rows: [{ latest: null }] })),
				]);

				const importLatest    = importMaxRes.rows[0]     ? String((importMaxRes.rows[0] as Record<string, unknown>).latest    ?? '') : '';
				const lifecycleLatest = lifecycleMaxRes.rows[0]  ? String((lifecycleMaxRes.rows[0] as Record<string, unknown>).latest  ?? '') : '';

				// Most recent data insertion across all sources
				const latestImportAt = [importLatest, lifecycleLatest]
					.filter(Boolean)
					.sort()
					.at(-1) ?? null;

				if (latestImportAt) {
					const runTime    = new Date(lastSuccessAt).getTime();
					const importTime = new Date(latestImportAt).getTime();
					const staleSinceMs = importTime - runTime;
					pipelineStale = {
						stale:          staleSinceMs > 0,
						lastRunAt:      lastSuccessAt,
						latestImportAt,
						staleSinceMs:   staleSinceMs > 0 ? staleSinceMs : null,
					};
				}
			}
		} catch {
			// Non-fatal — stale detection is advisory only
		}

		// ── 11. Wash sale shadow tracker ──────────────────────────────────────
		// Crypto is currently exempt from wash sale rules (IRS treats it as
		// property, not a security). This section shows what would be disallowed
		// under proposed legislation that would extend wash sale rules to crypto.
		// Display-only — no tax liability is implied by these results.
		type WashSaleItem = {
			asset:              string;
			disposedAt:         string;
			lossAmount:         number;
			triggerAcquiredAt:  string;
			disallowedLoss:     number;
		};
		let washSaleShadow: { totalDisallowed: number; items: WashSaleItem[] } = {
			totalDisallowed: 0,
			items: [],
		};
		try {
			const washRes = await db.execute({
				sql: `SELECT
				        td.asset_symbol,
				        td.disposed_at,
				        td.gain_loss_usd                AS loss_amount,
				        MIN(tl.acquired_at)             AS trigger_acquired_at,
				        ABS(td.gain_loss_usd)           AS disallowed_loss
				      FROM tax_disposals td
				      JOIN tax_lots tl
				        ON  tl.tenant_id    = td.tenant_id
				        AND UPPER(tl.asset_symbol) = UPPER(td.asset_symbol)
				        AND tl.lot_type     = 'purchase'
				        AND ABS(CAST(julianday(tl.acquired_at) - julianday(td.disposed_at) AS INTEGER)) <= 30
				      WHERE td.tenant_id     = ?
				        AND td.gain_loss_usd < -0.01
				        AND substr(td.disposed_at, 1, 4) = ?
				      GROUP BY td.id
				      ORDER BY td.gain_loss_usd ASC
				      LIMIT 100`,
				args: [tenantId, String(year)],
			});
			const washItems: WashSaleItem[] = washRes.rows.map((r) => ({
				asset:             String(r.asset_symbol         ?? ''),
				disposedAt:        String(r.disposed_at          ?? ''),
				lossAmount:        Number(r.loss_amount          ?? 0),
				triggerAcquiredAt: String(r.trigger_acquired_at  ?? ''),
				disallowedLoss:    Number(r.disallowed_loss      ?? 0),
			}));
			washSaleShadow = {
				totalDisallowed: washItems.reduce((s, x) => s + x.disallowedLoss, 0),
				items: washItems,
			};
		} catch {
			// tax_disposals / tax_lots may not exist — ignore
		}

		// Persist wash sale results so the data survives across requests and can
		// be used for basis adjustments when legislation passes.
		// Atomic: DELETE prior rows for this tenant+year then INSERT fresh ones.
		if (washSaleShadow.items.length > 0) {
			try {
				const { randomUUID } = await import('node:crypto');
				const washStmts = [
					{
						sql: `DELETE FROM tax_wash_sales WHERE tenant_id = ? AND tax_year = ?`,
						args: [tenantId, year],
					},
					...washSaleShadow.items.map((item) => ({
						sql: `INSERT INTO tax_wash_sales
						      (id, tenant_id, tax_year, asset_symbol, disposed_at,
						       loss_amount_usd, trigger_acquired_at, disallowed_loss_usd)
						      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						args: [
							randomUUID(), tenantId, year,
							item.asset, item.disposedAt,
							item.lossAmount, item.triggerAcquiredAt, item.disallowedLoss,
						],
					})),
				];
				await db.batch(washStmts, 'write');
			} catch {
				// tax_wash_sales may not exist yet — migration may not have run
			}
		}

		// ── 11. DeFi events summary ───────────────────────────────────────────
		// Groups flagged DeFi classifications from the pipeline for display.
		type DefiTypeRow = { type: string; label: string; count: number; totalUsd: number };
		const DEFI_LABELS: Record<string, string> = {
			'lp-deposit':    'LP Deposits',
			'lp-withdrawal': 'LP Withdrawals',
			'rebase-income': 'Rebase Income',
			'wrapped-swap':  'Wrapped Token Swaps',
		};
		let defiEvents: { count: number; byType: DefiTypeRow[] } = { count: 0, byType: [] };
		try {
			const defiRes = await db.execute({
				sql: `SELECT category,
				             SUM(COALESCE(amount_usd, 0)) AS total_usd,
				             COUNT(*) AS event_count
				      FROM tax_classifications
				      WHERE tenant_id = ?
				        AND category IN ('lp-deposit','lp-withdrawal','rebase-income','wrapped-swap')
				        AND tax_year = ?
				      GROUP BY category
				      ORDER BY total_usd DESC`,
				args: [tenantId, year],
			});
			const byType: DefiTypeRow[] = defiRes.rows.map((r) => {
				const cat = String(r.category ?? '');
				return {
					type:     cat,
					label:    DEFI_LABELS[cat] ?? cat,
					count:    Number(r.event_count ?? 0),
					totalUsd: Number(r.total_usd   ?? 0),
				};
			});
			defiEvents = {
				count:  byType.reduce((s, x) => s + x.count, 0),
				byType,
			};
		} catch {
			// tax_classifications may not exist — ignore
		}

		// ── 13. Year-over-year gain/loss summary ──────────────────────────────
		// Build one row per available year so the chart has full history.
		// We already computed prior years for carryforward; include current year too.
		type YoYRow = { year: number; stGain: number; ltGain: number; netGain: number };
		const yoyRows: YoYRow[] = [];

		for (const y of [...priorYears, year]) {
			try {
				const ybd = await getBd(y);
				yoyRows.push({
					year:    y,
					stGain:  ybd.totals.shortTermGain,
					ltGain:  ybd.totals.longTermGain,
					netGain: ybd.totals.shortTermGain + ybd.totals.longTermGain,
				});
			} catch (e) {
				console.warn(`[tax/summary] yoy: failed year ${y}`, e);
			}
		}

		const payload = {
			ok: true,
			year,
			method,
			availableYears: bd.availableYears,
			ordinaryIncome,
			disposals,
			unpricedOnchain,
			gains,
			byAssetGains,
			lotDetails,
			harvestLosses,
			missingBasis,
			carryLedger,
			carryforwardAvailable,
			yoyRows,
			gainCrossCheck,
			incomeCrossCheck,
			lastPipelineRun,
			pipelineStale,
			washSaleShadow,
			defiEvents,
		};

		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
		void setCache(tursoKey, payload, CACHE_TTL);

		return respond({ ...payload, cached: false });
	} catch (error) {
		console.error('[tax/summary] failed:', error);
		return respond({ ok: false, error: t.unableToBuildSummary }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
