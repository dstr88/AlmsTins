/**
 * annualBreakdown.ts
 * Builds the five tax-year sections from lifecycle events + import transactions.
 *
 * Sections:
 *   1. needsAttention  – sells with no traceable buy (orphaned / problem children)
 *   2. stillHolding    – FIFO lots still open at year-end
 *   3. shortTerm       – settled lots held < 365 days  (sold in selected year)
 *   4. longTerm        – settled lots held ≥ 365 days  (sold in selected year)
 *   5. income          – interest, staking, rewards, cashback in selected year
 */

import { db } from './db';

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
};

export type HeldPosition = {
  asset: string;
  amount: number;
  acquiredDate: string;
  costUsd: number | null;
  /** days held as of Dec 31 of selected year (or today if current year) */
  daysHeld: number;
};

export type SettledLot = {
  asset: string;
  amount: number;
  buyDate: string;
  sellDate: string;
  costUsd: number | null;
  proceedsUsd: number | null;
  gainLossUsd: number | null;
  daysHeld: number;
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

export type AnnualBreakdown = {
  year: number;
  availableYears: number[];
  needsAttention: UnsettledItem[];
  stillHolding: HeldPosition[];
  shortTerm: SettledLot[];
  longTerm: SettledLot[];
  income: IncomeItem[];
  nftHoldings: NftHolding[];
  totals: SectionTotals;
};

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

export async function buildAnnualBreakdown(
  tenantId: string,
  year: number,
): Promise<AnnualBreakdown> {
  const yearStart = `${year}-01-01T00:00:00.000Z`;
  const yearEnd   = `${year}-12-31T23:59:59.999Z`;
  // For "still holding" age calculation: end of year (or now if current year)
  const now = new Date();
  const refDate =
    year >= now.getFullYear()
      ? now.toISOString()
      : yearEnd;

  // ── 1. Fetch all lifecycle events up to year end ──────────────────────────
  const eventsResult = await db.execute({
    sql: `SELECT g.asset_symbol    AS asset_symbol,
               e.direction         AS direction,
               e.amount            AS amount,
               e.native_usd        AS native_usd,
               e.timestamp_utc     AS timestamp_utc,
               e.transaction_class AS transaction_class
          FROM asset_lifecycle_events e
          LEFT JOIN asset_lifecycle_groups g
            ON g.id = e.group_id AND g.tenant_id = e.tenant_id
          WHERE e.tenant_id = ?
            AND e.timestamp_utc <= ?
          ORDER BY e.timestamp_utc ASC`,
    args: [tenantId, yearEnd],
  });

  // Classes that are NOT taxable capital events — skip entirely from FIFO
  const SKIP_CLASSES = new Set([
    'liability_increase',    // debt tokens minted when borrowing (e.g. variableDebtPolUSDT)
    'liability_repayment',   // debt tokens burned when repaying
    'collateral_deposit',    // collateral posted — not a disposal
    'collateral_withdrawal', // collateral returned — not an acquisition
    'interest_income',       // handled separately in the income section
  ]);

  type RawEvent = { asset_symbol: unknown; direction: unknown; amount: unknown; native_usd: unknown; timestamp_utc: unknown; transaction_class: unknown };
  const events = (eventsResult.rows as unknown as RawEvent[])
    .filter((r) => r && !SKIP_CLASSES.has(toStr(r.transaction_class)));

  // FIFO state
  type Lot = { amount: number; timestamp: string; costUsd: number | null };
  const lotsByAsset = new Map<string, Lot[]>();

  const needsAttention: UnsettledItem[] = [];
  const shortTerm: SettledLot[]         = [];
  const longTerm: SettledLot[]          = [];

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

      let remaining = amount;
      const list    = lotsByAsset.get(asset) ?? [];

      while (remaining > 0) {
        const lot = list[0];
        if (!lot) {
          // orphaned — no matching buy found
          if (sellInYear) {
            needsAttention.push({
              asset,
              amount: remaining,
              sellDate: timestamp,
              proceedsUsd: nativeUsd
                ? (remaining / amount) * nativeUsd
                : null,
            });
          }
          break;
        }

        const take        = Math.min(remaining, lot.amount);
        const costPortion =
          lot.costUsd != null ? (take / lot.amount) * lot.costUsd : null;
        const sellPortion =
          nativeUsd != null ? (take / amount) * nativeUsd : null;
        const gainLoss =
          costPortion != null && sellPortion != null
            ? sellPortion - costPortion
            : null;
        const days = daysBetween(lot.timestamp, timestamp);

        if (sellInYear) {
          const settled: SettledLot = {
            asset,
            amount: take,
            buyDate:    lot.timestamp,
            sellDate:   timestamp,
            costUsd:    costPortion,
            proceedsUsd: sellPortion,
            gainLossUsd: gainLoss,
            daysHeld:   days,
          };
          if (days < 365) shortTerm.push(settled);
          else            longTerm.push(settled);
        }

        lot.amount -= take;
        if (lot.amount <= 0) list.shift();
        remaining -= take;
      }

      lotsByAsset.set(asset, list);
    }
  }

  // ── 2. Still holding = whatever remains in lotsByAsset ───────────────────
  const stillHolding: HeldPosition[] = [];
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

  // ── 3. Income — import_transactions in selected year ─────────────────────
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
  const income: IncomeItem[] = (incomeResult.rows as unknown as RawImport[])
    .filter((r) => INCOME_KINDS.has(toStr(r.kind)))
    .map((r) => ({
      asset:       toStr(r.asset_symbol).toUpperCase(),
      amount:      Math.abs(Number(r.amount ?? 0)),
      usdValue:    toNum(r.native_usd),
      date:        toStr(r.timestamp_utc),
      kind:        toStr(r.kind),
      description: typeof r.description === 'string' ? r.description
                 : typeof r.notes === 'string'       ? r.notes
                 : null,
    }));

  // ── 4. NFT holdings — parse wallet_nft_snapshot, filter spam ────────────
  const nftHoldings: NftHolding[] = [];
  try {
    const nftSnaps = await db.execute({
      sql: `SELECT wallet_id, payload_json FROM wallet_nft_snapshot WHERE tenant_id = ?`,
      args: [tenantId],
    });
    // Contracts the user has explicitly hidden/blacklisted
    const hiddenResult = await db.execute({
      sql: `SELECT contract FROM nft_hidden WHERE tenant_id = ?`,
      args: [tenantId],
    });
    const hiddenContracts = new Set(
      (hiddenResult.rows as unknown as { contract: string }[]).map((r) =>
        r.contract.toLowerCase(),
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
  const yearsResult = await db.execute({
    sql: `SELECT DISTINCT strftime('%Y', e.timestamp_utc) AS yr
          FROM asset_lifecycle_events e
          WHERE e.tenant_id = ? AND e.direction = 'out'
          ORDER BY yr DESC`,
    args: [tenantId],
  });
  const availableYears = (yearsResult.rows as unknown as { yr: unknown }[])
    .map((r) => Number(r.yr))
    .filter((y) => Number.isFinite(y) && y > 2000);
  // Always include current and previous year
  const curYear = new Date().getFullYear();
  for (const y of [curYear, curYear - 1]) {
    if (!availableYears.includes(y)) availableYears.push(y);
  }
  availableYears.sort((a, b) => b - a);

  // ── 5. Totals ─────────────────────────────────────────────────────────────
  const sum = (arr: (number | null)[]): number =>
    arr.reduce<number>((acc, v) => acc + (v ?? 0), 0);

  const totals: SectionTotals = {
    unsettledProceeds: sum(needsAttention.map((i) => i.proceedsUsd)),
    shortTermGain:     sum(shortTerm.map((i) => i.gainLossUsd)),
    longTermGain:      sum(longTerm.map((i) => i.gainLossUsd)),
    totalIncome:       sum(income.map((i) => i.usdValue)),
    heldCostBasis:     sum(stillHolding.map((i) => i.costUsd)),
  };

  return {
    year,
    availableYears,
    needsAttention,
    stillHolding,
    shortTerm,
    longTerm,
    income,
    nftHoldings,
    totals,
  };
}
