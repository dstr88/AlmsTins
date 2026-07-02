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

import type { AlchemyChain } from './alchemy';

const getDb = async () => (await import('./db')).db;

// Our chain names → Alchemy networks (only these two are configured today).
const CHAIN_MAP: Record<string, AlchemyChain> = {
  ethereum: 'eth-mainnet', eth: 'eth-mainnet', mainnet: 'eth-mainnet',
  polygon: 'polygon-mainnet', matic: 'polygon-mainnet',
};

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

  // 2. On-chain path — the earliest inbound transfer of this token to a wallet the
  //    tenant controls, priced at that timestamp. Covers on-chain airdrops and NFTs
  //    that never touched a CSV import. Best-effort and non-fatal.
  try {
    const chain = String(token.chain ?? '').toLowerCase();
    const alchemyChain = CHAIN_MAP[chain];
    const contract = (token.contract ?? '').toLowerCase();
    if (!alchemyChain || !contract) return null;
    if (!process.env.ALCHEMY_API_KEY) return null;

    const db = await getDb();
    const wres = await db.execute({
      sql: `SELECT DISTINCT LOWER(address) AS address FROM wallets WHERE tenant_id = ? AND address LIKE '0x%'`,
      args: [tenantId],
    });
    const addresses = (wres.rows as unknown as { address: string }[]).map((r) => r.address).filter(Boolean);
    if (!addresses.length) return null;

    const isNft = !!token.tokenId;
    const categories = isNft ? ['erc721', 'erc1155'] : ['erc20'];

    // Earliest inbound transfer to any owned wallet.
    let best: { ts: string; amount: number } | null = null;
    for (const addr of addresses.slice(0, 12)) {
      const { getAssetTransfers } = await import('./alchemy');
      const res = await getAssetTransfers(alchemyChain, {
        fromBlock: '0x0', toAddress: addr, contractAddresses: [contract],
        category: categories, order: 'asc', maxCount: '0x1',
        withMetadata: true, excludeZeroValue: !isNft,
      }).catch(() => null);
      const tx = res?.transfers?.[0];
      const ts = tx?.metadata?.blockTimestamp;
      if (!tx || !ts) continue;
      if (!best || ts < best.ts) best = { ts, amount: isNft ? 1 : Number(tx.value ?? 0) };
    }
    if (!best) return null;

    // FMV: fungible → amount × historical unit price (null for unlisted junk, which
    // is the honest answer — a worthless airdrop is ~$0 income). NFT cost from the
    // payment leg is a follow-up; date + quantity are captured now.
    let fmvUsd: number | null = null;
    if (!isNft && symbol && best.amount > 0) {
      const { getCoingeckoIdBySymbol, getUsdUnitPriceAtTimestampCoinGecko } = await import('./coingeckoHistorical');
      const coinId = await getCoingeckoIdBySymbol(symbol).catch(() => null);
      if (coinId) {
        const priced = await getUsdUnitPriceAtTimestampCoinGecko({ coinId, timestampUtcIso: best.ts }).catch(() => null);
        if (priced && Number.isFinite(priced.unitPriceUsd) && priced.unitPriceUsd > 0) {
          fmvUsd = best.amount * priced.unitPriceUsd;
        }
      }
    }
    return { acquiredAt: best.ts, amount: best.amount, fmvUsd, source: 'onchain' };
  } catch {
    return null;
  }
}
