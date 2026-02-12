import { db } from '@/lib/db';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { getCoinIdBySymbol, getUsdUnitPriceAtTimestamp } from '@/lib/coinpaprikaHistorical';

const MAX_ROWS_PER_RUN = 1500;

const normalizeSymbol = (symbol: string, chain?: string | null) => {
  const upper = symbol.toUpperCase();
  if (upper === 'NATIVE') {
    if (chain === 'ethereum') return 'ETH';
    if (chain === 'polygon') return 'POL';
    if (chain === 'avalanche') return 'AVAX';
  }
  if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
  return upper;
};

const parseOnchainAmount = (value: string | null, decimals: number | null) => {
  if (!value) return null;

  const safeDecimals =
    typeof decimals === 'number' && Number.isFinite(decimals) && decimals >= 0 && decimals <= 36
      ? decimals
      : 18;

  const padded = value.padStart(safeDecimals + 1, '0');
  const whole = padded.slice(0, -safeDecimals) || '0';
  const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
  const n = Number(fraction ? `${whole}.${fraction}` : whole);
  return Number.isFinite(n) ? n : null;
};

const utcDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const isSpamSymbol = (symbol: string) => {
  if (!symbol) return true;
  if (symbol.length > 24) return true;
  if (symbol.includes(' ')) return true;
  return false;
};

export async function priceMissingTransactionsForTenant(
  tenantId: string,
  opts?: { limit?: number; interval?: '1d' | '1h' },
) {
  const limit = Math.max(1, Math.min(opts?.limit ?? MAX_ROWS_PER_RUN, MAX_ROWS_PER_RUN));
  const interval = opts?.interval ?? '1h';

  const res = await db.execute({
    sql: `SELECT id, chain, token_symbol, token_decimals, value, timestamp
          FROM transactions
          WHERE tenant_id = ?
            AND (
              usd_value IS NULL OR usd_value <= 0
              OR usd_unit_price IS NULL OR usd_unit_price <= 0
            )
          ORDER BY timestamp DESC
          LIMIT ?`,
    args: [tenantId, limit],
  });

  const rows = Array.isArray(res.rows) ? (res.rows as any[]) : [];
  const groups = new Map<string, any[]>();
  let skipped = 0;

  for (const row of rows) {
    const chain = String(row.chain ?? '');
    const rawSymbol = String(row.token_symbol ?? '').trim();
    if (!rawSymbol) {
      skipped++;
      continue;
    }

    const symbol = normalizeSymbol(rawSymbol, chain);
    if (!symbol || isSpamSymbol(symbol)) {
      skipped++;
      continue;
    }

    const day = utcDay(String(row.timestamp ?? ''));
    if (!day) {
      skipped++;
      continue;
    }

    const rawValue = row.value ? String(row.value) : '';
    if (!rawValue || rawValue === '0') {
      skipped++;
      continue;
    }

    const key = `${symbol}|${day}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  let priced = 0;
  let apiCalls = 0;
  let errors = 0;

  const coinIdBySymbol = new Map<string, string | null>();

  for (const key of groups.keys()) {
    const symbol = key.split('|')[0]!;
    if (coinIdBySymbol.has(symbol)) continue;

    try {
      coinIdBySymbol.set(symbol, await getCoinIdBySymbol(symbol));
    } catch (err) {
      console.warn('[pricing] coin id lookup failed', { symbol, err });
      coinIdBySymbol.set(symbol, null);
      errors++;
    }
  }

  for (const [key, list] of groups.entries()) {
    const [symbol, day] = key.split('|') as [string, string];
    const coinId = coinIdBySymbol.get(symbol);
    if (!coinId) {
      skipped += list.length;
      continue;
    }

    let pricedResult: Awaited<ReturnType<typeof getUsdUnitPriceAtTimestamp>> | null = null;

    try {
      pricedResult = await getUsdUnitPriceAtTimestamp({
        coinId,
        timestampUtcIso: `${day}T12:00:00Z`,
        interval,
      });
      apiCalls++;
    } catch (err) {
      console.warn('[pricing] price lookup failed', { symbol, day, err });
      skipped += list.length;
      errors++;
      continue;
    }

    if (!pricedResult || !Number.isFinite(pricedResult.unitPriceUsd) || pricedResult.unitPriceUsd <= 0) {
      skipped += list.length;
      continue;
    }

    const unitPriceUsd = pricedResult.unitPriceUsd; // number
    const pricedAtIso = pricedResult.pricedAtIso;   // string

    for (const row of list) {
      const amount = parseOnchainAmount(
        row.value ? String(row.value) : null,
        row.token_decimals == null ? null : Number(row.token_decimals),
      );

      if (amount == null || !Number.isFinite(amount) || amount <= 0) {
        skipped++;
        continue;
      }

      const usdValue = amount * unitPriceUsd;
      if (!Number.isFinite(usdValue) || usdValue <= 0) {
        skipped++;
        continue;
      }

      try {
        await db.execute({
          sql: `UPDATE transactions
                SET usd_unit_price = ?,
                    usd_value = ?,
                    usd_priced_at = ?,
                    usd_price_source = 'coinpaprika:ohlc',
                    usd_price_confidence = 'historical'
                WHERE id = ? AND tenant_id = ?
                  AND (
                    usd_value IS NULL OR usd_value <= 0
                    OR usd_unit_price IS NULL OR usd_unit_price <= 0
                  )`,
          args: [unitPriceUsd, usdValue, pricedAtIso, String(row.id), tenantId],
        });
        priced++;
      } catch (err) {
        console.warn('[pricing] update failed', { id: String(row.id), err });
        errors++;
      }
    }
  }

  if (priced > 0) {
    try {
      await rebuildAssetLifecycles(tenantId);
    } catch (err) {
      console.warn('[pricing] lifecycle rebuild failed', err);
      errors++;
    }
  }

  return { scanned: rows.length, priced, skipped, apiCalls, errors, interval };
}
