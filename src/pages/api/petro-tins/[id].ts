/**
 * PATCH  /api/petro-tins/:id   — update tin fields
 * DELETE /api/petro-tins/:id   — delete tin + its entries
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const PATCH: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;
  const { id } = params;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const fields: string[] = [];
  const args: any[] = [];

  if (body.name !== undefined)        { fields.push('name = ?');         args.push(String(body.name).trim().slice(0, 100)); }
  if (body.balance !== undefined)     { fields.push('balance = ?');      args.push(body.balance); }
  if (body.creditLimit !== undefined) { fields.push('credit_limit = ?'); args.push(body.creditLimit); }
  if (body.apr !== undefined)         { fields.push('apr = ?');          args.push(body.apr); }
  if (body.minPayment !== undefined)  { fields.push('min_payment = ?');  args.push(body.minPayment); }
  if (body.goalRevenue !== undefined) { fields.push('goal_revenue = ?'); args.push(body.goalRevenue); }
  if (body.notes !== undefined)       { fields.push('notes = ?');        args.push(body.notes); }
  if (body.sortOrder !== undefined)   { fields.push('sort_order = ?');   args.push(body.sortOrder); }
  if (body.surplusMode !== undefined) { fields.push('surplus_mode = ?'); args.push(body.surplusMode); }

  if (fields.length === 0) return json({ ok: false, error: 'Nothing to update' }, 400);

  fields.push("updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
  args.push(tenantId, id);

  await db.execute({
    sql: `UPDATE petro_tins SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`,
    args,
  });

  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;
  const { id } = params;

  // Delete entries first, then the tin
  await db.execute({
    sql: `DELETE FROM petro_tin_entries WHERE tin_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  await db.execute({
    sql: `DELETE FROM petro_tins WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });

  return json({ ok: true });
};
