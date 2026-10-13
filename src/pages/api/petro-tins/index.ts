/**
 * GET  /api/petro-tins        — list all tins + entries for tenant, auto-seeds current month
 * POST /api/petro-tins        — create a new tin
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getPetroSubscription } from '@/lib/petroSubscription';
import { randomUUID } from 'crypto';

const FREE_LIMITS: Record<string, number> = { debt: 1, budget: 1, business: 0 };

export const prerender = false;

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS petro_tins (
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
    created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

const ENSURE_ENTRIES_SQL = `
  CREATE TABLE IF NOT EXISTS petro_tin_entries (
    id          TEXT NOT NULL PRIMARY KEY,
    tin_id      TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    entry_date  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    amount      REAL NOT NULL,
    description TEXT,
    splits_json TEXT,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

let tablesEnsured = false;
async function ensureTables() {
  if (tablesEnsured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_ENTRIES_SQL, args: [] });
  // Safe migrations — .catch(() => {}) means they no-op if column already exists
  await db.execute({ sql: `ALTER TABLE petro_tin_entries ADD COLUMN checked    INTEGER NOT NULL DEFAULT 0`, args: [] }).catch(() => {});
  await db.execute({ sql: `ALTER TABLE petro_tin_entries ADD COLUMN is_default INTEGER NOT NULL DEFAULT 1`, args: [] }).catch(() => {});
  await db.execute({ sql: `ALTER TABLE petro_tin_entries ADD COLUMN url         TEXT`, args: [] }).catch(() => {});
  await db.execute({ sql: `ALTER TABLE petro_tins        ADD COLUMN surplus_mode TEXT NOT NULL DEFAULT 'none'`, args: [] }).catch(() => {});
  await db.execute({ sql: `ALTER TABLE petro_tins        ADD COLUMN is_slush    INTEGER NOT NULL DEFAULT 0`, args: [] }).catch(() => {});
  // Income entries added before this migration default is_default=1; fix them to 0
  await db.execute({ sql: `UPDATE petro_tin_entries SET is_default = 0 WHERE kind = 'income' AND is_default = 1`, args: [] }).catch(() => {});
  tablesEnsured = true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Return YYYY-MM for a given offset from today (0 = this month, -1 = last month). */
function monthStr(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7);
}

/**
 * Auto-seed current month's recurring entries for a budget tin.
 * Finds the most recent prior month that has is_default=1 entries and copies them
 * with the current month's date and checked=0. Idempotent — skips if current month
 * already has entries.
 */
async function seedMonthIfNeeded(tinId: string, tenantId: string) {
  const thisMonth = monthStr(0);

  // Already have entries this month?
  const existing = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM petro_tin_entries WHERE tin_id = ? AND tenant_id = ? AND entry_date LIKE ?`,
    args: [tinId, tenantId, `${thisMonth}%`],
  });
  if (Number((existing.rows[0] as any)?.cnt ?? 0) > 0) return;

  // Find the most recent month with is_default=1 entries
  const sourceRes = await db.execute({
    sql: `SELECT entry_date FROM petro_tin_entries
          WHERE tin_id = ? AND tenant_id = ? AND is_default = 1
          ORDER BY entry_date DESC LIMIT 1`,
    args: [tinId, tenantId],
  });
  if (!sourceRes.rows.length) return;

  const sourceMonth = String((sourceRes.rows[0] as any).entry_date).slice(0, 7);
  if (sourceMonth === thisMonth) return; // safety: don't copy from same month

  const templateEntries = await db.execute({
    sql: `SELECT kind, amount, description FROM petro_tin_entries
          WHERE tin_id = ? AND tenant_id = ? AND is_default = 1 AND entry_date LIKE ?`,
    args: [tinId, tenantId, `${sourceMonth}%`],
  });

  for (const r of templateEntries.rows as any[]) {
    await db.execute({
      sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, checked, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      args: [randomUUID(), tinId, tenantId, `${thisMonth}-01`, String(r.kind), Number(r.amount), r.description ?? null],
    });
  }
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTables();

  const tinsRes = await db.execute({
    sql: `SELECT id, type, name, balance, credit_limit, apr, min_payment, goal_revenue,
                 notes, sort_order, surplus_mode, is_slush, created_at, updated_at
          FROM petro_tins
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
    surplusMode: String(r.surplus_mode ?? 'none'),
    isSlush:     Number(r.is_slush ?? 0) === 1,
    createdAt:   String(r.created_at),
    updatedAt:   String(r.updated_at),
  }));

  // Auto-seed current month for budget tins (non-slush)
  for (const tin of tins) {
    if (tin.type === 'budget' && !tin.isSlush) {
      await seedMonthIfNeeded(tin.id, tenantId);
    }
  }

  // Load all entries for this tenant, grouped by tin
  const entriesRes = await db.execute({
    sql: `SELECT id, tin_id, entry_date, kind, amount, description, splits_json, checked, is_default, url, created_at
          FROM petro_tin_entries
          WHERE tenant_id = ?
          ORDER BY entry_date ASC, created_at ASC`,
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
      checked:     Number(r.checked ?? 0) === 1,
      isDefault:   Number(r.is_default ?? 1) === 1,
      url:         r.url ? String(r.url) : null,
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
  if (!['debt', 'budget', 'business', 'slush'].includes(type)) {
    return json({ ok: false, error: 'Invalid type' }, 400);
  }
  const name = String(body.name ?? '').trim().slice(0, 100);
  if (!name) return json({ ok: false, error: 'Name required' }, 400);

  // Free-tier limits (slush tins don't count against the limit)
  if (type !== 'slush') {
    const tier = await getPetroSubscription(tenantId);
    const checkType = type === 'slush' ? 'budget' : type;
    if (tier === 'free') {
      const limit = FREE_LIMITS[checkType] ?? 0;
      if (limit === 0) {
        return json({ ok: false, error: 'upgrade_required', upgradeUrl: '/dashboard/petro-tins/upgrade' }, 403);
      }
      const countRes = await db.execute({
        sql: `SELECT COUNT(*) as cnt FROM petro_tins WHERE tenant_id = ? AND type = ? AND is_slush = 0`,
        args: [tenantId, type],
      });
      const count = Number((countRes.rows[0] as any)?.cnt ?? 0);
      if (count >= limit) {
        return json({ ok: false, error: 'upgrade_required', upgradeUrl: '/dashboard/petro-tins/upgrade' }, 403);
      }
    }
  }

  const id = randomUUID();
  const isSlush = body.isSlush ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO petro_tins (id, tenant_id, type, name, balance, credit_limit, apr, min_payment,
                                  goal_revenue, notes, sort_order, surplus_mode, is_slush)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, tenantId, type === 'slush' ? 'budget' : type, name,
      body.balance ?? null,
      body.creditLimit ?? null,
      body.apr ?? null,
      body.minPayment ?? null,
      body.goalRevenue ?? null,
      body.notes ?? null,
      body.sortOrder ?? 0,
      body.surplusMode ?? 'none',
      isSlush,
    ],
  });

  return json({ ok: true, id });
};
