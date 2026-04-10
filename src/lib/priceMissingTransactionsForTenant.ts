import { db } from '@/lib/db';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import {
  getCoingeckoIdBySymbol,
  getUsdUnitPriceAtTimestampCoinGecko,
} from '@/lib/coingeckoHistorical';
import {
  countProviderCall,
  createPricingRunSummary,
  finalizePricingRunSummary,
  formatPricingRunOneLiner,
  markAttempted,
  markPriced,
  markRejected,
  markSkipped,
  trackUniqueAssetRequest,
} from '@/lib/prices/pricingRunSummary';

const MAX_ROWS_PER_RUN = 1500;
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'TUSD', 'FDUSD', 'USDP', 'GUSD', 'USDE']);

const normalizeConfusables = (s: string) =>
  s.replace(/[ЅТЕОАРНКМВСХІЈ]/g, (ch) => {
    switch (ch) {
      case 'Ѕ':
        return 'S';
      case 'Т':
        return 'T';
      case 'Е':
        return 'E';
      case 'О':
        return 'O';
      case 'А':
        return 'A';
      case 'Р':
        return 'P';
      case 'Н':
        return 'H';
      case 'К':
        return 'K';
      case 'М':
        return 'M';
      case 'В':
        return 'B';
      case 'С':
        return 'C';
      case 'Х':
        return 'X';
      case 'І':
        return 'I';
      case 'Ј':
        return 'J';
      default:
        return ch;
    }
  });

const stripUnicodeSpoof = (s: string) =>
  normalizeConfusables(s.normalize('NFKC')).replace(/[^\x20-\x7E]/g, '');

const normalizeSymbol = (symbolRaw: string, chain?: string | null) => {
  let s = stripUnicodeSpoof(symbolRaw || '').trim().toUpperCase();
  if (!s) return null;

  // Kill obvious garbage early
  if (s.length > 64) return null;
  if (s.includes(' ')) return null;

  // Chain-native mapping
  if (s === 'NATIVE') {
    if (chain === 'ethereum') return 'ETH';
    if (chain === 'polygon') return 'POL';
    if (chain === 'avalanche') return 'AVAX';
    return null;
  }

  // Skip obvious non-priceables
  if (s === 'UNI-V2') return null;
  if (s.startsWith('VARIABLEDEBT') || s.startsWith('STABLEDEBT')) return null;

  // Bridge / suffix normalization
  if (s.endsWith('.E')) s = s.slice(0, -2); // USDC.e -> USDC

  if (s === 'USDT0') s = 'USDT';
  if (s === 'USDC0') s = 'USDC';

  // Polygon wrappers
  if (s === 'WMATIC' || s === 'MATIC') s = 'POL';
  if (s === 'WPOL') s = 'POL';

  // Aave aTokens on Polygon (aPolWETH, aPolWBTC, etc.)
  if (s.startsWith('APOL')) {
    const underlying = s.slice(4);
    if (!underlying) return null;

    if (underlying === 'WMATIC' || underlying === 'MATIC') return 'POL';
    if (underlying === 'WPOL') return 'POL';

    if (underlying === 'WETH') return 'WETH';
    if (underlying === 'WBTC') return 'WBTC';
    if (underlying === 'USDC') return 'USDC';
    if (underlying === 'USDT') return 'USDT';
    if (underlying === 'DAI') return 'DAI';
    if (underlying === 'LINK') return 'LINK';
    if (underlying === 'AAVE') return 'AAVE';

    return underlying;
  }

  // Aave aTokens elsewhere (aETH, aWETH, aWBTC, etc.)
  if (s.startsWith('A') && s.length >= 3) {
    const underlying = s.slice(1);

    const allowed = new Set([
      'ETH',
      'WETH',
      'WBTC',
      'BTC',
      'USDC',
      'USDT',
      'DAI',
      'LINK',
      'AAVE',
      'ARB',
      'POL',
      'AVAX',
    ]);

    if (allowed.has(underlying)) return underlying;
  }

  // Final sanity
  if (s.length > 24) return null;
  if (s.includes(' ')) return null;

  return s;
};

