/**
 * GET  /api/support        — user reads their own thread
 * POST /api/support        — user sends a message
 *
 * Rate limit: 5 messages per user per 24 hours.
 * Character limit: 500 characters.
 */
import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { randomUUID } from 'node:crypto';

export const prerender = false;

const CHAR_LIMIT       = 500;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_HOURS = 24;

const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL ??
  process.env.ADMIN_EMAIL ??
  process.env.ADMIN_EMAILS?.split(',')[0]?.trim() ??
  '';

// ── GET ──────────────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
  const session = await getAuthSession(request).catch(() => null);
  if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

  const rows = await db.execute({
    sql: `SELECT id, body, from_admin, read_at, created_at
          FROM support_messages
          WHERE user_id = ?
          ORDER BY created_at ASC`,
    args: [session.user.id],
  });

  // Mark unread admin replies as read now that the user is fetching
  await db.execute({
    sql: `UPDATE support_messages
          SET read_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
          WHERE user_id = ? AND from_admin = 1 AND read_at IS NULL`,
    args: [session.user.id],
  }).catch(() => {});

  return json({ ok: true, messages: rows.rows });
};

// ── POST ─────────────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  const session = await getAuthSession(request).catch(() => null);
  if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return json({ ok: false, error: 'Message cannot be empty.' }, 400);
  if (text.length > CHAR_LIMIT)
    return json({ ok: false, error: `Message must be ${CHAR_LIMIT} characters or fewer.` }, 400);

  // Rate limit: count messages sent by this user in last 24h
  const since = new Date(Date.now() - RATE_LIMIT_HOURS * 3_600_000).toISOString();
  const countRow = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM support_messages
          WHERE user_id = ? AND from_admin = 0 AND created_at >= ?`,
    args: [session.user.id, since],
  });
  const recentCount = Number((countRow.rows[0] as any)?.cnt ?? 0);
  if (recentCount >= RATE_LIMIT_COUNT) {
    return json({
      ok: false,
      error: `You've sent ${RATE_LIMIT_COUNT} messages in the last ${RATE_LIMIT_HOURS} hours. Please wait before sending more.`,
    }, 429);
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO support_messages (id, user_id, tenant_id, body, from_admin)
          VALUES (?, ?, ?, ?, 0)`,
    args: [id, session.user.id, session.tenantId ?? '', text],
  });

  // Notify admin by email (fire and forget)
  if (ADMIN_NOTIFY_EMAIL) {
    const userEmail = session.user.email ?? 'unknown';
    sendMail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: `💬 New support message from ${userEmail}`,
      text: [
        `A user has sent a support message on Almstins.`,
        ``,
        `From   : ${userEmail}`,
        `User ID: ${session.user.id}`,
        `Message:`,
        ``,
        text,
        ``,
        `Reply at: ${process.env.AUTH_URL ?? 'https://almstins.com'}/admin/support`,
      ].join('\n'),
    }).catch((err) => console.warn('[support] admin notify failed', err));
  }

  return json({ ok: true, id });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
