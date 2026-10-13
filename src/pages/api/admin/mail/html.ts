/**
 * GET /api/admin/mail/html?id=<message id>
 *   → the message's original HTML body, rendered under a hard sandbox
 *
 * Some senders ship HTML only. Those messages arrive with a subject, a sender and an
 * empty body, because the panel renders plain text exclusively — injecting a stranger's
 * markup into the admin page is how script ends up running with the operator's session.
 * For someone whose only mail client is this panel, an unreadable message is a real
 * outage, not a cosmetic gap.
 *
 * ── Why this is safe without sanitizing the HTML ────────────────────────────
 * Content-Security-Policy: sandbox makes the browser treat this response as a UNIQUE
 * OPAQUE ORIGIN. Scripts do not run, the document cannot reach the parent page, and it
 * has no access to cookies or storage for this site. That is the same isolation an
 * incognito window would give — except incognito cannot be requested from a page, and a
 * plain new tab on this origin would be strictly worse than an iframe: same origin,
 * same session.
 *
 * default-src 'none' also blocks REMOTE images. That is not incidental: a remote image
 * in an email is how a sender learns the message was opened, and a marketing pixel in a
 * mailbox that only ever loads deliberately would be a needless disclosure. Inline
 * data: images still render.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { findMailboxForAdmin } from '@/lib/mailboxes';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	let who;
	try { who = await requireAdminSession(request); }
	catch (resp) { return resp instanceof Response ? resp : new Response('Unauthorized', { status: 401 }); }

	const id = new URL(request.url).searchParams.get('id') ?? '';
	if (!id) return new Response('Missing id', { status: 400 });

	const r = await db.execute({
		sql: `SELECT mailbox, subject, body_html, body_text FROM mail_messages WHERE id = ? LIMIT 1`,
		args: [id],
	});
	const row = r.rows[0] as Record<string, unknown> | undefined;
	if (!row) return new Response('Not found', { status: 404 });

	// Ownership: the message must belong to a mailbox this admin can see.
	if (!findMailboxForAdmin(String(row.mailbox ?? ''), who)) {
		return new Response('Forbidden', { status: 403 });
	}

	const html = row.body_html ? String(row.body_html) : '';
	if (!html) return new Response('This message has no HTML part.', { status: 404 });

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			// sandbox with no allow-* tokens: no scripts, no forms, no popups, opaque
			// origin. default-src 'none' additionally stops remote images and fonts, so
			// opening a message cannot phone home.
			'Content-Security-Policy':
				"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Cache-Control': 'private, no-store',
		},
	});
};
