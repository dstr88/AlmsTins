/**
 * /api/petro-tins/splits
 * GET  — load all splits tins for tenant (with people, bills, assignments, payments)
 * POST — create a splits tin | add person | add bill | add payment | delete any
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

function monthStr(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7);
}

// ── Ensure tables ─────────────────────────────────────────────────────────────

let ensured = false;
async function ensureTables() {
  if (ensured) return;

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits (
    id              TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    interest_rate   REAL NOT NULL DEFAULT 0,
    budget_tin_id   TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`, args: [] });

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits_people (
    id          TEXT NOT NULL PRIMARY KEY,
    splits_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    is_owner    INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`, args: [] });

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits_bills (
    id          TEXT NOT NULL PRIMARY KEY,
    splits_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    amount      REAL NOT NULL DEFAULT 0,
    is_default  INTEGER NOT NULL DEFAULT 1,
    no_budget   INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`, args: [] });

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits_assignments (
    id          TEXT NOT NULL PRIMARY KEY,
    bill_id     TEXT NOT NULL,
    person_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'flat',
    value       REAL NOT NULL DEFAULT 0,
    UNIQUE(bill_id, person_id)
  )`, args: [] });

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits_payments (
    id              TEXT NOT NULL PRIMARY KEY,
    splits_id       TEXT NOT NULL,
    person_id       TEXT NOT NULL,
    bill_id         TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    month           TEXT NOT NULL,
    amount          REAL NOT NULL,
    paid_date       TEXT NOT NULL,
    budget_entry_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )`, args: [] });

  await db.execute({ sql: `CREATE TABLE IF NOT EXISTS petro_splits_carried (
    id          TEXT NOT NULL PRIMARY KEY,
    splits_id   TEXT NOT NULL,
    person_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    month       TEXT NOT NULL,
    balance     REAL NOT NULL DEFAULT 0,
    UNIQUE(splits_id, person_id, month)
  )`, args: [] });

  // Add no_budget column to existing tables (safe on re-run)
  await db.execute({ sql: `ALTER TABLE petro_splits_bills ADD COLUMN no_budget INTEGER NOT NULL DEFAULT 0`, args: [] }).catch(() => {});
  // Store line-item breakdown for audit trail
  await db.execute({ sql: `ALTER TABLE petro_splits_assignments ADD COLUMN breakdown TEXT`, args: [] }).catch(() => {});

  ensured = true;
}

// ── Ownership guards (tenant isolation) ───────────────────────────────────────
// Child rows (people/bills/assignments/payments) hang off a petro_splits group or a
// petro_tins budget tin, and their parent ids arrive in the request body. Before any
// write we confirm the parent belongs to the SESSION tenant — otherwise a caller could
// read or overwrite another tenant's splits data by guessing its UUIDs.
const notFound = () => json({ ok: false, error: 'Not found' }, 404);
async function ownsSplits(tenantId: string, splitsId: unknown): Promise<boolean> {
  if (!splitsId) return false;
  const r = await db.execute({ sql: `SELECT 1 FROM petro_splits WHERE id = ? AND tenant_id = ? LIMIT 1`, args: [String(splitsId), tenantId] });
  return r.rows.length > 0;
}
async function ownsBill(tenantId: string, billId: unknown): Promise<boolean> {
  if (!billId) return false;
  const r = await db.execute({ sql: `SELECT 1 FROM petro_splits_bills WHERE id = ? AND tenant_id = ? LIMIT 1`, args: [String(billId), tenantId] });
  return r.rows.length > 0;
}
async function ownsPerson(tenantId: string, personId: unknown): Promise<boolean> {
  if (!personId) return false;
  const r = await db.execute({ sql: `SELECT 1 FROM petro_splits_people WHERE id = ? AND tenant_id = ? LIMIT 1`, args: [String(personId), tenantId] });
  return r.rows.length > 0;
}
async function ownsBudgetTin(tenantId: string, tinId: unknown): Promise<boolean> {
  if (!tinId) return false;
  const r = await db.execute({ sql: `SELECT 1 FROM petro_tins WHERE id = ? AND tenant_id = ? LIMIT 1`, args: [String(tinId), tenantId] });
  return r.rows.length > 0;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTables();

  const splitsRes = await db.execute({
    sql: `SELECT id, name, interest_rate, budget_tin_id FROM petro_splits WHERE tenant_id = ? ORDER BY created_at ASC`,
    args: [tenantId],
  });

  const splits = [];
  const thisMonth = monthStr(0);
  const lastMonth = monthStr(-1);

  for (const s of splitsRes.rows as any[]) {
    const splitsId = String(s.id);

    const [peopleRes, billsRes, assignRes, payRes, carriedRes] = await Promise.all([
      db.execute({ sql: `SELECT id, name, is_owner, sort_order FROM petro_splits_people WHERE splits_id = ? AND tenant_id = ? ORDER BY sort_order ASC, created_at ASC`, args: [splitsId, tenantId] }),
      db.execute({ sql: `SELECT id, name, amount, is_default, no_budget, sort_order FROM petro_splits_bills WHERE splits_id = ? AND tenant_id = ? ORDER BY sort_order ASC, created_at ASC`, args: [splitsId, tenantId] }),
      db.execute({ sql: `SELECT id, bill_id, person_id, type, value, breakdown FROM petro_splits_assignments WHERE tenant_id = ?`, args: [tenantId] }),
      db.execute({ sql: `SELECT id, person_id, bill_id, month, amount, paid_date, budget_entry_id FROM petro_splits_payments WHERE splits_id = ? AND tenant_id = ? AND month >= ? ORDER BY paid_date ASC`, args: [splitsId, tenantId, lastMonth] }),
      db.execute({ sql: `SELECT person_id, balance FROM petro_splits_carried WHERE splits_id = ? AND tenant_id = ? AND month = ?`, args: [splitsId, tenantId, lastMonth] }),
    ]);

    const assignmentsByBill: Record<string, any[]> = {};
    for (const a of assignRes.rows as any[]) {
      const bid = String(a.bill_id);
      if (!assignmentsByBill[bid]) assignmentsByBill[bid] = [];
      assignmentsByBill[bid].push({ id: String(a.id), billId: bid, personId: String(a.person_id), type: String(a.type), value: Number(a.value), breakdown: a.breakdown ? String(a.breakdown) : null });
    }

    const bills = (billsRes.rows as any[]).map(b => ({
      id: String(b.id),
      splitsId,
      name: String(b.name),
      amount: Number(b.amount),
      isDefault: Number(b.is_default) === 1,
      noBudget: Number(b.no_budget) === 1,
      sortOrder: Number(b.sort_order),
      assignments: assignmentsByBill[String(b.id)] ?? [],
    }));

    const carriedBalances: Record<string, number> = {};
    for (const c of carriedRes.rows as any[]) {
      carriedBalances[String(c.person_id)] = Number(c.balance);
    }

    splits.push({
      id: splitsId,
      tenantId,
      name: String(s.name),
      interestRate: Number(s.interest_rate ?? 0),
      budgetTinId: s.budget_tin_id ? String(s.budget_tin_id) : null,
      people: (peopleRes.rows as any[]).map(p => ({
        id: String(p.id), splitsId, name: String(p.name),
        isOwner: Number(p.is_owner) === 1, sortOrder: Number(p.sort_order),
      })),
      bills,
      payments: (payRes.rows as any[]).map(p => ({
        id: String(p.id), personId: String(p.person_id), billId: String(p.bill_id),
        month: String(p.month), amount: Number(p.amount), paidDate: String(p.paid_date),
        budgetEntryId: p.budget_entry_id ? String(p.budget_entry_id) : null,
      })),
      carriedBalances,
    });
  }

  return json({ ok: true, splits });
};

// ── POST ──────────────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return json({ ok: false }, 401);
  const { tenantId } = session;

  await ensureTables();

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const action = String(body.action ?? '');

  // ── Create splits tin ──────────────────────────────────────────────────────
  if (action === 'create_splits') {
    const name = String(body.name ?? '').trim();
    if (!name) return json({ ok: false, error: 'Name required' }, 400);
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO petro_splits (id, tenant_id, name, interest_rate, budget_tin_id) VALUES (?, ?, ?, ?, ?)`,
      args: [id, tenantId, name, body.interestRate ?? 0, body.budgetTinId ?? null],
    });
    return json({ ok: true, id });
  }

  // ── Update splits tin ──────────────────────────────────────────────────────
  if (action === 'update_splits') {
    const { splitsId, name, interestRate, budgetTinId } = body;
    await db.execute({
      sql: `UPDATE petro_splits SET name = ?, interest_rate = ?, budget_tin_id = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND tenant_id = ?`,
      args: [name, interestRate ?? 0, budgetTinId ?? null, splitsId, tenantId],
    });
    return json({ ok: true });
  }

  // ── Delete splits tin ──────────────────────────────────────────────────────
  if (action === 'delete_splits') {
    const { splitsId } = body;
    if (!(await ownsSplits(tenantId, splitsId))) return notFound();
    // cascade
    await db.execute({ sql: `DELETE FROM petro_splits_payments WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_carried WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    const billsRes = await db.execute({ sql: `SELECT id FROM petro_splits_bills WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    for (const b of billsRes.rows as any[]) {
      await db.execute({ sql: `DELETE FROM petro_splits_assignments WHERE bill_id = ? AND tenant_id = ?`, args: [String(b.id), tenantId] });
    }
    await db.execute({ sql: `DELETE FROM petro_splits_bills WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_people WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits WHERE id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    return json({ ok: true });
  }

  // ── Add person ─────────────────────────────────────────────────────────────
  if (action === 'add_person') {
    const { splitsId, name, isOwner } = body;
    if (!name?.trim()) return json({ ok: false, error: 'Name required' }, 400);
    if (!(await ownsSplits(tenantId, splitsId))) return notFound();
    const id = randomUUID();
    const countRes = await db.execute({ sql: `SELECT COUNT(*) as cnt FROM petro_splits_people WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    const sortOrder = Number((countRes.rows[0] as any)?.cnt ?? 0);
    await db.execute({
      sql: `INSERT INTO petro_splits_people (id, splits_id, tenant_id, name, is_owner, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, splitsId, tenantId, String(name).trim(), isOwner ? 1 : 0, sortOrder],
    });
    return json({ ok: true, id });
  }

  // ── Delete person ──────────────────────────────────────────────────────────
  if (action === 'delete_person') {
    const { personId } = body;
    await db.execute({ sql: `DELETE FROM petro_splits_assignments WHERE person_id = ? AND tenant_id = ?`, args: [personId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_payments WHERE person_id = ? AND tenant_id = ?`, args: [personId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_carried WHERE person_id = ? AND tenant_id = ?`, args: [personId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_people WHERE id = ? AND tenant_id = ?`, args: [personId, tenantId] });
    return json({ ok: true });
  }

  // ── Add bill ───────────────────────────────────────────────────────────────
  if (action === 'add_bill') {
    const { splitsId, name, amount, isDefault, noBudget } = body;
    if (!name?.trim()) return json({ ok: false, error: 'Name required' }, 400);
    if (!(await ownsSplits(tenantId, splitsId))) return notFound();
    const id = randomUUID();
    const countRes = await db.execute({ sql: `SELECT COUNT(*) as cnt FROM petro_splits_bills WHERE splits_id = ? AND tenant_id = ?`, args: [splitsId, tenantId] });
    const sortOrder = Number((countRes.rows[0] as any)?.cnt ?? 0);
    await db.execute({
      sql: `INSERT INTO petro_splits_bills (id, splits_id, tenant_id, name, amount, is_default, no_budget, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, splitsId, tenantId, String(name).trim(), Number(amount ?? 0), isDefault !== false ? 1 : 0, noBudget ? 1 : 0, sortOrder],
    });
    return json({ ok: true, id });
  }

  // ── Update bill ────────────────────────────────────────────────────────────
  if (action === 'update_bill') {
    const { billId, name, amount } = body;
    await db.execute({
      sql: `UPDATE petro_splits_bills SET name = ?, amount = ? WHERE id = ? AND tenant_id = ?`,
      args: [name, Number(amount ?? 0), billId, tenantId],
    });
    return json({ ok: true });
  }

  // ── Delete bill ────────────────────────────────────────────────────────────
  if (action === 'delete_bill') {
    const { billId } = body;
    await db.execute({ sql: `DELETE FROM petro_splits_assignments WHERE bill_id = ? AND tenant_id = ?`, args: [billId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_payments WHERE bill_id = ? AND tenant_id = ?`, args: [billId, tenantId] });
    await db.execute({ sql: `DELETE FROM petro_splits_bills WHERE id = ? AND tenant_id = ?`, args: [billId, tenantId] });
    return json({ ok: true });
  }

  // ── Set assignment ─────────────────────────────────────────────────────────
  if (action === 'set_assignment') {
    const { billId, personId, type, value, breakdown } = body;
    if (!(await ownsBill(tenantId, billId)) || !(await ownsPerson(tenantId, personId))) return notFound();
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO petro_splits_assignments (id, bill_id, person_id, tenant_id, type, value, breakdown)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bill_id, person_id) DO UPDATE SET type = excluded.type, value = excluded.value, breakdown = excluded.breakdown`,
      args: [id, billId, personId, tenantId, type ?? 'flat', Number(value ?? 0), breakdown ?? null],
    });
    return json({ ok: true });
  }

  // ── Record payment ─────────────────────────────────────────────────────────
  if (action === 'add_payment') {
    const { splitsId, personId, billId, amount, paidDate, budgetTinId } = body;
    if (!(await ownsSplits(tenantId, splitsId)) || !(await ownsBill(tenantId, billId)) || !(await ownsPerson(tenantId, personId))) return notFound();
    const thisMonth = monthStr(0);
    const month = String(paidDate ?? '').slice(0, 7) || thisMonth;
    const id = randomUUID();

    // If a budget tin is linked, payer is NOT the owner, and bill is not marked no_budget,
    // auto-post income entry to the budget tin. The budget tin must also be the tenant's
    // (it's a body-supplied id) or we'd write the payer's name into another tenant's tin.
    const billRes = await db.execute({ sql: `SELECT no_budget FROM petro_splits_bills WHERE id = ? AND tenant_id = ?`, args: [billId, tenantId] });
    const billNoBudget = Number((billRes.rows[0] as any)?.no_budget ?? 0) === 1;

    let budgetEntryId: string | null = null;
    if (budgetTinId && !billNoBudget && (await ownsBudgetTin(tenantId, budgetTinId))) {
      const personRes = await db.execute({ sql: `SELECT name, is_owner FROM petro_splits_people WHERE id = ? AND tenant_id = ?`, args: [personId, tenantId] });
      const person = personRes.rows[0] as any;
      if (person && !person.is_owner) {
        budgetEntryId = randomUUID();
        await db.execute({
          sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description, checked, is_default)
                VALUES (?, ?, ?, ?, 'income', ?, ?, 1, 0)`,
          args: [budgetEntryId, budgetTinId, tenantId, paidDate ?? new Date().toISOString().slice(0, 10),
                 Number(amount), `${String(person.name)} — splits payment`],
        });
      }
    }

    await db.execute({
      sql: `INSERT INTO petro_splits_payments (id, splits_id, person_id, bill_id, tenant_id, month, amount, paid_date, budget_entry_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, splitsId, personId, billId, tenantId, month, Number(amount), paidDate ?? new Date().toISOString().slice(0, 10), budgetEntryId],
    });

    return json({ ok: true, id, budgetEntryId });
  }

  // ── Delete payment ─────────────────────────────────────────────────────────
  if (action === 'delete_payment') {
    const { paymentId } = body;
    // Also remove the linked budget entry if it exists
    const pmtRes = await db.execute({ sql: `SELECT budget_entry_id FROM petro_splits_payments WHERE id = ? AND tenant_id = ?`, args: [paymentId, tenantId] });
    const budgetEntryId = (pmtRes.rows[0] as any)?.budget_entry_id;
    if (budgetEntryId) {
      await db.execute({ sql: `DELETE FROM petro_tin_entries WHERE id = ? AND tenant_id = ?`, args: [budgetEntryId, tenantId] });
    }
    await db.execute({ sql: `DELETE FROM petro_splits_payments WHERE id = ? AND tenant_id = ?`, args: [paymentId, tenantId] });
    return json({ ok: true });
  }

  // ── Carry over balance at month end ───────────────────────────────────────
  if (action === 'save_carried') {
    const { splitsId, personId, month, balance, interestRate } = body;
    if (!(await ownsSplits(tenantId, splitsId)) || !(await ownsPerson(tenantId, personId))) return notFound();
    const interest = Number(balance ?? 0) * (Number(interestRate ?? 0) / 100);
    const finalBalance = Number(balance ?? 0) + interest;
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO petro_splits_carried (id, splits_id, person_id, tenant_id, month, balance)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(splits_id, person_id, month) DO UPDATE SET balance = excluded.balance`,
      args: [id, splitsId, personId, tenantId, month, finalBalance],
    });
    return json({ ok: true, finalBalance });
  }

  return json({ ok: false, error: 'Unknown action' }, 400);
};