/*
Sanity cases (expected):
"AAVE" -> "AAVE"
"AVAX" -> "AVAX"
"aPolWETH" -> "WETH"
"aETH" -> "ETH"
"variableDebtPolUSDT" -> null
"UNI-V2" -> null
"USDC.e" -> "USDC"
"USDT0" -> "USDT"
(native, chain=polygon) -> "POL"
"WPOL" -> "POL"
*/

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
  const summary = createPricingRunSummary();
  const uniqueAssetSet = new Set<string>();
  const limit = Math.max(1, Math.min(opts?.limit ?? MAX_ROWS_PER_RUN, MAX_ROWS_PER_RUN));
  const interval = opts?.interval ?? '1h';
  const skipped = {
    noSymbol: 0,
    spamSymbol: 0,
    zeroValue: 0,
    badTimestamp: 0,
    noCoinId: 0,
    noPrice: 0,
    badAmount: 0,
    badUsdValue: 0,
    updateNoop: 0,
  };
  let scanned = 0;
  let priced = 0;
  let apiCalls = 0;
  let errors = 0;

  try {
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
    scanned = rows.length;
    const groups = new Map<string, any[]>();

    for (const row of rows) {
      const chain = String(row.chain ?? '');
      const rawSymbol = String(row.token_symbol ?? '').trim();
      if (!rawSymbol) {
        skipped.noSymbol++;
        markRejected(summary, 'no_symbol');
        continue;
      }

      const symbol = normalizeSymbol(rawSymbol, chain);
      if (!symbol) {
        skipped.noSymbol++;
        markRejected(summary, 'no_symbol');
        continue;
      }
      if (isSpamSymbol(symbol)) {
        skipped.spamSymbol++;
        markRejected(summary, 'spam_unverified');
        continue;
      }

      const day = utcDay(String(row.timestamp ?? ''));
      if (!day) {
        skipped.badTimestamp++;
        markRejected(summary, 'bad_timestamp');
        continue;
      }

      const rawValue = row.value ? String(row.value) : '';
      if (!rawValue || rawValue === '0') {
        skipped.zeroValue++;
        markRejected(summary, 'zero_value');
        continue;
      }

      const key = `${symbol}|${day}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    const coinIdBySymbol = new Map<string, string | null>();

    for (const key of groups.keys()) {
      const symbol = key.split('|')[0]!;
      if (STABLECOINS.has(symbol)) continue;
      if (coinIdBySymbol.has(symbol)) continue;

      try {
        countProviderCall(summary, 'coingecko', 'metadata');
        coinIdBySymbol.set(symbol, await getCoingeckoIdBySymbol(symbol));
      } catch (err) {
        console.warn('[pricing] coin id lookup failed', { symbol, err });
        coinIdBySymbol.set(symbol, null);
        errors++;
      }
    }

    for (const [key, list] of groups.entries()) {
      const [symbol, day] = key.split('|') as [string, string];

      const eligibleRows: Array<{ row: any; amount: number }> = [];
      for (const row of list) {
        const amount = parseOnchainAmount(
          row.value ? String(row.value) : null,
          row.token_decimals == null ? null : Number(row.token_decimals),
        );
        if (amount == null || !Number.isFinite(amount) || amount <= 0) {
          skipped.badAmount++;
          markRejected(summary, 'bad_amount');
          continue;
        }
        eligibleRows.push({ row, amount });
      }
      if (!eligibleRows.length) continue;

      if (STABLECOINS.has(symbol)) {
        for (const { row, amount } of eligibleRows) {
          const unitPriceUsd = 1;
          const usdValue = amount * unitPriceUsd;

          if (!Number.isFinite(usdValue) || usdValue <= 0) {
            skipped.badUsdValue++;
            markRejected(summary, 'bad_usd_value');
            continue;
          }

          markAttempted(summary);
          try {
            const updateRes = await db.execute({
              sql: `UPDATE transactions
                    SET usd_unit_price = ?,
                        usd_value = ?,
                        usd_priced_at = ?,
                        usd_price_source = 'inferred:stablecoin-peg',
                        usd_price_confidence = 'inferred'
                    WHERE id = ? AND tenant_id = ?
                      AND (
                        usd_value IS NULL OR usd_value <= 0
                        OR usd_unit_price IS NULL OR usd_unit_price <= 0
                      )`,
              args: [
                unitPriceUsd,
                usdValue,
                String(row.timestamp || `${day}T12:00:00Z`),
                String(row.id),
                tenantId,
              ],
            });
            if (typeof (updateRes as any)?.rowsAffected === 'number' && (updateRes as any).rowsAffected === 0) {
              skipped.updateNoop++;
              markSkipped(summary, 'update_noop');
            } else {
              priced++;
              markPriced(summary);
            }
          } catch (err) {
            console.warn('[pricing] stablecoin update failed', { id: String(row.id), err });
            errors++;
            markSkipped(summary, 'db_error');
          }
        }
        continue;
      }

      const coinId = coinIdBySymbol.get(symbol);
      if (!coinId) {
        skipped.noCoinId += eligibleRows.length;
        for (const _ of eligibleRows) {
          markAttempted(summary);
          markSkipped(summary, 'no_coingecko_id');
        }
        continue;
      }

      trackUniqueAssetRequest(summary, `cg:${coinId}@${day}`, uniqueAssetSet);

      let pricedResult: Awaited<ReturnType<typeof getUsdUnitPriceAtTimestampCoinGecko>> | null = null;
      const priceTimestampIso = (() => {
        const raw = eligibleRows[0]?.row?.timestamp ? String(eligibleRows[0].row.timestamp) : '';
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? `${day}T12:00:00Z` : d.toISOString();
      })();

      try {
        countProviderCall(summary, 'coingecko', 'historical');
        pricedResult = await getUsdUnitPriceAtTimestampCoinGecko({
          coinId,
          timestampUtcIso: priceTimestampIso,
        });
        apiCalls++;
      } catch (err) {
        console.warn('[pricing] price lookup failed', { symbol, day, err });
        skipped.noPrice += eligibleRows.length;
        errors++;
        for (const _ of eligibleRows) {
          markAttempted(summary);
          markSkipped(summary, 'provider_error');
        }
        continue;
      }

      if (!pricedResult || !Number.isFinite(pricedResult.unitPriceUsd) || pricedResult.unitPriceUsd <= 0) {
        skipped.noPrice += eligibleRows.length;
        for (const _ of eligibleRows) {
          markAttempted(summary);
          markSkipped(summary, 'no_price_for_date');
        }
        continue;
      }

      const unitPriceUsd = pricedResult.unitPriceUsd; // number
      const pricedAtIso = pricedResult.pricedAtIso;   // string
      const priceSource = pricedResult.source;

      for (const { row, amount } of eligibleRows) {
        const usdValue = amount * unitPriceUsd;
        if (!Number.isFinite(usdValue) || usdValue <= 0) {
          skipped.badUsdValue++;
          markRejected(summary, 'bad_usd_value');
          continue;
        }

        markAttempted(summary);
        try {
          const updateRes = await db.execute({
            sql: `UPDATE transactions
                  SET usd_unit_price = ?,
                      usd_value = ?,
                      usd_priced_at = ?,
                      usd_price_source = ?,
                      usd_price_confidence = 'historical'
                  WHERE id = ? AND tenant_id = ?
                    AND (
                      usd_value IS NULL OR usd_value <= 0
                      OR usd_unit_price IS NULL OR usd_unit_price <= 0
                    )`,
            args: [unitPriceUsd, usdValue, pricedAtIso, priceSource, String(row.id), tenantId],
          });
          if (typeof (updateRes as any)?.rowsAffected === 'number' && (updateRes as any).rowsAffected === 0) {
            skipped.updateNoop++;
            markSkipped(summary, 'update_noop');
          } else {
            priced++;
            markPriced(summary);
          }
        } catch (err) {
          console.warn('[pricing] update failed', { id: String(row.id), err });
          errors++;
          markSkipped(summary, 'db_error');
        }
      }
    }

    if (priced > 0) {
      try {
        // skipPricing: true breaks the mutual recursion:
        //   lifecycle → priceMissing → rebuild(skipPricing:true)
        await rebuildAssetLifecycles(tenantId, { skipPricing: true });
      } catch (err) {
        console.warn('[pricing] lifecycle rebuild failed', err);
        errors++;
      }
    }

    return { ok: true, scanned, priced, apiCalls, errors, skipped, interval, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, scanned, priced, apiCalls, errors, skipped, interval, summary };
  } finally {
    finalizePricingRunSummary(summary);
    console.log(formatPricingRunOneLiner(summary));
  }
}
