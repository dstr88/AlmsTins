/**
 * POST /api/petro-tins/visit — log a page visit with duration
 * Called on page unload from non-owner authenticated users.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS petro_visits (
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    visited_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    duration_s  INTEGER NOT NULL DEFAULT 0
  )`;

async function ensureTable() {
  await db.execute(ENSURE_SQL);
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) return new Response('{}', { status: 401 });

  await ensureTable();

  const body = await request.json().catch(() => ({}));
  const duration = Math.max(0, Math.min(7200, parseInt(body.duration ?? 0, 10)));

  const { randomUUID } = await import('crypto');
  await db.execute({
    sql: `INSERT INTO petro_visits (id, tenant_id, duration_s) VALUES (?, ?, ?)`,
    args: [randomUUID(), session.tenantId, duration],
  });

  return new Response('{}', { status: 200 });
};
