/**
 * GET /api/admin/support/thread?userId=xxx
 * Returns full message thread for one user (admin only).
 * Also marks unread user messages as read.
 */
import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try { await requireAdminSession(request); }
  catch { return json({ ok: false, error: 'Unauthorized' }, 401); }

  const userId = new URL(request.url).searchParams.get('userId') ?? '';
  if (!userId) return json({ ok: false, error: 'userId required' }, 400);

  const rows = await db.execute({
    sql: `SELECT id, body, from_admin, read_at, created_at
          FROM support_messages
          WHERE user_id = ?
          ORDER BY created_at ASC`,
    args: [userId],
  });

  // Mark unread user messages as read now that admin is viewing
  await db.execute({
    sql: `UPDATE support_messages
          SET read_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
          WHERE user_id = ? AND from_admin = 0 AND read_at IS NULL`,
    args: [userId],
  }).catch(() => {});

  return json({ ok: true, messages: rows.rows });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
