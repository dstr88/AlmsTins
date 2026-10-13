/**
 * GET /api/bookkeeping/import-activity?asset=LTC&source=venmo
 *
 * Returns all import_transactions rows for a given asset + source,
 * ordered oldest → newest. Used by the transaction drawer to show
 * a destination-side trail (e.g. "what happened to the LTC at Venmo?").
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session ?? {};
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    const params = new URL(url).searchParams;
    const asset  = params.get('asset')?.toUpperCase().trim();
    const source = params.get('source')?.toLowerCase().trim();

    if (!asset || !source)
      return new Response('Missing asset or source', { status: 400 });

    const result = await db.execute({
      sql: `SELECT
               id,
               timestamp_utc,
               direction,
               amount,
               native_usd,
               kind,
               description,
               tx_hash
             FROM import_transactions
             WHERE tenant_id = ?
               AND UPPER(asset_symbol) = ?
               AND LOWER(source)       = ?
             ORDER BY timestamp_utc ASC`,
      args: [tenantId, asset, source],
    });

    type DbRow = Record<string, unknown>;
    const rows = (result.rows as unknown as DbRow[]).map((r) => ({
      id:            String(r.id ?? ''),
      timestamp_utc: String(r.timestamp_utc ?? ''),
      direction:     typeof r.direction === 'string' ? r.direction : null,
      amount:        typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : null,
      native_usd:    typeof r.native_usd === 'number' && Number.isFinite(r.native_usd) ? r.native_usd : null,
      kind:          typeof r.kind === 'string' ? r.kind : null,
      description:   typeof r.description === 'string' ? r.description : null,
      tx_hash:       typeof r.tx_hash === 'string' ? r.tx_hash : null,
    }));

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[import-activity]', err);
    return new Response('Server error', { status: 500 });
  }
};
