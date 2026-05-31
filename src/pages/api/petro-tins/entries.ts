/**
 * POST   /api/petro-tins/entries   — add an entry to a tin
 * DELETE /api/petro-tins/entries   — delete an entry by id
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
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tinId = String(body.tinId ?? '').trim();
  const kind  = String(body.kind  ?? '').trim();
  if (!tinId || !['payment', 'charge', 'income', 'expense'].includes(kind)) {
    return json({ ok: false, error: 'Invalid tinId or kind' }, 400);
  }

  const amount = Number(body.amount);
  if (isNaN(amount) || amount <= 0) return json({ ok: false, error: 'Invalid amount' }, 400);

  const entryDate = String(body.entryDate ?? new Date().toISOString().slice(0, 10));

  // Verify tin belongs to this tenant
  const tinCheck = await db.execute({
    sql: `SELECT id, type, balance FROM petro_tins WHERE id = ? AND tenant_id = ?`,
    args: [tinId, tenantId],
  });
  if (!tinCheck.rows.length) return json({ ok: false, error: 'Tin not found' }, 404);

  const tin = tinCheck.rows[0] as any;
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, splits_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tinId, tenantId, entryDate, kind, amount,
           body.description ?? null,
           body.splitsJson ?? null],
  });

  // Auto-update debt tin balance on payment/charge
  if (tin.type === 'debt') {
    const currentBalance = Number(tin.balance ?? 0);
    let newBalance = currentBalance;
    if (kind === 'payment')  newBalance = Math.max(0, currentBalance - amount);
    if (kind === 'charge')   newBalance = currentBalance + amount;
    await db.execute({
      sql: `UPDATE petro_tins SET balance = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      args: [newBalance, tinId, tenantId],
    });
  }

  return json({ ok: true, id });
};

export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  // Accept id from query params (BudgetTin sends ?id=...&tinId=...)
  // or fall back to JSON body for other callers
  const url = new URL(request.url);
  let entryId = url.searchParams.get('id') ?? '';
  if (!entryId) {
    let body: any = {};
    try { body = await request.json(); } catch { /* ignore */ }
    entryId = String(body.entryId ?? '').trim();
  }
  if (!entryId) return json({ ok: false, error: 'entryId required' }, 400);

  await db.execute({
    sql: `DELETE FROM petro_tin_entries WHERE id = ? AND tenant_id = ?`,
    args: [entryId, tenantId],
  });

  return json({ ok: true });
};
