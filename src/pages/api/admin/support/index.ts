/**
 * GET  /api/admin/support        — all threads (one per user, latest message preview)
 * POST /api/admin/support        — admin sends a reply
 *                                   body: { userId, body }
 */
import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try { await requireAdminSession(request); }
  catch { return json({ ok: false, error: 'Unauthorized' }, 401); }

  // One row per user: latest message body, unread count (user messages not yet replied to effectively)
  const rows = await db.execute(`
    SELECT
      sm.user_id,
      au.email          AS user_email,
      COUNT(*)          AS total_messages,
      SUM(CASE WHEN sm.from_admin = 0 AND sm.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
      MAX(sm.created_at) AS last_message_at,
      (
        SELECT body FROM support_messages s2
        WHERE s2.user_id = sm.user_id
        ORDER BY s2.created_at DESC LIMIT 1
      ) AS last_body,
      (
        SELECT from_admin FROM support_messages s3
        WHERE s3.user_id = sm.user_id
        ORDER BY s3.created_at DESC LIMIT 1
      ) AS last_from_admin
    FROM support_messages sm
    LEFT JOIN auth_users au ON au.id = sm.user_id
    GROUP BY sm.user_id
    ORDER BY last_message_at DESC
  `);

  return json({ ok: true, threads: rows.rows });
};

export const POST: APIRoute = async ({ request }) => {
  try { await requireAdminSession(request); }
  catch { return json({ ok: false, error: 'Unauthorized' }, 401); }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const userId  = typeof body.userId === 'string' ? body.userId.trim() : '';
  const text    = typeof body.body   === 'string' ? body.body.trim()   : '';

  if (!userId || !text)
    return json({ ok: false, error: 'userId and body required' }, 400);

  // Look up tenantId for the user
  const userRow = await db.execute({
    sql: 'SELECT tenant_id FROM tenant_memberships WHERE user_id = ? LIMIT 1',
    args: [userId],
  });
  const tenantId = (userRow.rows[0] as any)?.tenant_id ?? '';

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO support_messages (id, user_id, tenant_id, body, from_admin)
          VALUES (?, ?, ?, ?, 1)`,
    args: [id, userId, tenantId, text],
  });

  return json({ ok: true, id });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
