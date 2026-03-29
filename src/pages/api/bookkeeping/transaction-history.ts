/**
 * GET /api/bookkeeping/transaction-history?groupId=xxx
 *
 * Returns all lifecycle events for a given asset group, ordered oldest-first.
 * Used by the TransactionDrawer to show the full history of an asset group.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

type DbRow = Record<string, unknown>;

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function toNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await requireTenantSession(request);
    const { tenantId } = session ?? {};
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    const groupId = new URL(url).searchParams.get('groupId');
    if (!groupId) return new Response('Missing groupId', { status: 400 });

    const result = await db.execute({
      sql: `SELECT
               e.id               AS id,
               e.timestamp_utc    AS timestamp_utc,
               e.direction        AS direction,
               e.amount           AS amount,
               e.native_usd       AS native_usd,
               e.tx_hash          AS tx_hash,
               e.transaction_class AS transaction_class,
               e.source_type      AS source_type
             FROM asset_lifecycle_events e
             WHERE e.tenant_id = ?
               AND e.group_id = ?
             ORDER BY e.timestamp_utc ASC`,
      args: [tenantId, groupId],
    });

    const events = (result.rows as unknown as DbRow[]).map((r) => ({
      id: toStr(r.id),
      timestamp_utc: toStr(r.timestamp_utc),
      direction: typeof r.direction === 'string' ? r.direction : null,
      amount: toNumOrNull(r.amount),
      native_usd: toNumOrNull(r.native_usd),
      tx_hash: typeof r.tx_hash === 'string' ? r.tx_hash : null,
      transaction_class: toStr(r.transaction_class),
      source_type: toStr(r.source_type),
    }));

    return new Response(JSON.stringify(events), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[transaction-history]', err);
    return new Response('Server error', { status: 500 });
  }
};
