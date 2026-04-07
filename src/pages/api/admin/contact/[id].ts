/**
 * /api/admin/contact/[id]
 *
 * DELETE — permanently remove a message
 * PATCH  — toggle persisted flag  (body: { persisted: boolean })
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminSession(request);
  } catch {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { id } = params;
  if (!id) return json({ ok: false, error: 'Missing id' }, 400);

  await db.execute({
    sql: 'DELETE FROM contact_messages WHERE id = ?',
    args: [id],
  });

  return json({ ok: true });
};

export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    await requireAdminSession(request);
  } catch {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const { id } = params;
  if (!id) return json({ ok: false, error: 'Missing id' }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const persisted = (body as any)?.persisted ? 1 : 0;

  await db.execute({
    sql: 'UPDATE contact_messages SET persisted = ? WHERE id = ?',
    args: [persisted, id],
  });

  return json({ ok: true });
};
