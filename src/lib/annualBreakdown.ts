/**
 * annualBreakdown.ts
 * Builds the five tax-year sections from lifecycle events + import transactions,
 * OR from pipeline tables (tax_disposals / tax_lots / tax_classifications) when
 * the pipeline has already run for the requested year.
 *
 * Sections:
 *   1. needsAttention  – sells with no traceable buy (orphaned / problem children)
 *   2. stillHolding    – FIFO lots still open at year-end
 *   3. shortTerm       – settled lots held < 365 days  (sold in selected year)
 *   4. longTerm        – settled lots held ≥ 365 days  (sold in selected year)
 *   5. income          – interest, staking, rewards, cashback in selected year
 *
 * Data source options:
 *   'lifecycle' (default) – reads asset_lifecycle_events and import_transactions
 *                           (original FIFO re-computation path)
 *   'pipeline'            – reads tax_disposals / tax_lots / tax_classifications
 *                           (pipeline's persisted, IRS-calendar-month-accurate output)
 *   'auto'                – uses 'pipeline' if tax_disposals has rows for tenant+year;
 *                           falls back to 'lifecycle' otherwise
 */

import { db } from './db';
import { getAaveDepositTax, type AaveDepositTax } from './jurisdictionProfile';
import { selectLotIndex, type SelectableLot, type CostBasisMethod } from './yearEnd/lotSelection';
import { getImportTransactionColumns } from './importTransactionsSchema';
import { INCOME_KINDS } from './incomeKinds';
import { classifyTokenName } from './tokenClassification';
import { getIncomeOverrides } from './tokenOverrides';
import { deriveReceiptBasis } from './receiptBasis';
import { getNftCosts, lookupNftCost } from './nftCost';

// Re-export so existing callers importing INCOME_KINDS from here keep working.
export { INCOME_KINDS };

// ─── Types ────────────────────────────────────────────────────────────────────

export type UnsettledItem = {
  asset: string;
  amount: number;
  sellDate: string;
  proceedsUsd: number | null;
  sourceId: string;
  groupId: string;
  txHash: string | null;
  /** Raw transaction_class from the lifecycle event — 'other' is the key scam signal */
  transactionClass: string;
  /** Import source name (e.g. "Venmo", "Coinbase CSV") */
  sourceType: string;
};

export type HeldPosition = {
  asset: string;
  amount: number;
  acquiredDate: string;
  costUsd: number | null;
  /** days held as of Dec 31 of selected year (or today if current year) */
  daysHeld: number;
};

/**
 * Where a disposal's cost basis came from — the audit trail. So that if tax laws
 * change, or a user wants the complete provenance of every coin, it's all recoverable:
 *  - 'recorded'  — basis from a real acquisition we have on file (exchange buy, priced on-chain receipt)
 *  - 'manual'    — a user/good-faith estimated basis (manual_cost_basis override)
 *  - 'estimated' — basis from a backfilled/looked-up historical price (a good-faith guess)
 *  - 'missing'   — no recorded basis; treated as $0 and flagged for review (a "mystery" inflow)
 */
export type BasisSource = 'recorded' | 'estimated' | 'manual' | 'missing';

export type SettledLot = {
  asset: string;
  amount: number;
  buyDate: string;
  sellDate: string;
  costUsd: number | null;
  proceedsUsd: number | null;
  gainLossUsd: number | null;
  daysHeld: number;
  /** Provenance — where this disposal's cost basis came from (audit trail). */
  basisSource?: BasisSource;
  /** Human-readable trace of how/when the disposed lot was acquired. */
  originNote?: string;
};

export type IncomeItem = {
  asset: string;
  amount: number;
  usdValue: number | null;
  date: string;
  kind: string;
  description: string | null;
  /**
   * Provenance of the USD FMV — the IRS "FMV at time of receipt" audit trail.
   * null → the source (exchange CSV) recorded the USD itself (contemporaneous);
   * 'coingecko:*' → estimated from a historical index; 'inferred:stablecoin-peg' → $1.
   */
  priceSource: string | null;
  /** ISO timestamp of the price actually used (the index tick), when estimated. */
  priceAsof: string | null;
};

/** FMV provenance category for an income row — drives the badge/column label. */
export type FmvSource = 'source' | 'estimated' | 'stablecoin' | 'unpriced';

/** Classify an income row's FMV provenance from its stored price_source + USD value. */
export function fmvSourceCategory(priceSource: string | null | undefined, usdValue: number | null | undefined): FmvSource {
  if (usdValue == null || !Number.isFinite(usdValue)) return 'unpriced';
  if (!priceSource) return 'source'; // exchange/source-recorded USD — contemporaneous
  if (priceSource.startsWith('inferred:stablecoin')) return 'stablecoin';
  return 'estimated'; // coingecko:range / coingecko:history / any looked-up price
}

export type NftHolding = {
  name: string;
  symbol: string | null;
  chain: string;
  contract: string;
  tokenId: string;
  url: string | null;
  walletId: string;
  /**
   * Acquisition cost basis in USD, when known. NFT cost basis is not derived from
   * on-chain acquisition transactions yet, so this is usually undefined; the UI
   * only shows a cost when it is present and > $1 (no placeholder clutter).
   */
  costUsd?: number | null;
};

export type SectionTotals = {
  unsettledProceeds: number;
  shortTermGain: number;
  longTermGain: number;
  totalIncome: number;
  heldCostBasis: number;
  /** Sum of exchange fees in USD for the year (native-only gas is excluded — see gasByChain). */
  transactionCostsUsd: number;
};

