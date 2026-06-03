/**
 * POST /api/petro-tins/rollover
 *
 * Seeds next month's recurring entries for a budget tin.
 * Called immediately when all current-month bills are checked off,
 * so the next month's list is ready to go right away.
 * Idempotent — does nothing if next month already has entries.
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

function nextMonthStr(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return json({ ok: false }, 401);
  const { tenantId } = session;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const tinId = String(body.tinId ?? '').trim();
  if (!tinId) return json({ ok: false, error: 'tinId required' }, 400);

  // Verify tin belongs to this tenant (budget or debt)
  const tinCheck = await db.execute({
    sql: `SELECT id FROM petro_tins WHERE id = ? AND tenant_id = ? AND type IN ('budget', 'debt')`,
    args: [tinId, tenantId],
  });
  if (!tinCheck.rows.length) return json({ ok: false, error: 'Tin not found' }, 404);

  const nextMonth = nextMonthStr();

  // Already seeded?
  const existing = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM petro_tin_entries WHERE tin_id = ? AND tenant_id = ? AND entry_date LIKE ?`,
    args: [tinId, tenantId, `${nextMonth}%`],
  });
  if (Number((existing.rows[0] as any)?.cnt ?? 0) > 0) {
    return json({ ok: true, seeded: 0, message: 'Already seeded' });
  }

  // Copy is_default=1 entries from the current month
  const curMonth = new Date().toISOString().slice(0, 7);
  const templates = await db.execute({
    sql: `SELECT kind, amount, description, url FROM petro_tin_entries
          WHERE tin_id = ? AND tenant_id = ? AND is_default = 1 AND entry_date LIKE ?`,
    args: [tinId, tenantId, `${curMonth}%`],
  });

  let seeded = 0;
  for (const r of templates.rows as any[]) {
    await db.execute({
      sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, checked, is_default, url)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      args: [randomUUID(), tinId, tenantId, `${nextMonth}-01`, String(r.kind), Number(r.amount), r.description ?? null, r.url ?? null],
    });
    seeded++;
  }

  return json({ ok: true, seeded, nextMonth });
};
