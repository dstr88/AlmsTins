/**
 * DELETE /api/admin/support/:id  — admin deletes a single message
 */
import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, request }) => {
  try { await requireAdminSession(request); }
  catch { return json({ ok: false, error: 'Unauthorized' }, 401); }

  const id = params.id ?? '';
  if (!id) return json({ ok: false, error: 'Missing id' }, 400);

  await db.execute({
    sql: 'DELETE FROM support_messages WHERE id = ?',
    args: [id],
  });

  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