export type AaveDepositItem = {
  asset: string;
  amount: number;              // token quantity supplied to Aave
  date: string;                // deposit timestamp
  amountUsd: number | null;    // FMV at deposit (the would-be proceeds)
  costBasisUsd: number | null; // cost basis of the supplied lots (null if untraced)
  gainLossUsd: number | null;  // amountUsd − costBasisUsd
  txHash: string | null;
};

/**
 * One transaction cost (fee) the user paid in the selected year. Trading fees are
 * tax-relevant: they add to cost basis on an acquisition and reduce proceeds on a
 * disposal, so a tax pro wants them itemized. Exchange fees arrive already in USD
 * (fee_usd); a native-only fee keeps its own currency for display.
 */
export type TransactionCostItem = {
  date: string;                 // transaction timestamp
  source: string;               // exchange / import source (coinbase, kraken, …)
  asset: string;                // asset the trade was in
  feeUsd: number | null;        // fee in USD (import_transactions.fee_usd)
  feeNative: number | null;     // fee in its native currency, when USD is absent
  feeCurrency: string | null;   // symbol for feeNative
  description: string | null;
};

/**
 * On-chain gas paid, summarized per chain in the chain's native token. Gas is stored
 * as wei strings per chain (transactions.fee_paid) and is NOT USD-priced here — we
 * surface it as a native-unit subtotal so the number is honest rather than a fabricated
 * dollar figure. Kept separate from the itemized exchange-fee list for that reason.
 */
export type GasCostByChain = {
  chain: string;                // ethereum, polygon, avalanche, …
  nativeSymbol: string;         // ETH, POL, AVAX, …
  totalNative: number;          // summed gas in native units
  txCount: number;              // transactions contributing gas
};

export type AnnualBreakdown = {
  year: number;
  availableYears: number[];
  needsAttention: UnsettledItem[];
  stillHolding: HeldPosition[];
  shortTerm: SettledLot[];
  longTerm: SettledLot[];
  income: IncomeItem[];
  /** Card rebates (Crypto.com "Card Rebate" transactions) — non-taxable, shown separately. */
  cardRebates: IncomeItem[];
  /** Itemized exchange/trading fees paid in the selected year (USD where available). */
  transactionCosts: TransactionCostItem[];
  /** On-chain gas paid, summarized per chain in native units (not USD-priced). */
  gasByChain: GasCostByChain[];
  /** Fee coverage in the year: how many import rows carried a fee vs. total rows. */
  feeCoverage: { withFee: number; total: number };
  nftHoldings: NftHolding[];
  /** Aave supplies surfaced as POTENTIAL taxable disposals (contested — see aaveDepositTax). */
  aaveDeposits?: AaveDepositItem[];
  /** The tenant's district choice governing how the above are treated. */
  aaveDepositTax?: AaveDepositTax;
  totals: SectionTotals;
  /** Which data source was actually used to compute capital gains/income. */
  dataSource: 'lifecycle' | 'pipeline';
  /** The cost-basis method actually applied to lot matching (so labels can't drift). */
  method: CostBasisMethod;
};

/** Controls which data source buildAnnualBreakdown reads from. */
export type AnnualBreakdownSource = 'lifecycle' | 'pipeline' | 'auto';

/** Human label for a cost-basis method — the single formatter the UI + PDF use. */
export function formatCostBasisMethod(method: CostBasisMethod): string {
  switch (method) {
    case 'fifo':    return 'FIFO';
    case 'lifo':    return 'LIFO';
    case 'hifo':    return 'HIFO';
    case 'spec_id': return 'Specific ID';
    default:        return String(method).toUpperCase();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const toStr = (v: unknown): string =>
  typeof v === 'string' ? v : String(v ?? '');

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86_400_000);
}

// ─── Main export ──────────────────────────────────────────────────────────────

// Re-export so callers can import CostBasisMethod from here (backwards-compatible)
export type { CostBasisMethod };

