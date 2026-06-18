/**
 * /api/petro-tins/shared-cc
 * GET  — list shared credit card expenses for tenant
 * POST — add | delete a shared CC expense
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

async function ensureTable() {
  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_shared_cc (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    tin_id      TEXT NOT NULL,
    description TEXT NOT NULL,
    amount      REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`, args: [] });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTable();

  const res = await db.execute({
    sql: `SELECT id, tin_id, description, amount FROM petro_shared_cc
          WHERE tenant_id = ? ORDER BY created_at ASC`,
    args: [tenantId],
  });

  const items = (res.rows as any[]).map(r => ({
    id:          String(r.id),
    tinId:       String(r.tin_id),
    description: String(r.description),
    amount:      Number(r.amount),
  }));

  return json({ ok: true, items });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTable();

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }

  if (body.action === 'add') {
    const { tinId, description, amount } = body;
    if (!tinId || !description?.trim() || !amount) return json({ ok: false, error: 'Missing fields' }, 400);
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO petro_shared_cc (id, tenant_id, tin_id, description, amount) VALUES (?, ?, ?, ?, ?)`,
      args: [id, tenantId, tinId, String(description).trim(), Number(amount)],
    });
    return json({ ok: true, id });
  }

  if (body.action === 'delete') {
    await db.execute({
      sql: `DELETE FROM petro_shared_cc WHERE id = ? AND tenant_id = ?`,
      args: [body.id, tenantId],
    });
    return json({ ok: true });
  }

  if (body.action === 'update') {
    const { id, tinId, description, amount } = body;
    await db.execute({
      sql: `UPDATE petro_shared_cc SET tin_id = ?, description = ?, amount = ? WHERE id = ? AND tenant_id = ?`,
      args: [tinId, String(description).trim(), Number(amount), id, tenantId],
    });
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action' }, 400);
};
