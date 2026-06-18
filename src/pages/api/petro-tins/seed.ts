/**
 * POST /api/petro-tins/seed — load sample data for the current tenant
 * Only inserts if the tenant has no existing tins (or force=true param).
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { randomUUID } from 'crypto';

export const prerender = false;

const SAMPLE_MARKER = '__sample__';

// First of current month
function thisMonth(day: number) {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  const { tenantId } = session;

  const body = await request.json().catch(() => ({}));
  const force = body.force === true;

  // Guard: don't overwrite real data unless forced
  const existing = await db.execute({ sql: 'SELECT COUNT(*) AS cnt FROM petro_tins WHERE tenant_id = ?', args: [tenantId] });
  const count = Number((existing.rows[0] as any).cnt ?? 0);
  if (count > 0 && !force) {
    return new Response(JSON.stringify({ ok: false, error: 'Tins already exist. Pass force:true to overwrite.' }), { status: 409 });
  }

  // ── Debt tins (5 credit cards) ─────────────────────────────────────────────
  const cards = [
    { name: 'Chase Freedom',         balance: 247.83, limit: 3000, apr: 0.2499, min: 25 },
    { name: 'Capital One Quicksilver', balance: 183.41, limit: 2500, apr: 0.2999, min: 25 },
    { name: 'Citi Double Cash',       balance: 298.17, limit: 5000, apr: 0.2199, min: 25 },
    { name: 'Discover it',            balance: 156.55, limit: 2000, apr: 0.2724, min: 25 },
    { name: 'Amex Blue Cash',         balance: 289.22, limit: 6000, apr: 0.1999, min: 25 },
  ];

  // ── Budget tin ──────────────────────────────────────────────────────────────
  const budgetId = randomUUID();
  const budgetEntries = [
    { kind: 'income',  amount: 5000.00, description: 'Paycheck',                   day: 1  },
    { kind: 'income',  amount: 1500.00, description: 'Business income',             day: 3  },
    { kind: 'expense', amount: 1000.00, description: 'Rent',                        day: 2  },
    { kind: 'expense', amount: 1500.00, description: 'Crypto — placeholder',        day: 5  },
  ];

  // ── Business tin ───────────────────────────────────────────────────────────
  const bizId = randomUUID();
  const bizEntries = [
    { kind: 'income',  amount: 1500.00, description: 'Monthly revenue',             day: 3  },
    { kind: 'expense', amount: 120.00,  description: 'Software subscriptions',      day: 4  },
    { kind: 'expense', amount: 45.00,   description: 'Domain & hosting',            day: 4  },
  ];

  const tinInserts: Promise<any>[] = [];

  // Insert debt tins
  for (const card of cards) {
    const id = randomUUID();
    tinInserts.push(db.execute({
      sql: `INSERT INTO petro_tins (id, tenant_id, type, name, balance, credit_limit, apr, min_payment, notes, sort_order, updated_at)
            VALUES (?, ?, 'debt', ?, ?, ?, ?, ?, ?, 0, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
            ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, type = excluded.type, name = excluded.name, balance = excluded.balance, credit_limit = excluded.credit_limit, apr = excluded.apr, min_payment = excluded.min_payment, notes = excluded.notes, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
      args: [id, tenantId, card.name, card.balance, card.limit, card.apr, card.min, SAMPLE_MARKER],
    }));
  }

  // Insert budget tin
  tinInserts.push(db.execute({
    sql: `INSERT INTO petro_tins (id, tenant_id, type, name, notes, sort_order, updated_at)
          VALUES (?, ?, 'budget', 'Home Budget', ?, 10, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
          ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, type = excluded.type, name = excluded.name, notes = excluded.notes, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
    args: [budgetId, tenantId, SAMPLE_MARKER],
  }));

  // Insert business tin
  tinInserts.push(db.execute({
    sql: `INSERT INTO petro_tins (id, tenant_id, type, name, goal_revenue, notes, sort_order, updated_at)
          VALUES (?, ?, 'business', 'Side Business', 1500, ?, 20, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
          ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id, type = excluded.type, name = excluded.name, goal_revenue = excluded.goal_revenue, notes = excluded.notes, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
    args: [bizId, tenantId, SAMPLE_MARKER],
  }));

  await Promise.all(tinInserts);

  // Insert budget entries
  const entryInserts: Promise<any>[] = [];
  for (const e of budgetEntries) {
    entryInserts.push(db.execute({
      sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), budgetId, tenantId, thisMonth(e.day), e.kind, e.amount, e.description],
    }));
  }

  // Insert business entries
  for (const e of bizEntries) {
    entryInserts.push(db.execute({
      sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), bizId, tenantId, thisMonth(e.day), e.kind, e.amount, e.description],
    }));
  }

  await Promise.all(entryInserts);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
