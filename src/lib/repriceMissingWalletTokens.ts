// src/lib/prices/repriceMissingWalletTokens.ts (suggested name)
import { db } from '@/lib/db';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { invalidateWalletCache } from '@/lib/db/puller';

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
// Helpers (unchanged but extracted for clarity)
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

const getCoinpaprikaPrices = async (symbols: string[]) => {
  const allowed = allowlistSymbols(symbols);
  if (!allowed.length) return {};

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
    const rank = Number.isFinite(ticker.rank) ? ticker.rank! : 999999;
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

const probeCoingecko = async (symbols: string[]) => {
  const ids = symbols
    .map((symbol) => COINGECKO_SYMBOL_TO_ID[symbol])
    .filter((id): id is string => Boolean(id));

  if (!ids.length) return;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    ids.join(',')
  )}&vs_currencies=usd`;

  try {
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

const isValidPositive = (value: number | null) =>
  value !== null && Number.isFinite(value) && value > 0;

const shouldReprice = (price: number | null, value: number | null, amount: number | null) => {
  if (!isValidPositive(amount)) return false;
  return !isValidPositive(price) || !isValidPositive(value);
};

/**
 * Repairs wallet snapshots with missing prices by re-fetching prices and updating payload_json.
 * This avoids zero-price poisoning when upstream price providers fail.
 */
export async function repriceMissingWalletTokens(options: RepriceOptions) {
  const { tenantId, walletId, symbols, source = 'coingecko', trigger, lockTtlSeconds } = options;

  if (!tenantId) throw new Error('Missing tenantId');

  const lockKey = `lock:reprice:${tenantId}:${walletId ?? 'all'}`;
  const gotLock = await tryAcquireLock(lockKey, lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS);
  if (!gotLock) {
    console.info('[reprice] skipped (locked)', { tenantId, walletId, trigger });
    return { ok: true, skipped: true, reason: 'locked' };
  }

  const start = Date.now();
  console.info('[reprice] start', { tenantId, walletId, trigger, source });

  const baseArgs: any[] = [tenantId];
  let walletClause = '';
  if (walletId) {
    walletClause = 'AND wallet_id = ?';
    baseArgs.push(walletId);
  }

  const symbolFilter = Array.isArray(symbols) && symbols.length
    ? new Set(symbols.map(normalizeSymbol).filter((s): s is string => !!s))
    : null;

  // Fetch latest snapshots
  const result = await db.execute({
    sql: `
      WITH latest AS (
        SELECT
          ws.wallet_id,
          ws.chain,
          MAX(datetime(ws.captured_at)) AS captured_at
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
                    AND datetime(l.captured_at) = datetime(ws.captured_at)
      WHERE ws.tenant_id = ? ${walletClause}
    `,
    args: baseArgs,
  });

  const rows = result.rows as SnapshotRow[];
  console.info('[reprice] snapshots found', { count: rows.length });

  const rowsToUpdate: Array<{
    row: SnapshotRow;
    tokens: Record<string, unknown>[];
    changed: boolean;
  }> = [];

  const missingSymbols = new Set<string>();

  for (const row of rows) {
    if (!row.payload_json) continue;

    let tokens: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(row.payload_json);
      if (Array.isArray(parsed)) tokens = parsed;
    } catch {
      continue;
    }

    let changed = false;

    for (const token of tokens) {
      const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol);
      if (!symbol) continue;

      const sourceLower = String(token.source ?? '').toLowerCase();
      if (sourceLower === 'aave' || sourceLower === 'defi') continue;

      if (symbolFilter && !symbolFilter.has(symbol)) continue;

      const amount = getTokenAmount(token);
      const price = coerceNumber(token.priceUsd);
      const value = getTokenValue(token);

      if (!shouldReprice(price, value, amount)) continue;

      if (isValidPositive(amount)) {
        missingSymbols.add(symbol);
      }

      // Normalize poison zeros
      if (price !== null && !isValidPositive(price)) {
        setTokenPrice(token, null);
        changed = true;
      }
      if (value !== null && !isValidPositive(value)) {
        setTokenValue(token, null);
        changed = true;
      }
    }

    if (changed) {
      rowsToUpdate.push({ row, tokens, changed });
    }
  }

  const symbolsToFetch = Array.from(missingSymbols);
  console.info('[reprice] symbols needing price', { count: symbolsToFetch.length });

  let priceMap: Record<string, number> = {};
  if (symbolsToFetch.length) {
    try {
      priceMap = await getCoinpaprikaPrices(symbolsToFetch);
    } catch (err) {
      console.warn('[reprice] CoinPaprika failed', err);
    }

    if (!Object.keys(priceMap).length) {
      await probeCoingecko(symbolsToFetch);
    }
  }

  const normalizedPriceMap = normalizePriceMap(priceMap);

  let updatedRows = 0;
  const walletsTouched = new Set<string>();

  for (const { row, tokens, changed } of rowsToUpdate) {
    let rowChanged = changed;
    if (!rowChanged) continue;

    let totalsUsd = 0;
    for (const token of tokens) {
      const amount = getTokenAmount(token);
      const priceCurrent = coerceNumber(token.priceUsd);
      const valueCurrent = getTokenValue(token);
      const symbol = normalizeSymbol(token.symbol ?? token.tokenSymbol) ?? '';

      const newPriceCandidate = isValidPositive(priceCurrent)
        ? priceCurrent
        : (normalizedPriceMap[symbol] ?? null);

      if (isValidPositive(newPriceCandidate)) {
        // fill missing price
        if (!isValidPositive(priceCurrent)) {
          setTokenPrice(token, newPriceCandidate);
          rowChanged = true;
        }

        // fill (or recompute) missing value
        if (isValidPositive(amount) && isValidPositive(newPriceCandidate)) {
          const nextValue = amount * newPriceCandidate;
          setTokenValue(token, Number.isFinite(nextValue) && nextValue > 0 ? nextValue : null);
          rowChanged = true;
        } else {
          setTokenValue(token, null);
          rowChanged = true;
        }
      } else {
        // If we still can't price it, make sure poison zeros never persist
        if (!isValidPositive(priceCurrent) && priceCurrent !== null) {
          setTokenPrice(token, null);
          rowChanged = true;
        }
        if (!isValidPositive(valueCurrent) && valueCurrent !== null) {
          setTokenValue(token, null);
          rowChanged = true;
        }
      } // end token loop

      const value = getTokenValue(token);
      if (isValidPositive(value)) {
        totalsUsd += value;
      }
    } // end token loop

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
  } // end entry loop

  if (walletsTouched.size) {
    console.info('[reprice] updated', {
      tenantId,
      wallets: Array.from(walletsTouched),
      updatedRows,
    });

    for (const walletId of walletsTouched) {
      invalidateWalletCache(walletId, tenantId);
    }

    // Optional: invalidate networth cache
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
    elapsedMs: Date.now() - start,
  });

  return {
    ok: true,
    updatedRows,
    walletsTouched: Array.from(walletsTouched),
    elapsedMs: Date.now() - start,
  };
}
