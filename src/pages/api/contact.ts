/**
 * POST /api/contact
 *
 * Public endpoint — no auth required.
 * Stores an anonymous question/message and notifies the admin by email.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { hashWithSalt } from '@/lib/analytics/hash';
import { getClientIp } from '@/lib/analytics/ip';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Admin notification address — same source as admin guard
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)[0] ?? '';

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const subject = String((body as any)?.subject ?? '').trim();
  const text    = String((body as any)?.body ?? '').trim();

  if (!subject || subject.length > 120) {
    return json({ ok: false, error: 'Subject is required (max 120 chars)' }, 400);
  }
  if (!text || text.length > 500) {
    return json({ ok: false, error: 'Message is required (max 500 chars)' }, 400);
  }

  const id        = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const ipHash    = hashWithSalt(getClientIp(request) ?? 'unknown');

  // Run DB insert and email in parallel; don't let email failure block the response
  await db.execute({
    sql: `INSERT INTO contact_messages (id, subject, body, created_at, ip_hash)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, subject, text, createdAt, ipHash],
  });

  // Fire-and-forget email
  if (ADMIN_EMAIL) {
    sendMail({
      to: ADMIN_EMAIL,
      subject: `[Almstins] New question: ${subject}`,
      text: `A visitor submitted a question via the login page.\n\nSubject: ${subject}\n\n${text}\n\n—\nView in admin: /admin`,
    }).catch((e: unknown) =>
      console.warn('[contact] email failed:', e instanceof Error ? e.message : e),
    );
  }

  return json({ ok: true });
};

export const GET: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
