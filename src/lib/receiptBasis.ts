/**
 * receiptBasis.ts — the shared "linking a held token back to its acquisition event
 * + FMV" workstream. Two consumers depend on the same primitive:
 *   - income reclassification (a real airdrop → ordinary income at FMV at receipt)
 *   - NFT cost basis (what the NFT cost when acquired)
 *
 * Sources, in priority order:
 *   1. import_transactions — a received row already carries amount + native_usd (FMV).
 *      Reliable and free; used today.
 *   2. on-chain acquisition transfer via an explorer (Alchemy getAssetTransfers),
 *      priced historically. This is what actually covers unsolicited on-chain airdrops
 *      and NFTs (they aren't in import_transactions). NOT YET WIRED — it needs the
 *      Alchemy key + live validation against a real airdrop/NFT. Returns null for now
 *      so callers fall back to manual entry rather than a fabricated number.
 *
 * Best-effort and non-fatal: any failure returns null. Lazy db import so pure callers
 * and tests don't pull in the engine.
 */

export type ReceiptBasis = {
  acquiredAt: string;         // ISO/date of the receipt event
  amount: number;             // quantity received
  fmvUsd: number | null;      // total USD fair market value at receipt (null = unpriceable)
  source: 'import' | 'onchain';
};

const getDb = async () => (await import('./db')).db;

export async function deriveReceiptBasis(
  tenantId: string,
  token: { symbol?: string | null; chain?: string | null; contract?: string | null; tokenId?: string | null },
): Promise<ReceiptBasis | null> {
  const symbol = (token.symbol ?? '').trim();

  // 1. Import path — earliest inbound row for this symbol that carries a USD value.
  if (symbol) {
    try {
      const db = await getDb();
      const r = await db.execute({
        sql: `SELECT amount, native_usd, timestamp_utc
              FROM import_transactions
              WHERE tenant_id = ?
                AND UPPER(asset_symbol) = UPPER(?)
                AND direction = 'in'
                AND amount IS NOT NULL AND ABS(amount) > 0
              ORDER BY timestamp_utc ASC
              LIMIT 1`,
        args: [tenantId, symbol],
      });
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        return {
          acquiredAt: String(row.timestamp_utc ?? ''),
          amount: Math.abs(Number(row.amount ?? 0)),
          fmvUsd: row.native_usd != null && Number.isFinite(Number(row.native_usd)) ? Number(row.native_usd) : null,
          source: 'import',
        };
      }
    } catch { /* non-fatal — fall through */ }
  }

  // 2. On-chain path (Alchemy getAssetTransfers → historical FMV). Next slice.
  //    Covers on-chain airdrops and NFTs that never touched a CSV import.
  return null;
}
