/**
 * /api/merchant/destinations
 *
 * A merchant's registered payment "destinations of record" — the ground truth a
 * scan is checked against (anti-MITM merchant self-verify, Phase 1).
 * GET    — list this tenant's destinations
 * POST   — register/update one ({ kind?, value, label?, chain?, monitor? })
 * DELETE — remove by ?id=
 *
 * Owner -> self, tenant-scoped; the unique index on (tenant_id, kind, value)
 * means the upsert can only ever touch the caller's own row.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { randomUUID } from 'node:crypto';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** Normalize a destination value: lowercase EVM addresses; leave everything else as-is. */
function normalizeValue(kind: string, raw: string): string {
  const v = raw.trim();
  if (kind === 'crypto' && EVM_RE.test(v)) return v.toLowerCase();
  return v;
}

type DestRow = {
  id: unknown; kind: unknown; value: unknown; label: unknown;
  chain: unknown; monitor: unknown; created_at: unknown;
};
function shape(r: DestRow) {
  return {
    id: String(r.id),
    kind: String(r.kind),
    value: String(r.value),
    label: r.label ? String(r.label) : null,
    chain: r.chain ? String(r.chain) : null,
    monitor: Number(r.monitor) === 1,
    createdAt: String(r.created_at),
  };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  const res = await db.execute({
    sql: `SELECT id, kind, value, label, chain, monitor, created_at
          FROM merchant_destinations WHERE tenant_id = ? ORDER BY created_at DESC`,
    args: [tenantId],
  });
  return json({ ok: true, destinations: (res.rows as unknown as DestRow[]).map(shape) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const kind = body.kind === 'url' ? 'url' : 'crypto';
  const rawValue = typeof body.value === 'string' ? body.value.trim() : '';
  if (!rawValue) return json({ ok: false, error: 'value required' }, 400);

  const value = normalizeValue(kind, rawValue);
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  const chain = typeof body.chain === 'string' && body.chain.trim() ? body.chain.trim().slice(0, 40) : null;
  const monitor = body.monitor ? 1 : 0;
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO merchant_destinations (id, tenant_id, kind, value, label, chain, monitor)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, kind, value) DO UPDATE SET
            label = excluded.label, chain = excluded.chain, updated_at = datetime('now')`,
    args: [id, tenantId, kind, value, label, chain, monitor],
  });

  const row = await db.execute({
    sql: `SELECT id, kind, value, label, chain, monitor, created_at
          FROM merchant_destinations WHERE tenant_id = ? AND kind = ? AND value = ? LIMIT 1`,
    args: [tenantId, kind, value],
  });
  const r = row.rows[0] as unknown as DestRow | undefined;
  return json({ ok: true, destination: r ? shape(r) : null });
};

export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!id) return json({ ok: false, error: 'id required' }, 400);

  await db.execute({
    sql: `DELETE FROM merchant_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return json({ ok: true });
};
