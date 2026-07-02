/**
 * junkTokens.ts — shared "what got filtered as spam/scam" scan, used by both the
 * Junk drawer endpoint and the Year Summary PDF appendix (single source, no drift).
 *
 * Scans latest wallet + NFT snapshots, classifies each with the single classifier,
 * applies per-tenant overrides, and also folds in the legacy nft_hidden store (NFTs
 * the user hid before the override system) so everything set aside is in one place.
 */
import { classifyToken } from './tokenClassification';
import { classifyContract } from './knownContracts';
import { getTokenOverrides, lookupOverride, effectiveClass } from './tokenOverrides';

export type JunkToken = {
  symbol: string; name: string | null; contract: string | null; chain: string;
  amount: number | null; valueUsd: number | null; reason: string;
  source: 'wallet' | 'nft'; override: 'junk' | null;
};

const getDb = async () => (await import('./db')).db;

export async function getFilteredTokens(tenantId: string): Promise<JunkToken[]> {
  const db = await getDb();
  const overrides = await getTokenOverrides(tenantId);
  const out: JunkToken[] = [];
  const seen = new Set<string>();

  // Legacy: NFTs the user explicitly hid before the override system existed.
  const hidden = await db.execute({
    sql: `SELECT LOWER(contract_address) AS c FROM nft_hidden WHERE tenant_id = ?`,
    args: [tenantId],
  }).catch(() => ({ rows: [] as unknown[] }));
  const hiddenContracts = new Set(
    (hidden.rows as unknown as { c: string }[]).map((r) => r.c).filter(Boolean),
  );

  // Fungible tokens from latest wallet snapshots.
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

  // NFTs from NFT snapshots.
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
      const ov = lookupOverride(overrides, { chain, contract, symbol });
      const isHidden = contract ? hiddenContracts.has(contract.toLowerCase()) : false;
      // Show if heuristic/override says spam, OR the user legacy-hid it.
      const spam = effectiveClass(res.class, ov) === 'spam';
      if (!spam && !isHidden) continue;
      const key = `n|${chain}|${(contract ?? '').toLowerCase()}|${name ?? symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        symbol: symbol || (name ?? 'NFT'), name, contract, chain,
        amount: null, valueUsd: null,
        reason: spam ? res.reason : 'hidden by you',
        source: 'nft', override: ov === 'junk' || isHidden ? 'junk' : null,
      });
    }
  }

  out.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || a.symbol.localeCompare(b.symbol));
  return out;
}
