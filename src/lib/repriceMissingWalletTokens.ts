import { db } from '@/lib/db';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { invalidateWalletCache } from '@/lib/db/puller';
import { classifyContract } from '@/lib/knownContracts';
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

const DEFAULT_LOCK_TTL_SECONDS = 120;

type SnapshotRow = {
  id: string;
  wallet_id: string;
  chain: string;
  payload_json: string | null;
  totals_usd: number | null;
  captured_at: string | null;
};

type RepriceOptions = {
  tenantId: string;
  walletId?: string;
  symbols?: string[];
  source?: 'coingecko';
  trigger?: 'price-failure' | 'view' | 'cron' | 'snapshot-insert' | 'tokens.refreshMissing';
  lockTtlSeconds?: number;
};

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

const normalizeSymbol = (value: unknown) => {
  if (typeof value !== 'string') return null;
  let upper = value.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'MATIC' || upper === 'WMATIC') upper = 'POL';
  if (upper === 'WBTC') upper = 'BTC';
  if (upper === 'WETH') upper = 'ETH';
  if (upper.endsWith('.E')) upper = upper.slice(0, -2);
  return upper;
};

const COINGECKO_ID_TO_SYMBOL: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  'polygon-ecosystem-token': 'POL',
  'avalanche-2': 'AVAX',
  arbitrum: 'ARB',
  weth: 'WETH',
};

const COINGECKO_SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  POL: 'polygon-ecosystem-token',
  AVAX: 'avalanche-2',
  ARB: 'arbitrum',
  WETH: 'weth',
  USDC: 'usd-coin',
  USDT: 'tether',
};

const normalizePriceMap = (raw: Record<string, number>) => {
  const mapped: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeSymbol(key) ?? COINGECKO_ID_TO_SYMBOL[key.toLowerCase()];
    if (!normalizedKey) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      mapped[normalizedKey] = value;
    }
  }
  return mapped;
};

const getCoinpaprikaPrices = async (symbols: string[], summary?: ReturnType<typeof createPricingRunSummary>) => {
  const allowed = allowlistSymbols(symbols);
  if (!allowed.length) return {};
  if (summary) countProviderCall(summary, 'coinpaprika', 'spot');
  const tickers = (await getTickersUSD()) as Array<{
    id?: string;
    symbol?: string;
    rank?: number;
    quotes?: { USD?: { price?: number } };
  }>;
  const priceMap: Record<string, number> = {};
  const symbolSet = new Set(allowed);
  const candidates = new Map<string, Array<{ id: string; price: number; rank: number }>>();
  for (const ticker of tickers) {
    const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
    if (!symbol || !symbolSet.has(symbol)) continue;
    const price = ticker.quotes?.USD?.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    const id = String(ticker.id ?? '').trim();
    const rank =
      typeof ticker.rank === 'number' && Number.isFinite(ticker.rank) ? ticker.rank : 999999;
    const list = candidates.get(symbol) ?? [];
    list.push({ id, price, rank });
    candidates.set(symbol, list);
  }
  for (const symbol of symbolSet) {
    const list = candidates.get(symbol);
    if (!list?.length) continue;
    list.sort((a, b) => a.rank - b.rank);
    priceMap[symbol] = list[0].price;
  }
  return priceMap;
};

