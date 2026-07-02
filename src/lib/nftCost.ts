/**
 * nftCost.ts — manual cost basis for NFTs (contract + tokenId granularity).
 *
 * NFT cost isn't auto-derived from the acquisition payment yet, so the preparer can
 * enter it. Stored per (tenant, chain, contract, tokenId); read by annualBreakdown to
 * populate NftHolding.costUsd (shown when > $1). Tenant-isolated.
 */
const getDb = async () => (await import('./db')).db;

let ensured = false;
export async function ensureNftCostTable(): Promise<void> {
  if (ensured) return;
  const db = await getDb();
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS nft_manual_cost (
            tenant_id  TEXT NOT NULL,
            chain      TEXT NOT NULL,
            contract   TEXT NOT NULL,
            token_id   TEXT NOT NULL,
            cost_usd   DOUBLE PRECISION,
            updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
            PRIMARY KEY (tenant_id, chain, contract, token_id)
          )`,
    args: [],
  });
  ensured = true;
}

const key = (chain: string, contract: string, tokenId: string) =>
  `${chain.toLowerCase()}|${contract.toLowerCase()}|${tokenId}`;

export async function getNftCosts(tenantId: string): Promise<Map<string, number>> {
  await ensureNftCostTable();
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT chain, contract, token_id, cost_usd FROM nft_manual_cost WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const m = new Map<string, number>();
  for (const r of res.rows as unknown as { chain: string; contract: string; token_id: string; cost_usd: number | null }[]) {
    if (r.cost_usd != null && Number.isFinite(Number(r.cost_usd))) {
      m.set(key(r.chain, r.contract, r.token_id), Number(r.cost_usd));
    }
  }
  return m;
}

export function lookupNftCost(costs: Map<string, number>, nft: { chain: string; contract: string; tokenId: string }): number | null {
  return costs.get(key(nft.chain, nft.contract, nft.tokenId)) ?? null;
}

export async function setNftCost(tenantId: string, input: { chain: string; contract: string; tokenId: string; costUsd: number | null }): Promise<void> {
  await ensureNftCostTable();
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO nft_manual_cost (tenant_id, chain, contract, token_id, cost_usd)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, chain, contract, token_id)
          DO UPDATE SET cost_usd = EXCLUDED.cost_usd,
                        updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
    args: [tenantId, input.chain, input.contract, input.tokenId, input.costUsd],
  });
}