export async function buildAnnualBreakdown(
  tenantId: string,
  year: number,
  method: CostBasisMethod = 'fifo',
  lotPins?: Map<string, { acquiredAt: string; amountHint: number }>,
  source: AnnualBreakdownSource = 'lifecycle',
): Promise<AnnualBreakdown> {
  const yearStart = `${year}-01-01T00:00:00.000Z`;
  const yearEnd   = `${year}-12-31T23:59:59.999Z`;
  // For "still holding" age calculation: end of year (or now if current year)
  const now = new Date();
  const refDate =
    year >= now.getUTCFullYear()
      ? now.toISOString()
      : yearEnd;

  // FMV-provenance columns may not exist on older DBs — select them resiliently.
  const importCols = await getImportTransactionColumns();
  const priceSrcSel  = (alias = '') => `${importCols.has('price_source') ? alias + 'price_source' : 'NULL'} AS price_source`;
  const priceAsofSel = (alias = '') => `${importCols.has('price_asof')   ? alias + 'price_asof'   : 'NULL'} AS price_asof`;

  // ── Resolve 'auto' → concrete source ────────────────────────────────────
  let resolvedSource: 'lifecycle' | 'pipeline' = 'lifecycle';
  if (source === 'pipeline') {
    resolvedSource = 'pipeline';
  } else if (source === 'auto') {
    try {
      const countRes = await db.execute({
        sql: `SELECT COUNT(*) AS cnt FROM tax_disposals
              WHERE tenant_id = ? AND substr(disposed_at, 1, 4) = ?`,
        args: [tenantId, String(year)],
      });
      const cnt = Number((countRes.rows[0] as Record<string, unknown>)?.cnt ?? 0);
      resolvedSource = cnt > 0 ? 'pipeline' : 'lifecycle';
    } catch {
      // tax_disposals may not exist — fall through to lifecycle
      resolvedSource = 'lifecycle';
    }
  }

  // ── Core sections: built from the chosen source ──────────────────────────
  let needsAttentionRaw: UnsettledItem[]  = [];
  let shortTerm: SettledLot[]            = [];
  let longTerm: SettledLot[]             = [];
  let stillHolding: HeldPosition[]       = [];
  let income: IncomeItem[]               = [];
  let cardRebates: IncomeItem[]          = [];
  // Aave supplies surfaced for review — populated by the lifecycle FIFO pass below.
  const aaveDeposits: AaveDepositItem[]  = [];
  const aaveDepositTax = await getAaveDepositTax(tenantId);

  if (resolvedSource === 'pipeline') {
    // ── PIPELINE PATH ────────────────────────────────────────────────────
    // Reads tax_disposals (joined to tax_lots for acquired_at) + tax_classifications.
    // This is the IRS-calendar-month-accurate, persisted FIFO output.

    // 1. Settled disposals
    const disposalRes = await db.execute({
      sql: `SELECT td.asset_symbol,
                   td.quantity,
                   td.proceeds_usd,
                   td.cost_basis_usd,
                   td.gain_loss_usd,
                   td.is_short_term,
                   td.disposed_at,
                   td.source_id,
                   td.source_type,
                   td.category,
                   td.lot_id,
                   td.notes,
                   tl.acquired_at
              FROM tax_disposals td
              LEFT JOIN tax_lots tl
                ON tl.id = td.lot_id AND tl.tenant_id = td.tenant_id
             WHERE td.tenant_id = ?
               AND substr(td.disposed_at, 1, 4) = ?
             ORDER BY td.disposed_at ASC`,
      args: [tenantId, String(year)],
    });

    type RawDisposal = {
      asset_symbol: unknown; quantity: unknown; proceeds_usd: unknown;
      cost_basis_usd: unknown; gain_loss_usd: unknown; is_short_term: unknown;
      disposed_at: unknown; source_id: unknown; source_type: unknown;
      category: unknown; lot_id: unknown; notes: unknown; acquired_at: unknown;
    };

    for (const r of disposalRes.rows as unknown as RawDisposal[]) {
      const lotId = toStr(r.lot_id);

      if (lotId === 'unmatched') {
        // Orphaned — no matching acquisition lot
        needsAttentionRaw.push({
          asset:            toStr(r.asset_symbol).toUpperCase(),
          amount:           Math.abs(Number(r.quantity ?? 0)),
          sellDate:         toStr(r.disposed_at),
          proceedsUsd:      toNum(r.proceeds_usd),
          sourceId:         toStr(r.source_id),
          groupId:          toStr(r.source_id), // no group_id in pipeline; use source_id
          txHash:           null,
          transactionClass: toStr(r.category),
          sourceType:       toStr(r.source_type),
        });
        continue;
      }

      const acquiredAt = toStr(r.acquired_at);
      const disposedAt = toStr(r.disposed_at);
      const daysHeld   = acquiredAt ? daysBetween(acquiredAt, disposedAt) : 0;
      const settled: SettledLot = {
        asset:        toStr(r.asset_symbol).toUpperCase(),
        amount:       Math.abs(Number(r.quantity ?? 0)),
        buyDate:      acquiredAt || disposedAt,
        sellDate:     disposedAt,
        costUsd:      toNum(r.cost_basis_usd),
        proceedsUsd:  toNum(r.proceeds_usd),
        gainLossUsd:  toNum(r.gain_loss_usd),
        daysHeld,
        basisSource:  toNum(r.cost_basis_usd) != null ? 'recorded' : 'missing',
        originNote:   acquiredAt ? `Acquired ${acquiredAt.slice(0, 10)}` : 'Origin unknown — verify acquisition',
      };
      // The pipeline uses IRS calendar-month rule (is_short_term stored as 0/1).
      if (Number(r.is_short_term)) shortTerm.push(settled);
      else                         longTerm.push(settled);
    }

    // 2. Open lots (still holding as of year-end)
    const lotsRes = await db.execute({
      sql: `SELECT asset_symbol, acquired_at, remaining_qty, cost_basis_usd
              FROM tax_lots
             WHERE tenant_id = ?
               AND is_exhausted = 0
               AND acquired_at <= ?
             ORDER BY asset_symbol ASC, acquired_at ASC`,
      args: [tenantId, yearEnd],
    });

    type RawLot = {
      asset_symbol: unknown; acquired_at: unknown;
      remaining_qty: unknown; cost_basis_usd: unknown;
    };
    for (const r of lotsRes.rows as unknown as RawLot[]) {
      const qty = Number(r.remaining_qty ?? 0);
      if (qty <= 0) continue;
      const acquiredAt = toStr(r.acquired_at);
      stillHolding.push({
        asset:        toStr(r.asset_symbol).toUpperCase(),
        amount:       qty,
        acquiredDate: acquiredAt,
        costUsd:      toNum(r.cost_basis_usd),
        daysHeld:     daysBetween(acquiredAt, refDate),
      });
    }

    // 3. Income from pipeline classifications, joined to source tx for dates/amounts
    const incomeRes = await db.execute({
      sql: `SELECT tc.asset_symbol,
                   tc.amount_usd,
                   tc.category,
                   tc.sub_category,
                   tc.source_id,
                   tc.source_type,
                   COALESCE(it.amount, 0)           AS token_amount,
                   COALESCE(it.timestamp_utc,
                            tc.created_at)           AS tx_date,
                   it.kind,
                   it.description,
                   it.notes                          AS tx_notes,
                   ${priceSrcSel('it.')},
                   ${priceAsofSel('it.')}
              FROM tax_classifications tc
              LEFT JOIN import_transactions it
                ON it.id = tc.source_id AND tc.source_type = 'import'
             WHERE tc.tenant_id = ?
               AND tc.category IN ('income', 'airdrop', 'card-rebate')
               AND tc.tax_year = ?
             ORDER BY tx_date DESC`,
      args: [tenantId, year],
    });

    type RawIncome = {
      asset_symbol: unknown; amount_usd: unknown; category: unknown;
      sub_category: unknown; source_id: unknown; source_type: unknown;
      token_amount: unknown; tx_date: unknown; kind: unknown;
      description: unknown; tx_notes: unknown;
      price_source: unknown; price_asof: unknown;
    };
    const allIncomeRows = (incomeRes.rows as unknown as RawIncome[]).map((r) => {
      const item: IncomeItem = {
        asset:       toStr(r.asset_symbol).toUpperCase(),
        amount:      Math.abs(Number(r.token_amount ?? 0)),
        usdValue:    toNum(r.amount_usd),
        date:        toStr(r.tx_date),
        kind:        toStr(r.sub_category ?? r.category),
        description: typeof r.description === 'string' ? r.description
                   : typeof r.tx_notes    === 'string' ? r.tx_notes
                   : null,
        priceSource: typeof r.price_source === 'string' ? r.price_source : null,
        priceAsof:   typeof r.price_asof   === 'string' ? r.price_asof   : null,
      };
      return { item, isCardRebate: toStr(r.category) === 'card-rebate' };
    });
    income      = allIncomeRows.filter((r) => !r.isCardRebate).map((r) => r.item);
    cardRebates = allIncomeRows.filter((r) =>  r.isCardRebate).map((r) => r.item);

  } else {
    // ── LIFECYCLE PATH (original) ────────────────────────────────────────

    // ── 1. Fetch all lifecycle events up to year end ────────────────────
    const eventsResult = await db.execute({
      sql: `SELECT g.asset_symbol    AS asset_symbol,
                 e.direction         AS direction,
                 e.amount            AS amount,
                 e.native_usd        AS native_usd,
                 e.timestamp_utc     AS timestamp_utc,
                 e.transaction_class AS transaction_class,
                 e.source_id         AS source_id,
                 e.group_id          AS group_id,
                 e.tx_hash           AS tx_hash,
                 e.source_type       AS source_type
            FROM asset_lifecycle_events e
            LEFT JOIN asset_lifecycle_groups g
              ON g.id = e.group_id AND g.tenant_id = e.tenant_id
            WHERE e.tenant_id = ?
              AND e.timestamp_utc <= ?
            ORDER BY e.timestamp_utc ASC`,
      args: [tenantId, yearEnd],
    });

    // Classes to exclude ENTIRELY from FIFO.
    // liability_increase covers BOTH the debt token mint AND the borrow proceeds IN from
    // the pool — neither creates a real owned lot (the proceeds are a liability, not equity).
    // interest_income feeds the income section separately.
    const SKIP_CLASSES = new Set([
      'liability_increase',    // borrow proceeds IN + debt token minted — no real lot
      'interest_income',       // handled separately in the income section
    ]);

    // Classes that DO move real-asset lots through FIFO but are NOT taxable capital events.
    // Repayments must consume the underlying lot (e.g. USDC repaid to Aave should clear the
    // USDC cost-basis lot) but produce no gain/loss — cost basis simply returns to the
    // protocol.  Debt-token burns have no matching lot and are silently dropped (isTaxable=false).
    const FIFO_NONTAXABLE = new Set([
      'collateral_deposit',    // USDC → aUSDC: cost moves to protocol, no taxable event
      'collateral_withdrawal', // aUSDC → USDC: cost returns from protocol, no taxable event
      'liability_repayment',   // USDC repaid to Aave: consumes USDC lot, no gain/loss
                               //   variableDebt burn: no lot exists → silently dropped
    ]);

    // ── 1a. Sui wallet transactions ─────────────────────────────────────
    const suiTxResult = await db.execute({
      sql: `SELECT symbol, amount, decimals, timestamp
            FROM sui_transactions
            WHERE tenant_id = ?
              AND timestamp <= ?
              AND CAST(amount AS REAL) != 0
            ORDER BY timestamp ASC`,
      args: [tenantId, yearEnd],
    });

    type RawSuiTx = { symbol: unknown; amount: unknown; decimals: unknown; timestamp: unknown };

    function suiRawToDecimal(raw: string, decimals: number): number {
      try {
        const negative = raw.startsWith('-');
        const abs = BigInt(negative ? raw.slice(1) : raw);
        const base = 10n ** BigInt(decimals);
        const whole = abs / base;
        const frac  = abs % base;
        const num   = Number(`${whole}.${String(frac).padStart(decimals, '0')}`);
        return negative ? -num : num;
      } catch { return 0; }
    }

    const suiEvents = (suiTxResult.rows as unknown as RawSuiTx[]).flatMap((r) => {
      const raw      = toStr(r.amount);
      const decimals = Number(r.decimals ?? 9);
      const value    = suiRawToDecimal(raw, decimals);
      if (!value) return [];
      return [{
        asset_symbol:      toStr(r.symbol).toUpperCase(),
        direction:         value < 0 ? 'out' : 'in',
        amount:            Math.abs(value),
        native_usd:        null as number | null,
        timestamp_utc:     toStr(r.timestamp),
        transaction_class: 'owned_acquisition',
        source_id:         '' as unknown,
        group_id:          '' as unknown,
        tx_hash:           null as unknown,
        source_type:       'sui' as unknown,
      }];
    });

    // ── 1b. Custom wallet manual transactions ───────────────────────────
    // Stored in `transactions` table with metadata_json containing isCustomEntry:true
    const customTxResult = await db.execute({
      sql: `SELECT token_symbol, tx_type, timestamp, metadata_json
            FROM transactions
            WHERE tenant_id = ?
              AND timestamp <= ?
              AND metadata_json LIKE '%"isCustomEntry":true%'
            ORDER BY timestamp ASC`,
      args: [tenantId, yearEnd],
    });

    type RawCustomTx = { token_symbol: unknown; tx_type: unknown; timestamp: unknown; metadata_json: unknown };
    const customEvents = (customTxResult.rows as unknown as RawCustomTx[]).flatMap((r) => {
      try {
        const meta      = JSON.parse(toStr(r.metadata_json));
        const direction = meta.direction === 'out' ? 'out' : 'in';
        const amount    = Number(meta.amount ?? 0);
        const nativeUsd = typeof meta.usdValue === 'number' ? meta.usdValue : null;
        if (!amount) return [];
        return [{
          asset_symbol:      toStr(r.token_symbol).toUpperCase(),
          direction,
          amount,
          native_usd:        nativeUsd,
          timestamp_utc:     toStr(r.timestamp),
          transaction_class: 'owned_acquisition',
          source_id:         '' as unknown,
          group_id:          '' as unknown,
          tx_hash:           null as unknown,
          source_type:       'manual' as unknown,
        }];
      } catch { return []; }
    });

    type RawEvent = { asset_symbol: unknown; direction: unknown; amount: unknown; native_usd: unknown; timestamp_utc: unknown; transaction_class: unknown; source_id: unknown; group_id: unknown; tx_hash: unknown; source_type: unknown };
    const events = [
      ...(eventsResult.rows as unknown as RawEvent[])
        .filter((r) => r && !SKIP_CLASSES.has(toStr(r.transaction_class))),
      ...customEvents,
      ...suiEvents,
    ].sort((a, b) => toStr(a.timestamp_utc).localeCompare(toStr(b.timestamp_utc)));

    // Lot selection delegated to lotSelection.ts (pure, unit-tested).
    // Wrap to bind the closure variables (method, lotPins) from this scope.
    type Lot = SelectableLot;
    const pickLot = (list: Lot[], disposalSourceId?: string) =>
      selectLotIndex(list, method, disposalSourceId, lotPins);

    // Manual cost-basis overrides for the lifecycle path: an explicit basis set for a
    // sell (sell_source_id -> price_per_token + buy date) wins over FIFO-matched lots.
    const manualBasisRows = await db.execute({
      sql: `SELECT sell_source_id, price_per_token, buy_date_iso, notes FROM manual_cost_basis WHERE tenant_id = ?`,
      args: [tenantId],
    });
    const manualBasisMap = new Map<string, { pricePerToken: number; buyDateIso: string; notes: string }>();
    for (const r of manualBasisRows.rows as Array<Record<string, unknown>>) {
      const sid = toStr(r.sell_source_id);
      const ppt = toNum(r.price_per_token);
      if (sid && ppt != null) manualBasisMap.set(sid, { pricePerToken: ppt, buyDateIso: toStr(r.buy_date_iso), notes: toStr(r.notes) });
    }

    const lotsByAsset = new Map<string, Lot[]>();
    const needsAttentionLifecycle: UnsettledItem[] = [];

    for (const row of events) {
      const asset     = toStr(row.asset_symbol).toUpperCase();
      if (!asset) continue;
      const direction = toStr(row.direction);
      const amount    = Math.abs(Number(row.amount ?? 0));
      if (!amount) continue;
      const timestamp = toStr(row.timestamp_utc);
      const nativeUsd = toNum(row.native_usd);

      if (direction === 'in') {
        const list = lotsByAsset.get(asset) ?? [];
        list.push({ amount, timestamp, costUsd: nativeUsd });
        lotsByAsset.set(asset, list);
        continue;
      }

      if (direction === 'out') {
        // Only bucket settled/unsettled if the SELL happened in this year
        const sellInYear =
          timestamp >= yearStart && timestamp <= yearEnd;
        // Aave pass-through transfers (collateral_deposit / collateral_withdrawal) move
        // the cost basis but are NOT taxable disposals — consume lots but skip gain/loss.
        const txClass = toStr(row.transaction_class);
        const isTaxable = !FIFO_NONTAXABLE.has(txClass);
        const disposalSrcId: string | undefined = typeof row.source_id === 'string' ? row.source_id : undefined;

        // Manual cost-basis override: an explicit user/resolver-set basis for this sell
        // wins over FIFO-matched lots (which are wrong when coins arrived via an untraced
        // transfer). We still consume lots so remaining holdings stay correct.
        const manual = disposalSrcId ? manualBasisMap.get(disposalSrcId) : undefined;
        if (manual && sellInYear && isTaxable) {
          const costUsd = amount * manual.pricePerToken;
          const buyDate = manual.buyDateIso || timestamp;
          const days    = daysBetween(buyDate, timestamp);
          const settled: SettledLot = {
            asset, amount, buyDate, sellDate: timestamp,
            costUsd, proceedsUsd: nativeUsd,
            gainLossUsd: nativeUsd != null ? nativeUsd - costUsd : null,
            daysHeld: days,
            basisSource: 'manual',
            originNote: manual.notes
              ? `Estimated basis — ${manual.notes}`
              : `Estimated basis $${manual.pricePerToken.toLocaleString()}/${asset}, acquired ${buyDate.slice(0, 10)}`,
          };
          if (days < 365) shortTerm.push(settled); else longTerm.push(settled);
          // Consume FIFO lots so remaining holdings don't double-count this disposal.
          const olots = lotsByAsset.get(asset) ?? [];
          let orem = amount;
          while (orem > 0 && olots.length) {
            const oi = pickLot(olots, disposalSrcId);
            const otake = Math.min(orem, olots[oi].amount);
            if (olots[oi].costUsd != null) olots[oi].costUsd = (olots[oi].costUsd ?? 0) - (otake / olots[oi].amount) * (olots[oi].costUsd ?? 0);
            olots[oi].amount -= otake;
            if (olots[oi].amount <= 0) olots.splice(oi, 1);
            orem -= otake;
          }
          lotsByAsset.set(asset, olots);
          continue;
        }

        // Aave deposit (collateral_deposit): accumulate the supplied lots' cost basis
        // so we can surface the would-be gain/loss for review. Additive — does not
        // change realized gains, lots, or the (still non-taxable) treatment.
        const isAaveDeposit = txClass === 'collateral_deposit';
        let aaveCostBasis = 0;
        let aaveBasisComplete = true;

        let remaining = amount;
        const list    = lotsByAsset.get(asset) ?? [];

        while (remaining > 0) {
          if (list.length === 0) {
            if (isAaveDeposit) aaveBasisComplete = false;
            // orphaned — no matching buy found (only flag if it's a real taxable sell)
            if (sellInYear && isTaxable) {
              needsAttentionLifecycle.push({
                asset,
                amount: remaining,
                sellDate: timestamp,
                proceedsUsd: nativeUsd
                  ? (remaining / amount) * nativeUsd
                  : null,
                sourceId: typeof row.source_id === 'string' ? row.source_id : '',
                groupId: typeof row.group_id === 'string' ? row.group_id : '',
                txHash: typeof row.tx_hash === 'string' ? row.tx_hash : null,
                transactionClass: txClass,
                sourceType: typeof row.source_type === 'string' ? row.source_type : '',
              });
            }
            break;
          }
          const lotIdx = pickLot(list, disposalSrcId);
          const lot    = list[lotIdx];

          const take        = Math.min(remaining, lot.amount);
          const costPortion =
            lot.costUsd != null ? (take / lot.amount) * lot.costUsd : null;
          if (isAaveDeposit) {
            if (costPortion != null) aaveCostBasis += costPortion;
            else aaveBasisComplete = false;
          }
          const sellPortion =
            nativeUsd != null ? (take / amount) * nativeUsd : null;
          const gainLoss =
            costPortion != null && sellPortion != null
              ? sellPortion - costPortion
              : null;
          const days = daysBetween(lot.timestamp, timestamp);

          if (sellInYear && isTaxable) {
            const settled: SettledLot = {
              asset,
              amount: take,
              buyDate:    lot.timestamp,
              sellDate:   timestamp,
              costUsd:    costPortion,
              proceedsUsd: sellPortion,
              gainLossUsd: gainLoss,
              daysHeld:   days,
              basisSource: costPortion != null ? 'recorded' : 'missing',
              originNote: costPortion != null
                ? `Acquired ${lot.timestamp.slice(0, 10)} (recorded cost basis)`
                : `Acquired ${lot.timestamp.slice(0, 10)} — no recorded cost basis (treated as $0; verify origin)`,
            };
            if (days < 365) shortTerm.push(settled);
            else            longTerm.push(settled);
          }

          // Reduce the lot's remaining cost basis proportionally so that
          // subsequent partial sells and stillHolding don't double-count it
          if (costPortion != null) {
            lot.costUsd = (lot.costUsd ?? 0) - costPortion;
          }
          lot.amount -= take;
          if (lot.amount <= 0) list.splice(lotIdx, 1);
          remaining -= take;
        }

        lotsByAsset.set(asset, list);

        if (isAaveDeposit && sellInYear) {
          aaveDeposits.push({
            asset, amount, date: timestamp,
            amountUsd: nativeUsd,
            costBasisUsd: aaveBasisComplete ? aaveCostBasis : null,
            gainLossUsd: (nativeUsd != null && aaveBasisComplete) ? nativeUsd - aaveCostBasis : null,
            txHash: typeof row.tx_hash === 'string' ? row.tx_hash : null,
          });
        }
      }
    }

    needsAttentionRaw = needsAttentionLifecycle;

    // ── 2. Still holding = whatever remains in lotsByAsset ─────────────
    for (const [asset, lots] of lotsByAsset) {
      for (const lot of lots) {
        if (lot.amount <= 0) continue;
        stillHolding.push({
          asset,
          amount:      lot.amount,
          acquiredDate: lot.timestamp,
          costUsd:     lot.costUsd,
          daysHeld:    daysBetween(lot.timestamp, refDate),
        });
      }
    }
    // Sort by asset then date
    stillHolding.sort((a, b) =>
      a.asset.localeCompare(b.asset) || a.acquiredDate.localeCompare(b.acquiredDate),
    );

    // ── 3. Income — import_transactions in selected year ───────────────
    const incomeResult = await db.execute({
      sql: `SELECT asset_symbol, amount, native_usd, timestamp_utc, kind, description, notes,
                   ${priceSrcSel()}, ${priceAsofSel()}
            FROM import_transactions
            WHERE tenant_id = ?
              AND timestamp_utc >= ?
              AND timestamp_utc <= ?
            ORDER BY timestamp_utc DESC`,
      args: [tenantId, yearStart, yearEnd],
    });

    type RawImport = { asset_symbol: unknown; amount: unknown; native_usd: unknown; timestamp_utc: unknown; kind: unknown; description: unknown; notes: unknown; price_source: unknown; price_asof: unknown };
    const isCardRebate = (r: RawImport) =>
      /^card rebate/i.test(toStr(r.description).trimStart());

    const toIncomeItem = (r: RawImport): IncomeItem => ({
      asset:       toStr(r.asset_symbol).toUpperCase(),
      amount:      Math.abs(Number(r.amount ?? 0)),
      usdValue:    toNum(r.native_usd),
      date:        toStr(r.timestamp_utc),
      kind:        toStr(r.kind),
      description: typeof r.description === 'string' ? r.description
                 : typeof r.notes === 'string'       ? r.notes
                 : null,
      priceSource: typeof r.price_source === 'string' ? r.price_source : null,
      priceAsof:   typeof r.price_asof   === 'string' ? r.price_asof   : null,
    });

    const incomeKindRows = (incomeResult.rows as unknown as RawImport[])
      .filter((r) => INCOME_KINDS.has(toStr(r.kind)));

    income      = incomeKindRows.filter((r) => !isCardRebate(r)).map(toIncomeItem);
    cardRebates = incomeKindRows.filter(isCardRebate).map(toIncomeItem);
  } // end source branch

  // ── 3b. Income reclassifications (Junk-drawer "mark as income") ─────────────
  // Opt-in: only tokens the user explicitly reclassified as income are considered,
  // and only when a receipt event + FMV is derivable and dated in the selected year.
  // Undated / not-yet-derivable ones are left for the receipt-basis explorer slice
  // rather than smeared across years — so existing numbers never change unless the
  // user acts, and no fabricated values appear.
  try {
    const incomeOverrides = await getIncomeOverrides(tenantId);
    for (const ov of incomeOverrides) {
      const basis = await deriveReceiptBasis(tenantId, ov);
      if (!basis || !basis.acquiredAt) continue;
      if (basis.acquiredAt.slice(0, 4) !== String(year)) continue;
      income.push({
        asset:       (ov.symbol ?? '').toUpperCase() || 'AIRDROP',
        amount:      basis.amount,
        usdValue:    basis.fmvUsd,
        date:        basis.acquiredAt,
        kind:        'reclassified_airdrop',
        description: 'Reclassified from filtered tokens as income',
        priceSource: basis.source === 'import' ? 'import' : null,
        priceAsof:   null,
      });
    }
  } catch (e) {
    console.warn('[annualBreakdown] income reclassification failed', e);
  }

  // ── 4. NFT holdings — parse wallet_nft_snapshot, filter spam ────────────
  const nftHoldings: NftHolding[] = [];
  const nftCosts = await getNftCosts(tenantId).catch(() => new Map<string, number>());
  try {
    const nftSnaps = await db.execute({
      sql: `SELECT wallet_id, payload_json FROM wallet_nft_snapshot WHERE tenant_id = ?`,
      args: [tenantId],
    });
    // Contracts the user has explicitly hidden/blacklisted
    const hiddenResult = await db.execute({
      sql: `SELECT contract_address FROM nft_hidden WHERE tenant_id = ?`,
      args: [tenantId],
    });
    const hiddenContracts = new Set(
      (hiddenResult.rows as unknown as { contract_address: string }[]).map((r) =>
        r.contract_address.toLowerCase(),
      ),
    );

    // Heuristic spam filter — consolidated in tokenClassification.ts (single source).
    for (const snap of nftSnaps.rows as unknown as { wallet_id: string; payload_json: string }[]) {
      let payload: { items?: unknown[] } = {};
      try { payload = JSON.parse(snap.payload_json); } catch { continue; }
      for (const item of payload.items ?? []) {
        const i = item as Record<string, unknown>;
        const contract = toStr(i.contract).toLowerCase();
        if (hiddenContracts.has(contract)) continue;
        const name   = typeof i.name   === 'string' ? i.name   : null;
        const symbol = typeof i.symbol === 'string' ? i.symbol : null;
        if (classifyTokenName({ symbol, name }).class !== 'clean') continue;
        nftHoldings.push({
          name:     name ?? 'Unknown NFT',
          symbol,
          chain:    toStr(i.chain),
          contract: toStr(i.contract),
          tokenId:  toStr(i.tokenId),
          url:      typeof i.url === 'string' ? i.url : null,
          walletId: snap.wallet_id,
          costUsd:  lookupNftCost(nftCosts, { chain: toStr(i.chain), contract: toStr(i.contract), tokenId: toStr(i.tokenId) }),
        });
      }
    }
  } catch (e) {
    console.warn('[annualBreakdown] NFT fetch failed', e);
  }

  // ── 5. Available years ────────────────────────────────────────────────────
  const [yearsResult, suiYearsResult] = await Promise.all([
    db.execute({
      sql: `SELECT DISTINCT substr(e.timestamp_utc, 1, 4) AS yr
            FROM asset_lifecycle_events e
            WHERE e.tenant_id = ? AND e.direction = 'out'
            ORDER BY yr DESC`,
      args: [tenantId],
    }),
    db.execute({
      sql: `SELECT DISTINCT substr(timestamp, 1, 4) AS yr
            FROM sui_transactions
            WHERE tenant_id = ? AND CAST(amount AS REAL) < 0
            ORDER BY yr DESC`,
      args: [tenantId],
    }),
  ]);
  const availableYears = [
    ...(yearsResult.rows as unknown as { yr: unknown }[]),
    ...(suiYearsResult.rows as unknown as { yr: unknown }[]),
  ]
    .map((r) => Number(r.yr))
    .filter((y) => Number.isFinite(y) && y > 2000);
  // Deduplicate, always include current and previous year
  const curYear = new Date().getUTCFullYear();
  const yearSet = new Set(availableYears);
  yearSet.add(curYear);
  yearSet.add(curYear - 1);
  availableYears.length = 0;
  availableYears.push(...Array.from(yearSet).sort((a, b) => b - a));

  // ── Filter out items that already have a manual cost basis saved ──────────
  const resolvedRows = await db.execute({
    sql: `SELECT sell_source_id FROM manual_cost_basis WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const resolvedIds = new Set(resolvedRows.rows.map((r) => String(r.sell_source_id)));
  const filteredNeedsAttention = needsAttentionRaw.filter((i) => !resolvedIds.has(i.sourceId));

  // ── 5b. Transaction costs (fees) — exchange fees itemized + gas summarized ──
  // Orthogonal to the lifecycle/pipeline source: fees come straight from the raw
  // import + on-chain tables. Best-effort; a failure here must not break the page.
  let transactionCosts: TransactionCostItem[] = [];
  let gasByChain: GasCostByChain[] = [];
  let feeCoverage = { withFee: 0, total: 0 };
  try {
    const NATIVE_SYMBOL: Record<string, string> = {
      ethereum: 'ETH', base: 'ETH', arbitrum: 'ETH', optimism: 'ETH',
      polygon: 'POL', avalanche: 'AVAX', bsc: 'BNB',
    };
    const [feeRes, covRes, gasRes] = await Promise.all([
      // Itemized exchange/trading fees (already USD, or native when USD is absent).
      db.execute({
        sql: `SELECT timestamp_utc, source, asset_symbol, fee_usd, fee_native, fee_currency, description
              FROM import_transactions
              WHERE tenant_id = ?
                AND timestamp_utc >= ? AND timestamp_utc <= ?
                AND (COALESCE(fee_usd, 0) <> 0 OR COALESCE(fee_native, 0) <> 0)
              ORDER BY timestamp_utc DESC`,
        args: [tenantId, yearStart, yearEnd],
      }),
      // Coverage — how complete is our fee data for the year?
      db.execute({
        sql: `SELECT COUNT(*) AS total,
                     COUNT(*) FILTER (WHERE COALESCE(fee_usd,0) <> 0 OR COALESCE(fee_native,0) <> 0) AS with_fee
              FROM import_transactions
              WHERE tenant_id = ? AND timestamp_utc >= ? AND timestamp_utc <= ?`,
        args: [tenantId, yearStart, yearEnd],
      }),
      // On-chain gas per chain (wei strings → native units), summarized, not USD-priced.
      db.execute({
        sql: `SELECT chain, COUNT(*) AS txs, SUM(CAST(fee_paid AS NUMERIC)) AS total_wei
              FROM transactions
              WHERE tenant_id = ?
                AND substr(timestamp, 1, 4) = ?
                AND fee_paid ~ '^[0-9]+$' AND fee_paid <> '0'
              GROUP BY chain`,
        args: [tenantId, String(year)],
      }),
    ]);

    type RawFee = { timestamp_utc: unknown; source: unknown; asset_symbol: unknown; fee_usd: unknown; fee_native: unknown; fee_currency: unknown; description: unknown };
    transactionCosts = (feeRes.rows as unknown as RawFee[]).map((r) => ({
      date:        toStr(r.timestamp_utc),
      source:      toStr(r.source) || 'unknown',
      asset:       toStr(r.asset_symbol).toUpperCase(),
      feeUsd:      toNum(r.fee_usd),
      feeNative:   toNum(r.fee_native),
      feeCurrency: typeof r.fee_currency === 'string' ? r.fee_currency.toUpperCase() : null,
      description: typeof r.description === 'string' ? r.description : null,
    }));

    const cov = covRes.rows[0] as Record<string, unknown> | undefined;
    feeCoverage = {
      withFee: Number(cov?.with_fee ?? 0),
      total:   Number(cov?.total ?? 0),
    };

    type RawGas = { chain: unknown; txs: unknown; total_wei: unknown };
    gasByChain = (gasRes.rows as unknown as RawGas[])
      .map((r) => {
        const chain = toStr(r.chain).toLowerCase();
        return {
          chain,
          nativeSymbol: NATIVE_SYMBOL[chain] ?? chain.toUpperCase().slice(0, 4),
          totalNative:  Number(r.total_wei ?? 0) / 1e18,
          txCount:      Number(r.txs ?? 0),
        };
      })
      .filter((g) => g.totalNative > 0)
      .sort((a, b) => b.totalNative - a.totalNative);
  } catch (e) {
    console.warn('[annualBreakdown] transaction-cost fetch failed', e);
  }

  // ── 6. Totals ─────────────────────────────────────────────────────────────
  const sum = (arr: (number | null)[]): number =>
    arr.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  const totals: SectionTotals = {
    unsettledProceeds:   sum(filteredNeedsAttention.map((i) => i.proceedsUsd)),
    shortTermGain:       sum(shortTerm.map((i) => i.gainLossUsd)),
    longTermGain:        sum(longTerm.map((i) => i.gainLossUsd)),
    totalIncome:         sum(income.map((i) => i.usdValue)),
    heldCostBasis:       sum(stillHolding.map((i) => i.costUsd)),
    transactionCostsUsd: sum(transactionCosts.map((i) => i.feeUsd)),
  };

  return {
    year,
    availableYears,
    needsAttention: filteredNeedsAttention,
    stillHolding,
    shortTerm,
    longTerm,
    income,
    cardRebates,
    transactionCosts,
    gasByChain,
    feeCoverage,
    nftHoldings,
    aaveDeposits,
    aaveDepositTax,
    totals,
    dataSource: resolvedSource,
    method,
  };
}
