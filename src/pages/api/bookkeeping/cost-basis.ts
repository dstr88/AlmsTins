/**
 * POST /api/bookkeeping/cost-basis
 *
 * Upserts a manual cost basis entry for an orphaned sell.
 * Body: { sellSourceId, quantity, pricePerToken, buyDateIso?, notes? }
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    const { tenantId } = session ?? {};
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return new Response('Invalid body', { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const sellSourceId = typeof b.sellSourceId === 'string' ? b.sellSourceId.trim() : '';
    const quantity = Number(b.quantity ?? 0);
    const pricePerToken = Number(b.pricePerToken ?? 0);
    const buyDateIso = typeof b.buyDateIso === 'string' && b.buyDateIso.trim() ? b.buyDateIso.trim() : null;
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;

    if (!sellSourceId) return new Response('Missing sellSourceId', { status: 400 });
    if (!Number.isFinite(quantity) || quantity <= 0) return new Response('Invalid quantity', { status: 400 });
    if (!Number.isFinite(pricePerToken) || pricePerToken < 0) return new Response('Invalid pricePerToken', { status: 400 });

    const now = new Date().toISOString();
    const id = randomId();

    // Attempt the upsert; if notes column doesn't exist yet, fall back without it
    try {
      await db.execute({
        sql: `INSERT INTO manual_cost_basis
                (id, tenant_id, sell_source_id, quantity, price_per_token, buy_date_iso, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (tenant_id, sell_source_id) DO UPDATE SET
                quantity        = excluded.quantity,
                price_per_token = excluded.price_per_token,
                buy_date_iso    = excluded.buy_date_iso,
                notes           = excluded.notes,
                updated_at      = excluded.updated_at`,
        args: [id, tenantId, sellSourceId, quantity, pricePerToken, buyDateIso, notes, now, now],
      });
    } catch (upsertErr: unknown) {
      // If the notes column doesn't exist yet (migration not run), retry without it
      const msg = upsertErr instanceof Error ? upsertErr.message : String(upsertErr);
      if (msg.includes('notes')) {
        await db.execute({
          sql: `INSERT INTO manual_cost_basis
                  (id, tenant_id, sell_source_id, quantity, price_per_token, buy_date_iso, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, sell_source_id) DO UPDATE SET
                  quantity        = excluded.quantity,
                  price_per_token = excluded.price_per_token,
                  buy_date_iso    = excluded.buy_date_iso,
                  updated_at      = excluded.updated_at`,
          args: [id, tenantId, sellSourceId, quantity, pricePerToken, buyDateIso, now, now],
        });
      } else {
        throw upsertErr;
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[cost-basis]', err);
    return new Response('Server error', { status: 500 });
  }
};
