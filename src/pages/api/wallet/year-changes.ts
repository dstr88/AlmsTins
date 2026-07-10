import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { loadSpamFilter } from '@/lib/tokenOverrides';

export const prerender = false;

interface YearChangesResponse {
  ok: boolean;
  walletId: string;
  walletLabel: string;
  year: number;
  startDate: string;
  endDate: string;
  holdingsDelta: { symbol: string; startQty: number; endQty: number; deltaQty: number; endValueUsd: number }[];
  netChange: { symbol: string; netQty: number }[];
  transactions: { id: string; date: string; type: string; asset: string; amount: number; usdValue: number; description: string }[];
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });

    const { tenantId } = session;
    const isFiltered = await loadSpamFilter(tenantId); // override-aware spam filter
    const walletId = url.searchParams.get('walletId');
    const yearParam = url.searchParams.get('year');

    if (!walletId || !yearParam) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing walletId or year' }), { status: 400 });
    }

    const year = Number(yearParam);
    const startDate = new Date(`${year}-01-01T00:00:00Z`).toISOString();
    const endDate = new Date(`${year}-12-31T23:59:59Z`).toISOString();

    // Verify wallet belongs to this tenant
    const walletRes = await db.execute({
      sql: 'SELECT id, label, address FROM wallets WHERE id = ? AND tenant_id = ?',
      args: [walletId, tenantId],
    }).catch(() => ({ rows: [] }));

    if (!walletRes.rows.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Wallet not found' }), { status: 404 });
    }

    const wallet = walletRes.rows[0] as { id: string; label: string; address: string };

    // 1. Get snapshot at start of year
    const startSnapshotRes = await db.execute({
      sql: `
        SELECT payload_json FROM wallet_snapshots
        WHERE wallet_id = ? AND tenant_id = ? AND captured_at < ?
        ORDER BY captured_at DESC LIMIT 1
      `,
      args: [walletId, tenantId, startDate],
    }).catch(() => ({ rows: [] }));

    const startHoldings = new Map<string, number>();
    if (startSnapshotRes.rows.length) {
      const payload = startSnapshotRes.rows[0] as { payload_json: string };
      try {
        const tokens = JSON.parse(payload.payload_json) as Array<{ symbol: string; amount: number }>;
        tokens.forEach(t => {
          if (isFiltered(t.symbol)) return;
          startHoldings.set(t.symbol, (startHoldings.get(t.symbol) ?? 0) + t.amount);
        });
      } catch {}
    }

    // 2. Get latest snapshot (end of year or today)
    const endSnapshotRes = await db.execute({
      sql: `
        SELECT payload_json FROM wallet_snapshots
        WHERE wallet_id = ? AND tenant_id = ? AND captured_at <= ?
        ORDER BY captured_at DESC LIMIT 1
      `,
      args: [walletId, tenantId, endDate],
    }).catch(() => ({ rows: [] }));

    const endHoldings = new Map<string, { qty: number; priceUsd: number }>();
    if (endSnapshotRes.rows.length) {
      const payload = endSnapshotRes.rows[0] as { payload_json: string };
      try {
        const tokens = JSON.parse(payload.payload_json) as Array<{ symbol: string; amount: number; priceUsd?: number }>;
        tokens.forEach(t => {
          if (isFiltered(t.symbol)) return;
          const existing = endHoldings.get(t.symbol) || { qty: 0, priceUsd: 0 };
          endHoldings.set(t.symbol, {
            qty: existing.qty + t.amount,
            priceUsd: t.priceUsd ?? existing.priceUsd,
          });
        });
      } catch {}
    }

    // 3. Build holdings delta
    const allSymbols = new Set([...startHoldings.keys(), ...endHoldings.keys()]);
    const holdingsDelta = Array.from(allSymbols)
      .map(symbol => {
        const startQty = startHoldings.get(symbol) ?? 0;
        const endData = endHoldings.get(symbol);
        const endQty = endData?.qty ?? 0;
        const deltaQty = endQty - startQty;
        const endValueUsd = (endData?.qty ?? 0) * (endData?.priceUsd ?? 0);

        return { symbol, startQty, endQty, deltaQty, endValueUsd };
      })
      .filter(h => h.startQty !== 0 || h.endQty !== 0)
      // Hide dust: only show tokens with >= $1 current value or held at year start
      .filter(h => h.endValueUsd >= 1 || h.startQty > 0)
      .sort((a, b) => Math.abs(b.deltaQty) - Math.abs(a.deltaQty));

    // 4. Build net change summary
    const netChange = holdingsDelta
      .filter(h => h.deltaQty !== 0)
      .map(h => ({ symbol: h.symbol, netQty: h.deltaQty }));

    // 5. Get all transactions for this wallet in the year
    const txRes = await db.execute({
      sql: `
        SELECT id, timestamp, 'receive' as type, asset_symbol, amount, usd_value, description
        FROM transactions
        WHERE wallet_id = ? AND tenant_id = ? AND direction = 'in' AND timestamp >= ? AND timestamp < ?
        UNION ALL
        SELECT id, timestamp, 'send', asset_symbol, amount, usd_value, description
        FROM transactions
        WHERE wallet_id = ? AND tenant_id = ? AND direction = 'out' AND timestamp >= ? AND timestamp < ?
        ORDER BY timestamp DESC
      `,
      args: [
        walletId, tenantId, startDate, endDate,
        walletId, tenantId, startDate, endDate,
      ],
    }).catch(() => ({ rows: [] }));

    const transactions = (txRes.rows as Array<{
      id: string;
      timestamp: string;
      type: string;
      asset_symbol: string;
      amount: number;
      usd_value: number;
      description: string;
    }>).map(tx => ({
      id: tx.id,
      date: new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      type: tx.type === 'receive' ? 'Receive' : 'Send',
      asset: tx.asset_symbol,
      amount: tx.amount,
      usdValue: tx.usd_value ?? 0,
      description: tx.description ?? '',
    }));

    const response: YearChangesResponse = {
      ok: true,
      walletId,
      walletLabel: wallet.label || wallet.address.slice(0, 12) + '…',
      year,
      startDate: new Date(startDate).toLocaleDateString('en-US'),
      endDate: new Date(endDate).toLocaleDateString('en-US'),
      holdingsDelta,
      netChange,
      transactions,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[wallet/year-changes]', error);
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), { status: 500 });
  }
};
