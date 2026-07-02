/**
 * GET /api/tokens/junk — the tokens filtered out as spam/scam, for the Junk drawer.
 *
 * Scans the latest wallet snapshots (fungible) and NFT snapshots, classifies each
 * with the single source of truth (tokenClassification), applies any per-tenant
 * override, and returns those that resolve to 'spam' (i.e. currently hidden). This
 * makes the silent filtering auditable. Read-only; tenant-scoped.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';
import { classifyToken } from '../../../lib/tokenClassification';
import { classifyContract } from '../../../lib/knownContracts';
import { getTokenOverrides, lookupOverride, effectiveClass } from '../../../lib/tokenOverrides';

export const prerender = false;

type JunkToken = {
  symbol: string; name: string | null; contract: string | null; chain: string;
  amount: number | null; valueUsd: number | null; reason: string; source: 'wallet' | 'nft';
  override: 'junk' | null; // 'junk' = user explicitly confirmed; null = heuristic, needs review
};

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session?.tenantId) return json(401, { ok: false, error: 'unauthorized' });
    const tenantId = session.tenantId;

    const overrides = await getTokenOverrides(tenantId);
    const out: JunkToken[] = [];
    const seen = new Set<string>();

    // ── Fungible tokens from latest wallet snapshots ──────────────────────────
    const walletRows = await db.execute({
      sql: `WITH latest AS (
              SELECT wallet_id, chain, MAX(captured_at) AS captured_at
              FROM wallet_snapshots WHERE tenant_id = ? GROUP BY wallet_id, chain
            )
            SELECT ws.chain, ws.payload_json
            FROM wallet_snapshots ws
            JOIN latest l ON l.wallet_id = ws.wallet_id AND l.chain = ws.chain AND l.captured_at = ws.captured_at
            WHERE ws.tenant_id = ?`,
      args: [tenantId, tenantId],
    });
    for (const raw of walletRows.rows as unknown as { chain: unknown; payload_json: unknown }[]) {
      const chain = String(raw.chain ?? '');
      let tokens: Array<Record<string, unknown>> = [];
      try { tokens = JSON.parse(String(raw.payload_json ?? '[]')); } catch { continue; }
      for (const tok of tokens) {
        const symbol = String(tok.symbol ?? tok.tokenSymbol ?? '').trim();
        if (!symbol) continue;
        const name = typeof tok.name === 'string' ? tok.name : null;
        const contract = typeof tok.tokenAddress === 'string' ? tok.tokenAddress
                       : typeof tok.contract === 'string' ? tok.contract : null;
        const amount = Number(tok.amount ?? tok.balance ?? 0) || null;
        const valueUsd = Number(tok.valueUsd ?? 0) || null;
        const verdict = contract ? classifyContract(chain, symbol, contract) : undefined;
        const res = classifyToken({ symbol, name, contractVerdict: verdict });
        const ov = lookupOverride(overrides, { chain, contract, symbol });
        if (effectiveClass(res.class, ov) !== 'spam') continue;
        const key = `w|${chain}|${(contract ?? '').toLowerCase()}|${symbol.toUpperCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol, name, contract, chain, amount, valueUsd, reason: res.reason, source: 'wallet', override: ov === 'junk' ? 'junk' : null });
      }
    }

    // ── NFTs from NFT snapshots ───────────────────────────────────────────────
    const nftRows = await db.execute({
      sql: `SELECT payload_json FROM wallet_nft_snapshot WHERE tenant_id = ?`,
      args: [tenantId],
    });
    for (const raw of nftRows.rows as unknown as { payload_json: unknown }[]) {
      let payload: { items?: unknown[] } = {};
      try { payload = JSON.parse(String(raw.payload_json ?? '{}')); } catch { continue; }
      for (const item of payload.items ?? []) {
        const i = item as Record<string, unknown>;
        const symbol = typeof i.symbol === 'string' ? i.symbol : '';
        const name = typeof i.name === 'string' ? i.name : null;
        const chain = String(i.chain ?? '');
        const contract = typeof i.contract === 'string' ? i.contract : null;
        const res = classifyToken({ symbol, name });
        if (res.class === 'clean') continue;
        const ov = lookupOverride(overrides, { chain, contract, symbol });
        if (effectiveClass(res.class, ov) !== 'spam') continue;
        const key = `n|${chain}|${(contract ?? '').toLowerCase()}|${name ?? symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol: symbol || (name ?? 'NFT'), name, contract, chain, amount: null, valueUsd: null, reason: res.reason, source: 'nft', override: ov === 'junk' ? 'junk' : null });
      }
    }

    out.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || a.symbol.localeCompare(b.symbol));
    return json(200, { ok: true, items: out });
  } catch (err) {
    return json(500, { ok: false, error: String(err) });
  }
};
