/**
 * annualBreakdown.ts
 * Builds the five tax-year sections from the lot ledger (tax/computeLedger.ts), which runs once
 * over a tenant's whole history and is sliced by year here.
 *
 * Sections:
 *   1. needsAttention  – sells with no traceable buy (orphaned / problem children)
 *   2. stillHolding    – lots still open at year-end
 *   3. shortTerm       – settled lots held one year or less (sold in selected year)
 *   4. longTerm        – settled lots held more than one year (sold in selected year);
 *                        calendar-date rule (yearEnd/holdingPeriod.ts)
 *   5. income          – interest, staking, rewards, cashback in selected year
 *
 * A transfer between a tenant's own wallets or accounts is a move, not a sale: the coins keep
 * their original date and cost, and no gain is booked. Transfers the ledger could not be sure of
 * (paired by amount and time only, between different owners, a fee that cost coins, a send nothing
 * was found for) are listed in `transferReviews`.
 *
 * Data source options (which rows are read into the ledger):
 *   'lifecycle' (default) – asset_lifecycle_events joined to the import and on-chain rows they came from
 *   'pipeline'            – the tax pipeline's classification of the same rows, read live (the owner's
 *                           manual classifications included)
 *   'auto'                – 'pipeline' for a tenant that has a successful pipeline run, else
 *                           'lifecycle'; every page that passes 'auto' therefore agrees
 */

import { db } from './db';
import { getAaveDepositTax, type AaveDepositTax } from './jurisdictionProfile';
import type { CostBasisMethod } from './yearEnd/lotSelection';
import { daysUntilLongTerm, isLongTermHold } from './yearEnd/holdingPeriod';
import { walletDisplayOf } from './tax/eventWallet';
import { computeLedger, engineForTenant, type ComputedLedger } from './tax/computeLedger';
import { EPSILON, TRANSIT_WALLET, UNALLOCATED_WALLET, UNRESOLVED_WALLET, type FindingReason, type LedgerSlice } from './tax/lotLedger';
import { parseInstant } from './tax/normalize';

// ─── kinds that are taxable ordinary income (not capital events) ──────────────
const INCOME_KINDS = new Set([
  'crypto_earn_interest_paid',
  'Staking Income',
  'referral_card_cashback',
  'referral_bonus',
  'referral_gift',
  'reward.loyalty_program.trading_rebate.crypto_wallet',
  'reward.external_cashback.crypto_card.payment',
  'admin_wallet_credited',
  'pay_checkout_reward',
  'dynamic_coin_swap_bonus_earn_deposit',
  'lockup_swap_rebate',
  'reimbursement',
]);

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
  /** The wallet key the lot arrived in (walletKey.ts format); null when the source has none. */
  walletKey?: string | null;
  /** What to show for that wallet: its address, or "source · account" for an exchange. */
  walletDisplay?: string | null;
  /** Held more than one year as of that same date (calendar rule, yearEnd/holdingPeriod.ts). */
  longTerm: boolean;
  /** Days from that date until it counts as long-term; 0 once it does, null if the date is unreadable. */
  daysToLongTerm: number | null;
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
  /** The wallet the coins were sold from (walletKey.ts format); null when the source has none. */
  walletKey?: string | null;
  /** What to show for that wallet: its address, or "source · account" for an exchange. */
  walletDisplay?: string | null;
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
};

export type NftHolding = {
  name: string;
  symbol: string | null;
  chain: string;
  contract: string;
  tokenId: string;
  url: string | null;
  walletId: string;
};

