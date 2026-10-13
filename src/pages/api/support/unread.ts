/**
 * GET /api/support/unread — returns count of unread admin replies for the current user
 * Used by the pill badge on page load.
 */
import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getAuthSession(request).catch(() => null);
  if (!session?.user?.id) return json({ ok: false, unread: 0 });

  const row = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM support_messages
          WHERE user_id = ? AND from_admin = 1 AND read_at IS NULL`,
    args: [session.user.id],
  });

  const unread = Number((row.rows[0] as any)?.cnt ?? 0);
  return json({ ok: true, unread });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
