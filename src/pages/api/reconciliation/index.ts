/**
 * GET /api/reconciliation
 *
 * Compares "Still in Wallet" FIFO lots against live wallet + exchange balances.
 * Returns ReconciliationItem[] sorted by severity then alpha.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { classifyTokenName } from '../../../lib/tokenClassification';
import { getTokenOverrides, lookupOverride, effectiveClass } from '../../../lib/tokenOverrides';
import { buildAnnualBreakdown, type AnnualBreakdownSource } from '../../../lib/annualBreakdown';
import { computeHoldings, type ImportRow } from '../../../lib/exchangeHoldings';
import { db } from '../../../lib/db';
import {
  deriveStatus,
  type ReconciliationItem,
  type SourceBreakdown,
} from '../../../lib/reconciliation';

export const prerender = false;

// ── Aave token filter (mirrors puller.ts isAaveToken) ───────────────────────
const AAVE_UNDERLYINGS = new Set([
  'ETH','WETH','WBTC','USDC','USDT','DAI','LINK','AAVE','BAL','CRV',
  'SNX','UNI','MKR','COMP','YFI','ZRX','ENJ','MANA','BAT','TUSD',
  'BUSD','SUSD','FRAX','USDP','GUSD','RAI','LUSD','EURS','GHST',
  'SUSHI','1INCH','REN','KNC','USDE',
]);
const isAaveSymbol = (sym: string): boolean => {
  if (sym.includes('DEBT') || sym.includes('ATOKEN')) return true;
  if (sym.startsWith('A') && AAVE_UNDERLYINGS.has(sym.slice(1))) return true;
  if (sym.startsWith('V') && AAVE_UNDERLYINGS.has(sym.slice(1))) return true;
  return false;
};

// ── Simple module-level TTL cache for expensive breakdown call ───────────────
const cache = new Map<string, { ts: number; data: ReconciliationItem[] }>();
const CACHE_TTL_MS = 60_000;

/**
 * Drop a tenant's cached reconciliation so the next load recomputes fresh. Called
 * from the lifecycle rebuild (the "Sync Tins" path), so a user who wants an override
 * reflected immediately just hits sync rather than waiting out the cache.
 */
