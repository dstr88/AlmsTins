/**
 * GET /api/bookkeeping/transaction-history?groupId=xxx
 *
 * Returns all lifecycle events for a given asset group, ordered oldest-first.
 * Joins wallet_transactions to include from/to addresses and chain,
 * and joins wallets to resolve the user's wallet label.
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

function toStrOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
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
               e.id                AS id,
               e.timestamp_utc     AS timestamp_utc,
               e.direction         AS direction,
               e.amount            AS amount,
               e.native_usd        AS native_usd,
               e.tx_hash           AS tx_hash,
               e.transaction_class AS transaction_class,
               e.source_type       AS source_type,
               -- On-chain address fields from the transactions table
               t.from_address      AS from_address,
               t.to_address        AS to_address,
               t.chain             AS chain,
               -- Wallet label: match the user's wallet address to either side
               w.label             AS wallet_label,
               w.address           AS wallet_address,
               -- Resolved labels: personal first, fall back to global
               COALESCE(pal_from.label, gal_from.label) AS from_label,
               COALESCE(pal_to.label,   gal_to.label)   AS to_label
             FROM asset_lifecycle_events e
             LEFT JOIN transactions t
               ON e.source_id = t.id
               AND e.source_type NOT IN ('import')
             LEFT JOIN wallets w
               ON w.tenant_id = e.tenant_id
               AND (
                 LOWER(w.address) = LOWER(t.from_address)
                 OR LOWER(w.address) = LOWER(t.to_address)
               )
             -- Personal label for from_address
             LEFT JOIN address_labels pal_from
               ON pal_from.tenant_id = e.tenant_id
               AND LOWER(pal_from.address) = LOWER(t.from_address)
             -- Global label for from_address
             LEFT JOIN global_address_labels gal_from
               ON LOWER(gal_from.address) = LOWER(t.from_address)
             -- Personal label for to_address
             LEFT JOIN address_labels pal_to
               ON pal_to.tenant_id = e.tenant_id
               AND LOWER(pal_to.address) = LOWER(t.to_address)
             -- Global label for to_address
             LEFT JOIN global_address_labels gal_to
               ON LOWER(gal_to.address) = LOWER(t.to_address)
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
      from_address: toStrOrNull(r.from_address),
      to_address: toStrOrNull(r.to_address),
      chain: toStrOrNull(r.chain),
      wallet_label: toStrOrNull(r.wallet_label),
      wallet_address: toStrOrNull(r.wallet_address),
      from_label: toStrOrNull(r.from_label),
      to_label: toStrOrNull(r.to_label),
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
