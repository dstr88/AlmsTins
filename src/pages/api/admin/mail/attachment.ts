/**
 * GET /api/admin/mail/attachment?id=<attachment id>
 *
 * Streams one stored attachment back to the admin who owns its mailbox.
 *
 * Two guards, both required: requireAdminSession proves the caller is an operator, and
 * the join back to mail_messages.mailbox + findMailboxForAdmin proves this particular
 * file belongs to a mailbox THEY can see. An attachment id alone must never be enough —
 * ids are guessable in principle and one admin's private mailbox must stay private from
 * another's.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { findMailboxForAdmin } from '@/lib/mailboxes';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	let who: { userId: string; email: string };
	try {
		who = await requireAdminSession(request);
	} catch (resp) {
		return resp instanceof Response ? resp : new Response('Unauthorized', { status: 401 });
	}

	const id = new URL(request.url).searchParams.get('id') ?? '';
	if (!id) return new Response('Missing id', { status: 400 });

	const r = await db.execute({
		sql: `SELECT a.filename, a.content_type, a.content_b64, a.skipped, m.mailbox
		      FROM mail_attachments a
		      JOIN mail_messages m ON m.id = a.message_id
		      WHERE a.id = ?
		      LIMIT 1`,
		args: [id],
	});
	const row = r.rows[0] as Record<string, unknown> | undefined;
	if (!row) return new Response('Not found', { status: 404 });

	// The authorization step: does this admin own the mailbox this file arrived in?
	if (!findMailboxForAdmin(String(row.mailbox ?? ''), who)) {
		return new Response('Forbidden', { status: 403 });
	}

	if (!row.content_b64) {
		return new Response(
			row.skipped === 'too_large'
				? 'This attachment exceeded the size limit and was not stored. Open the message in webmail to retrieve it.'
				: 'Attachment content is unavailable.',
			{ status: 410 },
		);
	}

	const bytes = Buffer.from(String(row.content_b64), 'base64');

	// Always Content-Disposition: attachment, never inline. Rendering an attacker-supplied
	// file inline in the admin origin would let an HTML or SVG attachment run script with
	// the operator's session — download-only removes that entirely.
	const safeName = String(row.filename ?? 'attachment').replace(/["\r\n]/g, '');

	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: {
			'Content-Type': String(row.content_type ?? 'application/octet-stream'),
			'Content-Disposition': `attachment; filename="${safeName}"`,
			'Content-Length': String(bytes.length),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store',
		},
	});
};