const probeCoingecko = async (symbols: string[], summary?: ReturnType<typeof createPricingRunSummary>) => {
  const ids = symbols
    .map((symbol) => COINGECKO_SYMBOL_TO_ID[symbol])
    .filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    ids.join(',')
  )}&vs_currencies=usd`;
  try {
    if (summary) countProviderCall(summary, 'coingecko', 'spot');
    const response = await fetch(url);
    const parsed = await response.json();
    console.warn('[reprice] coingecko probe result', { status: response.status, parsed });
  } catch (error) {
    console.warn('[reprice] coingecko probe failed', { error });
  }
};

const coerceNumber = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getTokenAmount = (token: Record<string, unknown>) =>
  coerceNumber(token.amount ?? token.balance);

const getTokenValue = (token: Record<string, unknown>) =>
  coerceNumber(token.valueUsd ?? token.usdValue);

const setTokenValue = (token: Record<string, unknown>, valueUsd: number | null) => {
  if ('valueUsd' in token || !('usdValue' in token)) {
    token.valueUsd = valueUsd;
  } else {
    token.usdValue = valueUsd;
  }
};

const setTokenPrice = (token: Record<string, unknown>, priceUsd: number | null) => {
  token.priceUsd = priceUsd;
};

const isValidPositive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

const shouldReprice = (price: number | null, value: number | null, amount: number | null) => {
  if (!isValidPositive(amount)) return false;
  return !isValidPositive(price) || !isValidPositive(value);
};

function isSnapshotRow(row: unknown): row is SnapshotRow {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.wallet_id === 'string' &&
    typeof r.chain === 'string' &&
    (r.payload_json === null || typeof r.payload_json === 'string') &&
    (r.totals_usd === null || typeof r.totals_usd === 'number') &&
    (r.captured_at === null || typeof r.captured_at === 'string')
  );
}

/**
 * Repairs wallet snapshots with missing prices by re-fetching prices and updating payload_json.
 */
export async function repriceMissingWalletTokens(options: RepriceOptions) {
  const { tenantId, walletId, symbols, source = 'coingecko', trigger, lockTtlSeconds } = options;
  const summary = createPricingRunSummary();
  const uniqueAssetSet = new Set<string>();

  try {
    if (!tenantId) throw new Error('Missing tenantId');

    const lockKey = `lock:reprice:${tenantId}:${walletId ?? 'all'}`;
    const gotLock = await tryAcquireLock(lockKey, lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS);
    if (!gotLock) {
      console.info('[reprice] skipped (locked)', { tenantId, walletId, trigger });
      markAttempted(summary);
      markSkipped(summary, 'locked');
      return { ok: true, skipped: true, reason: 'locked', summary };
    }

    const start = Date.now();
    console.info('[reprice] start', { tenantId, walletId, trigger, source });

    const baseArgs: any[] = [tenantId];
    let walletClause = '';
    if (walletId) {
      walletClause = 'AND ws.wallet_id = ?';
      baseArgs.push(walletId);
    }

    const symbolFilter = Array.isArray(symbols) && symbols.length
      ? new Set(symbols.map(normalizeSymbol).filter((s): s is string => !!s))
      : null;

    const result = await db.execute({
      sql: `
        WITH latest AS (
          SELECT
            ws.wallet_id,
            ws.chain,
            MAX(ws.captured_at) AS captured_at
          FROM wallet_snapshots ws
          WHERE ws.tenant_id = ? ${walletClause}
          GROUP BY ws.wallet_id, ws.chain
        )
        SELECT
          ws.id,
          ws.wallet_id,
          ws.chain,
          ws.payload_json,
          ws.totals_usd,
          ws.captured_at
        FROM wallet_snapshots ws
        JOIN latest l ON l.wallet_id = ws.wallet_id
                      AND l.chain = ws.chain
                      AND l.captured_at = ws.captured_at
        WHERE ws.tenant_id = ? ${walletClause}
      `,
      args: [...baseArgs, ...baseArgs],
    });

    const rawRows: unknown[] = Array.isArray(result.rows) ? result.rows : [];
    const rows = rawRows.filter(isSnapshotRow);
    console.info('[reprice] snapshots found', { count: rows.length });
    if (rows.length !== rawRows.length) {
      console.warn('[reprice] Dropped invalid snapshot rows', {
        totalRaw: rawRows.length,
        valid: rows.length,
        invalidExamples: rawRows.filter((row) => !isSnapshotRow(row)).slice(0, 3),
      });
    }

    const rowsToUpdate: Array<{
      row: SnapshotRow;
      tokens: Record<string, unknown>[];
      changed: boolean;
    }> = [];

    const missingSymbols = new Set<string>();
    let spotProviderFailed = false;

    for (const row of rows) {
      if (!row.payload_json) {
        markRejected(summary, 'invalid_payload');
        continue;
      }

      let tokens: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(row.payload_json);
        if (Array.isArray(parsed)) tokens = parsed;
      } catch {
        markRejected(summary, 'invalid_payload');
        continue;
      }

      let changed = false;
      let hasTokensNeedingReprice = false;
      const day = row.captured_at ? String(row.captured_at).slice(0, 10) : 'unknown';

      for (const token of tokens) {
        const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
        if (!symbol) {
          markRejected(summary, 'no_symbol');
          continue;
        }

        const sourceLower = String(token.source ?? '').toLowerCase();
        if (sourceLower === 'aave' || sourceLower === 'defi') {
          markRejected(summary, 'excluded_source');
          continue;
        }

        if (symbolFilter && !symbolFilter.has(symbol)) {
          markRejected(summary, 'unsupported_asset');
          continue;
        }

        const amount = getTokenAmount(token);
        const price = coerceNumber(token.priceUsd);
        const value = getTokenValue(token);

        // Reject scam tokens before the already-priced guard so that fake tokens
        // with a stale price (e.g. fake AAVE airdropped at real AAVE rates) get
        // zeroed out on every sync, not only when they're missing a price.
        const tokenAddress = typeof token.tokenAddress === 'string' ? token.tokenAddress.toLowerCase() : null;
        if (tokenAddress) {
          const verdict = classifyContract(row.chain, symbol, tokenAddress);
          if (verdict === 'scam') {
            setTokenPrice(token, null);
            setTokenValue(token, null);
            changed = true;
            markRejected(summary, 'scam_contract' as any);
            continue;
          }
        }

        if (!shouldReprice(price, value, amount)) {
          markAttempted(summary);
          markSkipped(summary, 'already_priced');
          continue;
        }

        if (!isValidPositive(amount)) {
          markRejected(summary, 'zero_value');
          continue;
        }

        // Token needs a price lookup — mark the row for update even if there are no
        // poison zeros to clear (i.e. priceUsd was genuinely null, not a bad zero).
        hasTokensNeedingReprice = true;
        missingSymbols.add(symbol);
        trackUniqueAssetRequest(summary, `sym:${row.chain}:${symbol}@spot`, uniqueAssetSet);

        // Clear poison zeros
        if (price !== null && !isValidPositive(price)) {
          setTokenPrice(token, null);
          changed = true;
        }
        if (value !== null && !isValidPositive(value)) {
          setTokenValue(token, null);
          changed = true;
        }
      }

      if (changed || hasTokensNeedingReprice) {
        rowsToUpdate.push({ row, tokens, changed });
      }
    }

    const symbolsToFetch = Array.from(missingSymbols);
    console.info('[reprice] symbols needing price', { count: symbolsToFetch.length });

    let priceMap: Record<string, number> = {};
    if (symbolsToFetch.length) {
      try {
        priceMap = await getCoinpaprikaPrices(symbolsToFetch, summary);
      } catch (err) {
        console.warn('[reprice] CoinPaprika failed', err);
        spotProviderFailed = true;
      }

      if (!Object.keys(priceMap).length) {
        try {
          await probeCoingecko(symbolsToFetch, summary);
        } catch (err) {
          console.warn('[reprice] CoinGecko probe failed', err);
          spotProviderFailed = true;
        }
      }
    }

    const normalizedPriceMap = normalizePriceMap(priceMap);

    let updatedRows = 0;
    let updatedTokens = 0;
    const walletsTouched = new Set<string>();

    for (const { row, tokens } of rowsToUpdate) {
      let rowChanged = false;
      let totalsUsd = 0;

      for (const token of tokens) {
        const amount = getTokenAmount(token);
        const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol) ?? '';
        const priceCurrent = coerceNumber(token.priceUsd);
        const valueCurrent = getTokenValue(token);
        const needsReprice = shouldReprice(priceCurrent, valueCurrent, amount);

        const newPrice = normalizedPriceMap[symbol] ?? null;

        if (needsReprice && !isValidPositive(newPrice)) {
          markAttempted(summary);
          markSkipped(summary, spotProviderFailed ? 'provider_error' : 'no_spot_price');
        }

        if (isValidPositive(newPrice)) {
          if (!isValidPositive(priceCurrent)) {
            setTokenPrice(token, newPrice);
            rowChanged = true;
            updatedTokens++;
          }

          if (isValidPositive(amount)) {
            const nextValue = amount * newPrice;
            const nextValueValid = Number.isFinite(nextValue) && nextValue > 0 ? nextValue : null;
            setTokenValue(token, nextValueValid);
            rowChanged = true;
            if (needsReprice) {
              if (nextValueValid != null) {
                markAttempted(summary);
                markPriced(summary);
              } else {
                markRejected(summary, 'bad_usd_value');
              }
            }
          } else {
            setTokenValue(token, null);
            rowChanged = true;
          }
        } else {
          // Clear poison zeros
          if (!isValidPositive(priceCurrent) && priceCurrent !== null) {
            setTokenPrice(token, null);
            rowChanged = true;
          }
          if (!isValidPositive(valueCurrent) && valueCurrent !== null) {
            setTokenValue(token, null);
            rowChanged = true;
          }
        }

        const finalValue = getTokenValue(token);
        if (isValidPositive(finalValue)) {
          totalsUsd += finalValue;
        }
      }

      if (!rowChanged) continue;

      try {
        await db.execute({
          sql: `
            UPDATE wallet_snapshots
            SET payload_json = ?,
                totals_usd = ?
            WHERE id = ? AND tenant_id = ? AND wallet_id = ?
          `,
          args: [JSON.stringify(tokens), totalsUsd, row.id, tenantId, row.wallet_id],
        });

        updatedRows++;
        walletsTouched.add(row.wallet_id);
      } catch (err) {
        console.error('[reprice] update failed', { snapshotId: row.id, err });
      }
    }

    if (walletsTouched.size) {
      console.info('[reprice] updated', {
        tenantId,
        wallets: Array.from(walletsTouched),
        updatedRows,
        updatedTokens,
      });

      for (const walletId of walletsTouched) {
        invalidateWalletCache(walletId, tenantId);
      }

      try {
        await db.execute({
          sql: 'DELETE FROM cache WHERE cache_key = ?',
          args: [`t:${tenantId}:networth:summary:v2`],
        });
      } catch (err) {
        console.warn('[reprice] networth cache invalidation failed', err);
      }

      await rebuildAssetLifecycles(tenantId);
    }

    console.info('[reprice] done', {
      tenantId,
      walletId,
      updatedRows,
      updatedTokens,
      elapsedMs: Date.now() - start,
    });

    return {
      ok: true,
      updatedRows,
      updatedTokens,
      walletsTouched: Array.from(walletsTouched),
      elapsedMs: Date.now() - start,
      summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, summary };
  } finally {
    finalizePricingRunSummary(summary);
    console.log(formatPricingRunOneLiner(summary));
  }
}
