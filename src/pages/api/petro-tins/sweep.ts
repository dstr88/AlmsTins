/**
 * POST /api/petro-tins/sweep
 *
 * Called when all bills for the current month are checked off.
 * Calculates the month's surplus (income − expenses) and, if the budget
 * tin's surplus_mode = 'slush', sweeps it into the tenant's slush tin.
 * Auto-creates the slush tin if one doesn't exist yet.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { randomUUID } from 'crypto';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return json({ ok: false }, 401);
  const { tenantId } = session;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tinId = String(body.tinId ?? '').trim();
  if (!tinId) return json({ ok: false, error: 'tinId required' }, 400);

  const thisMonth = new Date().toISOString().slice(0, 7);

  // Load the budget tin
  const tinRes = await db.execute({
    sql: `SELECT id, surplus_mode FROM petro_tins WHERE id = ? AND tenant_id = ? AND type = 'budget'`,
    args: [tinId, tenantId],
  });
  if (!tinRes.rows.length) return json({ ok: false, error: 'Tin not found' }, 404);
  const tin = tinRes.rows[0] as any;

  if (tin.surplus_mode !== 'slush') {
    // Nothing to sweep — just acknowledge
    return json({ ok: true, swept: false, surplus: 0 });
  }

  // Calculate this month's surplus
  const entriesRes = await db.execute({
    sql: `SELECT kind, amount FROM petro_tin_entries
          WHERE tin_id = ? AND tenant_id = ? AND entry_date LIKE ?`,
    args: [tinId, tenantId, `${thisMonth}%`],
  });

  let income = 0, expenses = 0;
  for (const r of entriesRes.rows as any[]) {
    if (r.kind === 'income')  income   += Number(r.amount);
    if (r.kind === 'expense') expenses += Number(r.amount);
  }
  const surplus = income - expenses;

  if (surplus <= 0) {
    return json({ ok: true, swept: false, surplus });
  }

  // Find or create the slush tin
  let slushRes = await db.execute({
    sql: `SELECT id FROM petro_tins WHERE tenant_id = ? AND is_slush = 1 LIMIT 1`,
    args: [tenantId],
  });

  let slushTinId: string;
  if (slushRes.rows.length) {
    slushTinId = String((slushRes.rows[0] as any).id);
  } else {
    slushTinId = randomUUID();
    await db.execute({
      sql: `INSERT INTO petro_tins (id, tenant_id, type, name, sort_order, surplus_mode, is_slush)
            VALUES (?, ?, 'budget', 'Slush Fund', 999, 'none', 1)`,
      args: [slushTinId, tenantId],
    });
  }

  // Add surplus as an income entry on the slush tin
  const label = `Surplus from ${thisMonth}`;
  await db.execute({
    sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, checked, is_default)
          VALUES (?, ?, ?, ?, 'income', ?, ?, 1, 0)`,
    args: [randomUUID(), slushTinId, tenantId, `${thisMonth}-01`, surplus, label],
  });

  return json({ ok: true, swept: true, surplus, slushTinId });
};
