/**
 * GET  /api/dirty-tins        — list all tins + recent entries for tenant
 * POST /api/dirty-tins        — create a new tin
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { randomUUID } from 'crypto';

export const prerender = false;

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS dirty_tins (
    id           TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    type         TEXT NOT NULL,
    name         TEXT NOT NULL,
    balance      REAL,
    credit_limit REAL,
    apr          REAL,
    min_payment  REAL,
    goal_revenue REAL,
    notes        TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const ENSURE_ENTRIES_SQL = `
  CREATE TABLE IF NOT EXISTS dirty_tin_entries (
    id          TEXT NOT NULL PRIMARY KEY,
    tin_id      TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    entry_date  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    amount      REAL NOT NULL,
    description TEXT,
    splits_json TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

let tablesEnsured = false;
async function ensureTables() {
  if (tablesEnsured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_ENTRIES_SQL, args: [] });
  tablesEnsured = true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTables();

  const tinsRes = await db.execute({
    sql: `SELECT id, type, name, balance, credit_limit, apr, min_payment, goal_revenue, notes, sort_order, created_at, updated_at
          FROM dirty_tins
          WHERE tenant_id = ?
          ORDER BY sort_order ASC, created_at ASC`,
    args: [tenantId],
  });

  const tins = tinsRes.rows.map((r: any) => ({
    id:          String(r.id),
    type:        String(r.type),
    name:        String(r.name),
    balance:     r.balance != null ? Number(r.balance) : null,
    creditLimit: r.credit_limit != null ? Number(r.credit_limit) : null,
    apr:         r.apr != null ? Number(r.apr) : null,
    minPayment:  r.min_payment != null ? Number(r.min_payment) : null,
    goalRevenue: r.goal_revenue != null ? Number(r.goal_revenue) : null,
    notes:       r.notes ? String(r.notes) : null,
    sortOrder:   Number(r.sort_order),
    createdAt:   String(r.created_at),
    updatedAt:   String(r.updated_at),
  }));

  // Load all entries for this tenant, grouped by tin
  const entriesRes = await db.execute({
    sql: `SELECT id, tin_id, entry_date, kind, amount, description, splits_json, created_at
          FROM dirty_tin_entries
          WHERE tenant_id = ?
          ORDER BY entry_date DESC, created_at DESC`,
    args: [tenantId],
  });

  const entriesByTin: Record<string, any[]> = {};
  for (const r of entriesRes.rows as any[]) {
    const tinId = String(r.tin_id);
    if (!entriesByTin[tinId]) entriesByTin[tinId] = [];
    entriesByTin[tinId].push({
      id:          String(r.id),
      entryDate:   String(r.entry_date),
      kind:        String(r.kind),
      amount:      Number(r.amount),
      description: r.description ? String(r.description) : null,
      splitsJson:  r.splits_json ? String(r.splits_json) : null,
      createdAt:   String(r.created_at),
    });
  }

  const result = tins.map(t => ({ ...t, entries: entriesByTin[t.id] ?? [] }));
  return json({ ok: true, tins: result });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTables();

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const type = String(body.type ?? '');
  if (!['debt', 'budget', 'business'].includes(type)) {
    return json({ ok: false, error: 'Invalid type' }, 400);
  }
  const name = String(body.name ?? '').trim().slice(0, 100);
  if (!name) return json({ ok: false, error: 'Name required' }, 400);

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO dirty_tins (id, tenant_id, type, name, balance, credit_limit, apr, min_payment, goal_revenue, notes, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, tenantId, type, name,
      body.balance ?? null,
      body.creditLimit ?? null,
      body.apr ?? null,
      body.minPayment ?? null,
      body.goalRevenue ?? null,
      body.notes ?? null,
      body.sortOrder ?? 0,
    ],
  });

  return json({ ok: true, id });
};
