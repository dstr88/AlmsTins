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
  sourceId: string;
  groupId: string;
  txHash: string | null;
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
               e.transaction_class AS transaction_class,
               e.source_id         AS source_id,
               e.group_id          AS group_id,
               e.tx_hash           AS tx_hash
          FROM asset_lifecycle_events e
          LEFT JOIN asset_lifecycle_groups g
            ON g.id = e.group_id AND g.tenant_id = e.tenant_id
          WHERE e.tenant_id = ?
            AND e.timestamp_utc <= ?
          ORDER BY e.timestamp_utc ASC`,
    args: [tenantId, yearEnd],
  });

  // Classes to exclude ENTIRELY from FIFO — debt tokens and income events only.
  // These have no real-asset cost-basis impact (debt tokens are liabilities, not assets).
  const SKIP_CLASSES = new Set([
    'liability_increase',    // debt tokens minted when borrowing (e.g. variableDebtPolUSDT)
    'liability_repayment',   // debt tokens burned when repaying
    'interest_income',       // handled separately in the income section
  ]);

  // Classes to run through FIFO for correct lot tracking, but NOT record as a taxable
  // capital-gain/loss event.  The cost basis carries through (e.g. USDC → aUSDC → USDC).
  const FIFO_NONTAXABLE = new Set([
    'collateral_deposit',    // USDC out to Aave → aUSDC in: cost moves, no taxable event
    'collateral_withdrawal', // aUSDC out from Aave → USDC in: cost moves, no taxable event
  ]);

  // ── 1a. Sui wallet transactions ───────────────────────────────────────────
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
    }];
  });

  // ── 1b. Custom wallet manual transactions ────────────────────────────────
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
      }];
    } catch { return []; }
  });

  type RawEvent = { asset_symbol: unknown; direction: unknown; amount: unknown; native_usd: unknown; timestamp_utc: unknown; transaction_class: unknown; source_id: unknown; group_id: unknown; tx_hash: unknown };
  const events = [
    ...(eventsResult.rows as unknown as RawEvent[])
      .filter((r) => r && !SKIP_CLASSES.has(toStr(r.transaction_class))),
    ...customEvents,
    ...suiEvents,
  ].sort((a, b) => toStr(a.timestamp_utc).localeCompare(toStr(b.timestamp_utc)));

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
      // Aave pass-through transfers (collateral_deposit / collateral_withdrawal) move
      // the cost basis but are NOT taxable disposals — consume lots but skip gain/loss.
      const txClass = toStr(row.transaction_class);
      const isTaxable = !FIFO_NONTAXABLE.has(txClass);

      let remaining = amount;
      const list    = lotsByAsset.get(asset) ?? [];

      while (remaining > 0) {
        const lot = list[0];
        if (!lot) {
          // orphaned — no matching buy found (only flag if it's a real taxable sell)
          if (sellInYear && isTaxable) {
            needsAttention.push({
              asset,
              amount: remaining,
              sellDate: timestamp,
              proceedsUsd: nativeUsd
                ? (remaining / amount) * nativeUsd
                : null,
              sourceId: typeof row.source_id === 'string' ? row.source_id : '',
              groupId: typeof row.group_id === 'string' ? row.group_id : '',
              txHash: typeof row.tx_hash === 'string' ? row.tx_hash : null,
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
  const [yearsResult, suiYearsResult] = await Promise.all([
    db.execute({
      sql: `SELECT DISTINCT strftime('%Y', e.timestamp_utc) AS yr
            FROM asset_lifecycle_events e
            WHERE e.tenant_id = ? AND e.direction = 'out'
            ORDER BY yr DESC`,
      args: [tenantId],
    }),
    db.execute({
      sql: `SELECT DISTINCT strftime('%Y', timestamp) AS yr
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
  const curYear = new Date().getFullYear();
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
  const filteredNeedsAttention = needsAttention.filter((i) => !resolvedIds.has(i.sourceId));

  // ── 5. Totals ─────────────────────────────────────────────────────────────
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
    nftHoldings,
    totals,
  };
}
