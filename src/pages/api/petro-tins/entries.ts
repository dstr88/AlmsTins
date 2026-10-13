/**
 * POST   /api/petro-tins/entries   — add an entry to a tin
 * PATCH  /api/petro-tins/entries   — toggle checked state on an entry
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
  if (isNaN(amount) || amount < 0) return json({ ok: false, error: 'Invalid amount' }, 400);

  const entryDate = String(body.entryDate ?? new Date().toISOString().slice(0, 10));

  // Verify tin belongs to this tenant
  const tinCheck = await db.execute({
    sql: `SELECT id, type, balance FROM petro_tins WHERE id = ? AND tenant_id = ?`,
    args: [tinId, tenantId],
  });
  if (!tinCheck.rows.length) return json({ ok: false, error: 'Tin not found' }, 404);

  const tin = tinCheck.rows[0] as any;
  const id = randomUUID();

  // Bills (expense/payment) always recur; income is one-time unless explicitly marked
  const isDefault = kind === 'income'
    ? (body.isDefault ? 1 : 0)
    : 1;

  await db.execute({
    sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, splits_json, is_default, url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tinId, tenantId, entryDate, kind, amount,
           body.description ?? null,
           body.splitsJson ?? null,
           isDefault,
           body.url ?? null],
  });

  // Auto-update debt tin balance on payment/charge
  if (tin.type === 'debt') {
    const currentBalance = Number(tin.balance ?? 0);
    let newBalance = currentBalance;
    if (kind === 'payment')  newBalance = Math.max(0, currentBalance - amount);
    if (kind === 'charge')   newBalance = currentBalance + amount;
    await db.execute({
      sql: `UPDATE petro_tins SET balance = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND tenant_id = ?`,
      args: [newBalance, tinId, tenantId],
    });
  }

  return json({ ok: true, id });
};

export const PATCH: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const entryId = String(body.entryId ?? '').trim();
  if (!entryId) return json({ ok: false, error: 'entryId required' }, 400);

  // Toggle checked state
  if (body.checked !== undefined) {
    await db.execute({
      sql: `UPDATE petro_tin_entries SET checked = ? WHERE id = ? AND tenant_id = ?`,
      args: [body.checked ? 1 : 0, entryId, tenantId],
    });
  }

  // Toggle isDefault on income entries
  if (body.isDefault !== undefined) {
    await db.execute({
      sql: `UPDATE petro_tin_entries SET is_default = ? WHERE id = ? AND tenant_id = ? AND kind = 'income'`,
      args: [body.isDefault ? 1 : 0, entryId, tenantId],
    });
  }

  // Update amount, description, and/or url
  if (body.amount !== undefined || body.description !== undefined || body.url !== undefined) {
    const fields: string[] = [];
    const args: any[] = [];
    if (body.amount !== undefined) { fields.push('amount = ?'); args.push(Number(body.amount)); }
    if (body.description !== undefined) { fields.push('description = ?'); args.push(String(body.description)); }
    if (body.url !== undefined) { fields.push('url = ?'); args.push(body.url || null); }
    args.push(entryId, tenantId);
    await db.execute({
      sql: `UPDATE petro_tin_entries SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
      args,
    });
  }

  return json({ ok: true });
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
