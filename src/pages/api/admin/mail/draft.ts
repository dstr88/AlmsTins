/**
 * POST   /api/admin/mail/draft   { mailbox, draftId?, to, cc?, subject, body, replyToId? }
 *           → save (or replace) a draft in the mailbox's IMAP Drafts folder
 * DELETE /api/admin/mail/draft   { mailbox, draftId }
 *           → discard it, locally and on the server
 *
 * Drafts go to IMAP rather than living only in Postgres because for one operator this
 * panel is the sole way he reaches his mail. A draft that exists only inside this app
 * would be invisible from webmail or a phone — fine as a convenience, wrong as the only
 * copy. Round-tripping through the mailbox keeps the mail server authoritative.
 *
 * Same guards as the rest of the mail API: requireAdminSession, then
 * findMailboxForAdmin to refuse a mailbox the caller does not own.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { findMailboxForAdmin } from '@/lib/mailboxes';
import { deleteDraft, saveDraft } from '@/lib/mailSync';

export const prerender = false;

const MAX_BODY = 10_000;
const MAX_SUBJECT = 300;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function resolve(request: Request) {
	const who = await requireAdminSession(request);
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const box = findMailboxForAdmin(String(body.mailbox ?? ''), who);
	return { box, body };
}

export const POST: APIRoute = async ({ request }) => {
	let box, body;
	try {
		({ box, body } = await resolve(request));
	} catch (resp) {
		return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401);
	}
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	// A read-only mailbox must refuse drafts too. Composing is the first half of
	// sending, and the flag is a boundary rather than a display preference.
	if (!box.canSend) return json({ ok: false, error: `Composing is disabled for ${box.address}.` }, 403);

	const text = String(body.body ?? '');
	if (text.length > MAX_BODY) return json({ ok: false, error: 'Message is too long.' }, 400);

	const result = await saveDraft({
		box,
		draftId: body.draftId ? String(body.draftId) : undefined,
		to: String(body.to ?? '').trim(),
		cc: String(body.cc ?? '').trim(),
		subject: String(body.subject ?? '').trim().slice(0, MAX_SUBJECT),
		bodyText: text,
		replyToId: body.replyToId ? String(body.replyToId) : undefined,
	});

	return result.ok ? json({ ok: true, id: result.id }) : json({ ok: false, error: result.error }, 502);
};

export const DELETE: APIRoute = async ({ request }) => {
	let box, body;
	try {
		({ box, body } = await resolve(request));
	} catch (resp) {
		return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401);
	}
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	const draftId = String(body.draftId ?? '');
	if (!draftId) return json({ ok: false, error: 'draftId is required' }, 400);

	await deleteDraft(box, draftId);
	return json({ ok: true });
};