export type SectionTotals = {
  unsettledProceeds: number;
  shortTermGain: number;
  longTermGain: number;
  totalIncome: number;
  heldCostBasis: number;
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
 * A transfer (or the coins it cost) the ledger could not be sure of, for the owner to look at.
 * Nothing here is a sale: the coins moved, and these are the places that might be wrong.
 */
export type TransferReview = {
  reason: FindingReason;
  asset: string;
  /** When the coins left. */
  date: string | null;
  amount: number | null;
  /** Cost of the coins concerned, when known. */
  costUsd: number | null;
  valueUsd: number | null;
  /** When those coins were first acquired, when known. */
  acquiredDate: string | null;
  fromWalletKey: string | null;
  fromWalletDisplay: string | null;
  toWalletKey: string | null;
  toWalletDisplay: string | null;
  /** A code that refines the reason (never user text). */
  detail: string | null;
  /** The ids of the import or on-chain rows involved. */
  sourceIds: string[];
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
  nftHoldings: NftHolding[];
  /** Aave supplies surfaced as POTENTIAL taxable disposals (contested — see aaveDepositTax). */
  aaveDeposits?: AaveDepositItem[];
  /** The tenant's district choice governing how the above are treated. */
  aaveDepositTax?: AaveDepositTax;
  totals: SectionTotals;
  /** Which data source was actually used to compute capital gains/income. */
  dataSource: 'lifecycle' | 'pipeline';
  /** Transfers the ledger could not be sure of, for the selected year. */
  transferReviews?: TransferReview[];
  /** The ledger rules that produced these figures (tax/lotLedger.ts ENGINE_VERSION). */
  engineVersion?: string;
};

/** Controls which data source buildAnnualBreakdown reads from. */
export type AnnualBreakdownSource = 'lifecycle' | 'pipeline' | 'auto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const toStr = (v: unknown): string =>
  typeof v === 'string' ? v : String(v ?? '');

function daysBetween(a: string, b: string): number {
  const from = parseInstant(a);
  const to = parseInstant(b);
  if (from === null || to === null) return 0;
  return Math.floor((to - from) / 86_400_000);
}

/** The UTC year of a stored timestamp, or null when it cannot be read. */
function yearOf(ts: string): number | null {
  const ms = parseInstant(ts);
  return ms === null ? null : new Date(ms).getUTCFullYear();
}

/** A wallet key to show: the ledger's stand-ins for "no wallet" (and for coins between two wallets) are none. */
const walletOrNull = (wallet: string | null | undefined): string | null =>
  !wallet || wallet === UNRESOLVED_WALLET || wallet === UNALLOCATED_WALLET || wallet === TRANSIT_WALLET ? null : wallet;

/** Which findings the owner is asked to look at. An estimated basis is a label on a lot, not a transfer to check. */
const REVIEWED_FINDINGS: ReadonlySet<FindingReason> = new Set<FindingReason>([
  'transfer_fee_units',
  'transfer_amount_mismatch',
  'transfer_source_shortfall',
  'transfer_link_unconfirmed',
  'transfer_between_owners',
  'unmatched_transfer',
  'manual_basis_on_transfer',
  'unreadable_event_date',
  'invalid_event',
]);

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

  // ── Resolve 'auto' → concrete source ────────────────────────────────────
  // One source per tenant, so every page that asks for 'auto' reads the same figures.
  const resolvedSource: 'lifecycle' | 'pipeline' =
    source === 'auto' ? await engineForTenant(tenantId) : source;

  const aaveDepositTax = await getAaveDepositTax(tenantId);

  // ── Core sections: sliced out of one run of the lot ledger ───────────────
  const ledger: ComputedLedger = await computeLedger(tenantId, resolvedSource, method, lotPins);
  const { result, refs } = ledger;

  const shortTerm: SettledLot[] = [];
  const longTerm: SettledLot[] = [];
  const needsAttentionRaw: UnsettledItem[] = [];
  const stillHolding: HeldPosition[] = [];
  const aaveDeposits: AaveDepositItem[] = [];

  const settledOf = (sl: LedgerSlice): SettledLot => {
    // The wallet the coins were sold from. (A lot keeps the wallet it was bought in until per-wallet pools, so it is not where they were.)
    const walletKey = walletOrNull(sl.wallet);
    return {
      asset: sl.asset,
      amount: sl.qty,
      buyDate: sl.acquiredAt,
      sellDate: sl.disposedAt,
      walletKey,
      walletDisplay: walletDisplayOf(walletKey),
      costUsd: sl.cost,
      proceedsUsd: sl.proceeds,
      gainLossUsd: sl.gain,
      daysHeld: daysBetween(sl.acquiredAt, sl.disposedAt),
      basisSource: sl.basisSource,
      originNote: sl.originNote,
    };
  };

  // Sales in the year: the ledger already knows each one's term (calendar-date rule).
  for (const sl of result.slices) {
    if (!sl.taxable || yearOf(sl.disposedAt) !== year) continue;
    (sl.term === 'long' ? longTerm : shortTerm).push(settledOf(sl));
  }
  for (const u of result.unmatched) {
    if (!u.taxable || yearOf(u.at) !== year) continue;
    const info = refs.get(u.sourceRef);
    needsAttentionRaw.push({
      asset: u.asset,
      amount: u.qty,
      sellDate: u.at,
      proceedsUsd: u.proceeds,
      sourceId: info?.sourceId ?? '',
      groupId: info?.groupId ?? '',
      txHash: info?.txHash ?? null,
      transactionClass: info?.transactionClass ?? '',
      sourceType: info?.sourceType ?? '',
    });
  }

  // Aave deposit (collateral_deposit): the supplied lots' cost basis, so the would-be gain/loss
  // can be surfaced for review. Additive: it does not change realized gains, lots, or the
  // (still non-taxable) treatment.
  const deposits = new Map<string, { slices: LedgerSlice[]; unmatched: boolean; asset: string; date: string }>();
  for (const sl of result.slices) {
    if (sl.taxable || sl.category !== 'collateral_deposit' || yearOf(sl.disposedAt) !== year) continue;
    const d = deposits.get(sl.sourceRef) ?? { slices: [], unmatched: false, asset: sl.asset, date: sl.disposedAt };
    d.slices.push(sl);
    deposits.set(sl.sourceRef, d);
  }
  for (const u of result.unmatched) {
    if (u.taxable || u.category !== 'collateral_deposit' || yearOf(u.at) !== year) continue;
    const d = deposits.get(u.sourceRef) ?? { slices: [], unmatched: false, asset: u.asset, date: u.at };
    d.unmatched = true;
    deposits.set(u.sourceRef, d);
  }
  for (const [ref, d] of deposits) {
    const info = refs.get(ref);
    const complete = !d.unmatched && d.slices.every((sl) => sl.cost != null);
    const cost = d.slices.reduce((acc, sl) => acc + (sl.cost ?? 0), 0);
    const amountUsd = info?.valueUsd ?? null;
    aaveDeposits.push({
      asset: d.asset,
      amount: info?.amount ?? d.slices.reduce((acc, sl) => acc + sl.qty, 0),
      date: d.date,
      amountUsd,
      costBasisUsd: complete ? cost : null,
      gainLossUsd: amountUsd != null && complete ? amountUsd - cost : null,
      txHash: info?.txHash ?? null,
    });
  }

  // ── 2. Still holding = the open lots at the end of the year ───────────
  // A year before the history starts holds nothing; a year after it ends holds what the last year-end did.
  const snapshots = result.snapshots;
  const snapshot =
    snapshots.find((sn) => sn.at === yearEnd) ??
    (snapshots.length && year > (yearOf(snapshots[snapshots.length - 1].at) ?? year) ? snapshots[snapshots.length - 1] : undefined);
  for (const lot of snapshot?.lots ?? []) {
    if (lot.qty <= EPSILON || lot.wallet === UNALLOCATED_WALLET) continue;
    const walletKey = walletOrNull(lot.wallet);
    stillHolding.push({
      asset:       lot.asset,
      amount:      lot.qty,
      walletKey,
      walletDisplay: walletDisplayOf(walletKey),
      acquiredDate: lot.acquiredAt,
      costUsd:     lot.costUsd,
      daysHeld:    daysBetween(lot.acquiredAt, refDate),
      longTerm:    isLongTermHold(lot.acquiredAt, refDate),
      daysToLongTerm: daysUntilLongTerm(lot.acquiredAt, refDate),
    });
  }
  // Sort by asset then date
  stillHolding.sort((a, b) =>
    a.asset.localeCompare(b.asset) || a.acquiredDate.localeCompare(b.acquiredDate),
  );

  // ── Transfers to check ─────────────────────────────────────────────────
  const transferReviews: TransferReview[] = result.findings
    // A row the ledger could not date has no year to belong to, so it shows in every year: it must not go unseen.
    .filter((f) => REVIEWED_FINDINGS.has(f.reason) && (f.at === null || yearOf(f.at) === null || yearOf(f.at) === year))
    .map((f) => ({
      reason: f.reason,
      asset: f.asset,
      date: f.at,
      amount: f.qty,
      costUsd: f.costUsd,
      valueUsd: f.valueUsd,
      acquiredDate: f.acquiredAt,
      fromWalletKey: walletOrNull(f.wallet),
      fromWalletDisplay: walletDisplayOf(walletOrNull(f.wallet)),
      toWalletKey: walletOrNull(f.toWallet),
      toWalletDisplay: walletDisplayOf(walletOrNull(f.toWallet)),
      detail: f.detail,
      sourceIds: f.refs.map((r) => refs.get(r)?.sourceId || r),
    }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.reason.localeCompare(b.reason));

  // ── 3. Income ──────────────────────────────────────────────────────────
  let income: IncomeItem[]      = [];
  let cardRebates: IncomeItem[] = [];

  if (resolvedSource === 'pipeline') {
    // Income from pipeline classifications, joined to source tx for dates/amounts
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
                   it.notes                          AS tx_notes
              FROM tax_classifications tc
              LEFT JOIN import_transactions it
                ON it.id = tc.source_id AND tc.source_type = 'import'
               AND it.tenant_id = tc.tenant_id
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
      };
      return { item, isCardRebate: toStr(r.category) === 'card-rebate' };
    });
    income      = allIncomeRows.filter((r) => !r.isCardRebate).map((r) => r.item);
    cardRebates = allIncomeRows.filter((r) =>  r.isCardRebate).map((r) => r.item);
  } else {
    // Income — import_transactions in selected year
    const incomeResult = await db.execute({
      sql: `SELECT asset_symbol, amount, native_usd, timestamp_utc, kind, description, notes
            FROM import_transactions
            WHERE tenant_id = ?
              AND timestamp_utc >= ?
              AND timestamp_utc <= ?
            ORDER BY timestamp_utc DESC`,
      args: [tenantId, yearStart, yearEnd],
    });

    type RawImport = { asset_symbol: unknown; amount: unknown; native_usd: unknown; timestamp_utc: unknown; kind: unknown; description: unknown; notes: unknown };
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
    });

    const incomeKindRows = (incomeResult.rows as unknown as RawImport[])
      .filter((r) => INCOME_KINDS.has(toStr(r.kind)));

    income      = incomeKindRows.filter((r) => !isCardRebate(r)).map(toIncomeItem);
    cardRebates = incomeKindRows.filter(isCardRebate).map(toIncomeItem);
  }

  // ── 4. NFT holdings — parse wallet_nft_snapshot, filter spam ────────────
  const nftHoldings: NftHolding[] = [];
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

    // Heuristic spam filter — names/symbols with URLs, Telegram links, emoji scams
    const SPAM_PATTERNS = [
      /https?:\/\//i,
      /t\.me\//i,
      /telegram/i,
      /claim/i,
      /voucher/i,
      /reward/i,
      /prize/i,
      /visit/i,
      /\.lat\b/i,
      /\.org\b.*earn/i,
      /fli\.so/i,
    ];
    const isSpam = (name: string | null, symbol: string | null) => {
      const text = `${name ?? ''} ${symbol ?? ''}`;
      return SPAM_PATTERNS.some((p) => p.test(text));
    };

    for (const snap of nftSnaps.rows as unknown as { wallet_id: string; payload_json: string }[]) {
      let payload: { items?: unknown[] } = {};
      try { payload = JSON.parse(snap.payload_json); } catch { continue; }
      for (const item of payload.items ?? []) {
        const i = item as Record<string, unknown>;
        const contract = toStr(i.contract).toLowerCase();
        if (hiddenContracts.has(contract)) continue;
        const name   = typeof i.name   === 'string' ? i.name   : null;
        const symbol = typeof i.symbol === 'string' ? i.symbol : null;
        if (isSpam(name, symbol)) continue;
        nftHoldings.push({
          name:     name ?? 'Unknown NFT',
          symbol,
          chain:    toStr(i.chain),
          contract: toStr(i.contract),
          tokenId:  toStr(i.tokenId),
          url:      typeof i.url === 'string' ? i.url : null,
          walletId: snap.wallet_id,
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

  // ── 6. Totals ─────────────────────────────────────────────────────────────
  const sum = (arr: (number | null)[]): number =>
    arr.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  const totals: SectionTotals = {
    unsettledProceeds: sum(filteredNeedsAttention.map((i) => i.proceedsUsd)),
    shortTermGain:     sum(shortTerm.map((i) => i.gainLossUsd)),
    longTermGain:      sum(longTerm.map((i) => i.gainLossUsd)),
    totalIncome:       sum(income.map((i) => i.usdValue)),
    heldCostBasis:     sum(stillHolding.map((i) => i.costUsd)),
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
    nftHoldings,
    aaveDeposits,
    aaveDepositTax,
    totals,
    dataSource: resolvedSource,
    transferReviews,
    engineVersion: result.engineVersion,
  };
}
