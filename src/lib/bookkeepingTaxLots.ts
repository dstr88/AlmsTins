import { db } from './db';

type LifecycleEventRow = {
  asset_symbol: string;
  direction: string | null;
  amount: number | null;
  native_usd: number | null;
  timestamp_utc: string;
};

type DbRow = Record<string, unknown>;

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');
const toStringOrNull = (value: unknown) => (typeof value === 'string' ? value : value === null ? null : null);
const toNumberOrNull = (value: unknown) => (typeof value === 'number' ? value : value === null ? null : null);

const toLifecycleEventRow = (row: unknown): LifecycleEventRow | null => {
  if (!row || typeof row !== 'object') return null;
  const r = row as DbRow;
  return {
    asset_symbol: toStringOrEmpty(r.asset_symbol),
    direction: toStringOrNull(r.direction),
    amount: toNumberOrNull(r.amount),
    native_usd: toNumberOrNull(r.native_usd),
    timestamp_utc: toStringOrEmpty(r.timestamp_utc),
  };
};

const toLifecycleEventRows = (rows: unknown): LifecycleEventRow[] => {
  if (!Array.isArray(rows)) return [];
  const out: LifecycleEventRow[] = [];
  for (const row of rows) {
    const mapped = toLifecycleEventRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
};

type TaxLot = {
  asset: string;
  amount: number;
  buyDate: string | null;
  sellDate: string;
  buyUsd?: number | null;
  sellUsd?: number | null;
};

type TaxLotsByYear = Record<string, TaxLot[]>;

export async function buildTaxLotsByYear(tenantId: string): Promise<{
  taxLotsByYear: TaxLotsByYear;
  taxYears: string[];
}> {
  let taxLotsByYear: TaxLotsByYear = {};

  try {
    const result = await db.execute({
      sql: `SELECT g.asset_symbol AS asset_symbol,
        e.direction AS direction,
        e.amount AS amount,
        e.native_usd AS native_usd,
        e.timestamp_utc AS timestamp_utc
        FROM asset_lifecycle_events e
        LEFT JOIN asset_lifecycle_groups g
          ON g.id = e.group_id AND g.tenant_id = e.tenant_id
        WHERE e.tenant_id = ?
        ORDER BY e.timestamp_utc ASC`,
      args: [tenantId],
    });

    const rows = toLifecycleEventRows(result.rows);
    const lotsByAsset = new Map<string, Array<{ amount: number; timestamp: string; costUsd?: number | null }>>();
    const sales: TaxLot[] = [];

    for (const row of rows) {
      const asset = String(row.asset_symbol ?? '').toUpperCase();
      if (!asset) continue;
      const direction = row.direction ? String(row.direction) : null;
      const amount = Math.abs(Number(row.amount ?? 0));
      if (!amount) continue;

      if (direction === 'in') {
        const list = lotsByAsset.get(asset) ?? [];
        list.push({
          amount,
          timestamp: String(row.timestamp_utc),
          costUsd: row.native_usd ?? null,
        });
        lotsByAsset.set(asset, list);
        continue;
      }

      if (direction === 'out') {
        let remaining = amount;
        const list = lotsByAsset.get(asset) ?? [];
        const sellUsd = row.native_usd ?? null;
        while (remaining > 0) {
          const lot = list[0];
          if (!lot) {
            sales.push({
              asset,
              amount: remaining,
              buyDate: null,
              sellDate: String(row.timestamp_utc),
              buyUsd: null,
              sellUsd,
            });
            break;
          }
          const take = Math.min(remaining, lot.amount);
          const buyPortion = lot.costUsd ? (take / lot.amount) * lot.costUsd : null;
          const sellPortion = sellUsd ? (take / amount) * sellUsd : null;
          sales.push({
            asset,
            amount: take,
            buyDate: lot.timestamp,
            sellDate: String(row.timestamp_utc),
            buyUsd: buyPortion,
            sellUsd: sellPortion,
          });
          lot.amount -= take;
          if (lot.amount <= 0) {
            list.shift();
          }
          remaining -= take;
        }
        lotsByAsset.set(asset, list);
      }
    }

    taxLotsByYear = sales.reduce<TaxLotsByYear>((acc, sale) => {
      const year = new Date(sale.sellDate).getUTCFullYear();
      const key = Number.isFinite(year) ? String(year) : 'Unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(sale);
      return acc;
    }, {});
  } catch (error) {
    console.error('[bookkeeping] Failed to build tax lots', error);
    taxLotsByYear = {};
  }

  const taxYears = Object.keys(taxLotsByYear).sort((a, b) => Number(b) - Number(a));

  return { taxLotsByYear, taxYears };
}