export function clearReconciliationCache(tenantId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session ?? {};
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    const cacheKey = `${tenantId}:${new Date().getFullYear()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const currentYear = new Date().getFullYear();

    // Override-aware spam classification (symbol-level; reconciliation rows are by symbol).
    const tokenOverrides = await getTokenOverrides(tenantId);

    // ── Parallel data fetch ─────────────────────────────────────────────────
    const [bd, walletRows, exchangeRows, lastTxRows, notesRows] = await Promise.all([
      buildAnnualBreakdown(tenantId, currentYear, 'fifo', undefined, 'auto' as AnnualBreakdownSource),

      db.execute({
        sql: `WITH latest AS (
                SELECT wallet_id, chain, MAX(captured_at) AS captured_at
                FROM wallet_snapshots WHERE tenant_id = ?
                GROUP BY wallet_id, chain
              )
              SELECT ws.wallet_id, ws.chain, ws.payload_json,
                     w.label, w.address
              FROM wallet_snapshots ws
              JOIN latest l
                ON l.wallet_id = ws.wallet_id
               AND l.chain     = ws.chain
               AND l.captured_at = ws.captured_at
              JOIN wallets w ON w.id = ws.wallet_id AND w.tenant_id = ws.tenant_id
              WHERE ws.tenant_id = ?`,
        args: [tenantId, tenantId],
      }),

      db.execute({
        sql: `SELECT ea.id AS account_id, ea.source, ea.name,
                     it.timestamp_utc, it.asset_symbol, it.direction,
                     it.currency, it.amount, it.to_currency, it.to_amount,
                     it.native_usd, it.kind, it.description
              FROM exchange_accounts ea
              JOIN import_transactions it
                ON it.account_id = ea.id AND it.tenant_id = ea.tenant_id
              WHERE ea.tenant_id = ?
              ORDER BY it.timestamp_utc ASC`,
        args: [tenantId],
      }),

      db.execute({
        sql: `SELECT asset_symbol, MAX(timestamp_utc) AS last_tx
              FROM import_transactions WHERE tenant_id = ?
              GROUP BY asset_symbol`,
        args: [tenantId],
      }),

      db.execute({
        sql: `SELECT asset_symbol, note, flagged_for_support
              FROM reconciliation_notes WHERE tenant_id = ?`,
        args: [tenantId],
      }).catch(() => ({ rows: [] })), // graceful if table not migrated yet
    ]);

    // ── 1. FIFO lots → sum by symbol ────────────────────────────────────────
    const fifoBySymbol = new Map<string, { total: number; costUsd: number | null }>();
    for (const pos of bd.stillHolding) {
      const sym = pos.asset.toUpperCase();
      const entry = fifoBySymbol.get(sym) ?? { total: 0, costUsd: 0 };
      entry.total += pos.amount;
      if (pos.costUsd != null && entry.costUsd != null) entry.costUsd += pos.costUsd;
      else entry.costUsd = null;
      fifoBySymbol.set(sym, entry);
    }

    // ── 2. Wallet snapshots → sum by symbol ─────────────────────────────────
    type WalletRow = { wallet_id: unknown; chain: unknown; payload_json: unknown; label: unknown; address: unknown };
    const walletBySymbol = new Map<string, { total: number; sources: SourceBreakdown[] }>();

    for (const raw of walletRows.rows as WalletRow[]) {
      const address = String(raw.address ?? '');
      const label   = String(raw.label ?? '').trim() || address.slice(0, 10) + '…';
      let tokens: Array<Record<string, unknown>> = [];
      try { tokens = JSON.parse(String(raw.payload_json ?? '[]')); } catch { continue; }

      for (const tok of tokens) {
        const sym = String(tok.symbol ?? tok.tokenSymbol ?? '').trim().toUpperCase();
        if (!sym || isAaveSymbol(sym)) continue;
        const amount = Number(tok.amount ?? tok.balance ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const entry = walletBySymbol.get(sym) ?? { total: 0, sources: [] };
        entry.total += amount;
        const existing = entry.sources.find(s => s.label === label);
        if (existing) existing.amount += amount;
        else entry.sources.push({ kind: 'wallet', label, amount });
        walletBySymbol.set(sym, entry);
      }
    }

    // ── 3. Exchange imports → computeHoldings per account ──────────────────
    type ExRow = { account_id: unknown; source: unknown; name: unknown } & ImportRow;
    const byAccount = new Map<string, { name: string; rows: ImportRow[] }>();
    for (const raw of exchangeRows.rows as ExRow[]) {
      const accountId = String(raw.account_id ?? '');
      if (!accountId) continue;
      if (!byAccount.has(accountId)) {
        byAccount.set(accountId, {
          name: String(raw.name ?? raw.source ?? accountId),
          rows: [],
        });
      }
      byAccount.get(accountId)!.rows.push(raw as ImportRow);
    }

    const exchangeBySymbol = new Map<string, { total: number; sources: SourceBreakdown[] }>();
    for (const [, acct] of byAccount) {
      const holdings = computeHoldings(acct.rows);
      for (const h of holdings) {
        const sym = h.symbol.toUpperCase();
        const amount = h.balance + h.staked;
        if (amount <= 0) continue;
        const entry = exchangeBySymbol.get(sym) ?? { total: 0, sources: [] };
        entry.total += amount;
        entry.sources.push({ kind: 'exchange', label: acct.name, amount });
        exchangeBySymbol.set(sym, entry);
      }
    }

    // ── 4. Last transaction dates ────────────────────────────────────────────
    type LastTxRow = { asset_symbol: unknown; last_tx: unknown };
    const lastTxBySymbol = new Map<string, string>(
      (lastTxRows.rows as LastTxRow[]).map(r => [
        String(r.asset_symbol ?? '').toUpperCase(),
        String(r.last_tx ?? ''),
      ])
    );

    // ── 5. Notes ────────────────────────────────────────────────────────────
    type NoteRow = { asset_symbol: unknown; note: unknown; flagged_for_support: unknown };
    const notesMap = new Map(
      (notesRows.rows as NoteRow[]).map(r => [
        String(r.asset_symbol ?? '').toUpperCase(),
        { note: r.note ? String(r.note) : null, flagged: Number(r.flagged_for_support ?? 0) === 1 },
      ])
    );

    // ── 6. Build ReconciliationItem[] ───────────────────────────────────────
    const allSymbols = new Set([
      ...fifoBySymbol.keys(),
      ...walletBySymbol.keys(),
      ...exchangeBySymbol.keys(),
    ]);

    const items: ReconciliationItem[] = [];
    for (const sym of allSymbols) {
      if (!sym) continue;
      const fifo     = fifoBySymbol.get(sym);
      const wallets  = walletBySymbol.get(sym);
      const exchange = exchangeBySymbol.get(sym);

      const tinAmount  = fifo?.total ?? 0;
      const liveAmount = (wallets?.total ?? 0) + (exchange?.total ?? 0);
      const deltaCoins = liveAmount - tinAmount;

      const sources: SourceBreakdown[] = [
        ...(wallets?.sources  ?? []),
        ...(exchange?.sources ?? []),
      ];

      // Price estimate: average cost basis per coin (not live price — labeled "est.")
      const priceEst = (fifo?.costUsd != null && fifo.total > 0)
        ? fifo.costUsd / fifo.total
        : null;
      const deltaUsd     = priceEst != null ? deltaCoins * priceEst : null;
      const deltaPercent = tinAmount > 0 ? ((liveAmount - tinAmount) / tinAmount) * 100 : null;

      const noteData = notesMap.get(sym) ?? null;

      items.push({
        asset: sym,
        tinAmount,
        liveAmount,
        tinCostUsd:   fifo?.costUsd ?? null,
        deltaCoins,
        deltaUsd,
        deltaPercent,
        status:       deriveStatus(tinAmount, liveAmount),
        lastTxDate:   lastTxBySymbol.get(sym) ?? null,
        sources,
        existingNote: noteData
          ? { note: noteData.note, flaggedForSupport: noteData.flagged }
          : null,
        filtered:     effectiveClass(
                        classifyTokenName({ symbol: sym }).class,
                        lookupOverride(tokenOverrides, { symbol: sym }),
                      ) === 'spam',
      });
    }

    // Sort: flagged first, then by abs(deltaPercent) desc, then alpha
    items.sort((a, b) => {
      const aFlag = a.existingNote?.flaggedForSupport ? 1 : 0;
      const bFlag = b.existingNote?.flaggedForSupport ? 1 : 0;
      if (bFlag !== aFlag) return bFlag - aFlag;
      const aAbs = Math.abs(a.deltaPercent ?? 0);
      const bAbs = Math.abs(b.deltaPercent ?? 0);
      if (bAbs !== aAbs) return bAbs - aAbs;
      return a.asset.localeCompare(b.asset);
    });

    cache.set(cacheKey, { ts: Date.now(), data: items });

    return new Response(JSON.stringify(items), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[api/reconciliation]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
