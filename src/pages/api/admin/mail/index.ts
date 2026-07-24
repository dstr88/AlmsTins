/**
 * GET   /api/admin/mail?mailbox=admin@susufinance.com&limit=50
 *         → messages for one window, newest first
 * POST  /api/admin/mail            { mailbox, to, cc?, subject, body, replyToId? }
 *         → compose or reply, sends via SMTP and records the row
 * PATCH /api/admin/mail            { id | ids[], mailbox, read?: boolean }
 *         → mark messages read (default) or unread; our state, not the server's
 *
 * ── Isolation note ──────────────────────────────────────────────────────────
 * mail_messages carries no tenant_id (see migrations-pg/0026_mail.sql). It is operator
 * correspondence, not tenant data. The guarantee here is requireAdminSession on EVERY
 * method plus findMailboxForAdmin, which refuses a mailbox the caller does not own.
 * Never add an unguarded path to this table.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';
import { findMailboxForAdmin } from '@/lib/mailboxes';
import { sendFromMailbox } from '@/lib/mailSync';
import { ensureMailTables } from '@/lib/mailTables';

export const prerender = false;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Same ceiling the support inbox uses. Long enough for real mail, short of abuse. */
const MAX_BODY = 10_000;
const MAX_SUBJECT = 300;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Resolves the admin, or returns the Response to send back. */
async function admin(request: Request): Promise<{ userId: string; email: string } | Response> {
	try {
		const { userId, email } = await requireAdminSession(request);
		await ensureMailTables();
		return { userId, email };
	} catch (resp) {
		return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401);
	}
}

// ── GET — list one mailbox ───────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
	const who = await admin(request);
	if (who instanceof Response) return who;

	const url = new URL(request.url);
	const address = url.searchParams.get('mailbox') ?? '';
	const box = findMailboxForAdmin(address, who);
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	const limit = Math.min(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);
	const folder = url.searchParams.get('folder') ?? '';

	// The tab strip. Read from mail_folder_state (written by the poll) rather than by
	// asking IMAP, so opening the page costs no network round trip to the mail server.
	const folderRows = await db.execute({
		sql: `SELECT folder, special_use FROM mail_folder_state WHERE mailbox = ?`,
		args: [box.address],
	});
	// Matches the rail's own filtering (see MailboxWindows.astro): the real Drafts
	// folder is covered by the synthetic Drafts tab, and an unflagged folder merely
	// NAMED junk is a duplicate of the one the server flags \Junk. Without this the
	// move menu offered destinations the rail could not show, which is how a message
	// moved to Drafts vanished.
	const folders = (folderRows.rows as Record<string, unknown>[])
		.map((f) => ({
			path: String(f.folder),
			specialUse: f.special_use ? String(f.special_use) : null,
		}))
		.filter((f) => f.specialUse !== '\\Drafts' && !/^(inbox[./])?drafts?$/i.test(f.path))
		.filter((f, _i, all) =>
			!(!f.specialUse
				&& /^(inbox[./])?(junk|spam)$/i.test(f.path)
				&& all.some((o) => o.specialUse === '\\Junk')));

	// Drafts is one tab over two sources.
	//
	// mail_drafts holds what was composed HERE — editable, and with no server copy until
	// saved. mail_messages holds anything sitting in the IMAP Drafts folder, including
	// mail moved there from another folder.
	//
	// Previously this returned only the first, so the real Drafts folder had no tab at
	// all: a message moved into it left its old folder, never appeared anywhere, and
	// looked lost. One tab showing both is what "Drafts" means to the person reading it.
	if (folder === '__drafts__') {
		const [d, m] = await Promise.all([
			db.execute({
				sql: `SELECT id, to_addrs, cc_addrs, subject, body_text, reply_to_id, updated_at
				      FROM mail_drafts WHERE mailbox = ? ORDER BY updated_at DESC LIMIT ?`,
				args: [box.address, limit],
			}),
			db.execute({
				sql: `SELECT id, direction, folder, special_use, message_id, in_reply_to,
				             from_addr, from_name, to_addrs, cc_addrs,
				             subject, body_text, sent_at, read_at, send_error,
				             spam_flag, spam_score, threat_level, scanned_at,
				             (body_html IS NOT NULL AND body_html <> '') AS has_html
				      FROM mail_messages
				      WHERE mailbox = ?
				        AND (special_use = '\\Drafts' OR folder ~* '^(inbox[./])?drafts?$')
				      ORDER BY COALESCE(sent_at, fetched_at) DESC
				      LIMIT ?`,
				args: [box.address, limit],
			}),
		]);
		return json({
			ok: true, mailbox: box.address, label: box.label, canSend: box.canSend,
			folder, folders, unread: 0,
			drafts: d.rows,
			messages: (m.rows as Record<string, unknown>[]).map((r) => ({ ...r, attachments: [], threats: [] })),
		});
	}

	const r = await db.execute({
		sql: `SELECT id, direction, folder, special_use, message_id, in_reply_to,
		             from_addr, from_name, to_addrs, cc_addrs,
		             subject, body_text, sent_at, read_at, send_error,
		             spam_flag, spam_score, threat_level, scanned_at,
             (body_html IS NOT NULL AND body_html <> '') AS has_html
		      FROM mail_messages
		      WHERE mailbox = ? AND (? = '' OR folder = ?)
		      ORDER BY COALESCE(sent_at, fetched_at) DESC
		      LIMIT ?`,
		args: [box.address, folder, folder, limit],
	});

	const unread = await db.execute({
		sql: `SELECT COUNT(*) AS n FROM mail_messages
		      WHERE mailbox = ? AND direction = 'in' AND read_at IS NULL`,
		args: [box.address],
	});

	// Unread within the requested folder, so the rail badge can be corrected without a
	// page reload after mail moves between folders.
	const folderUnread = await db.execute({
		sql: `SELECT COUNT(*) AS n FROM mail_messages
		      WHERE mailbox = ? AND folder = ? AND direction = 'in' AND read_at IS NULL`,
		args: [box.address, folder],
	});

	// Attachments for exactly the messages being returned. Scoped by mailbox as well as
	// message id so the join can never reach a file from a mailbox this admin can't see.
	const atts = await db.execute({
		sql: `SELECT a.id, a.message_id, a.filename, a.size_bytes, a.skipped
		      FROM mail_attachments a
		      JOIN mail_messages m ON m.id = a.message_id
		      WHERE m.mailbox = ?
		      ORDER BY a.filename`,
		args: [box.address],
	});

	// Threat findings for the same window of messages.
	const threats = await db.execute({
		sql: `SELECT t.message_id, t.kind, t.value, t.severity, t.reason
		      FROM mail_threats t
		      JOIN mail_messages m ON m.id = t.message_id
		      WHERE m.mailbox = ?`,
		args: [box.address],
	});
	const threatsByMessage = new Map<string, Record<string, unknown>[]>();
	for (const t of threats.rows as Record<string, unknown>[]) {
		const key = String(t.message_id);
		if (!threatsByMessage.has(key)) threatsByMessage.set(key, []);
		threatsByMessage.get(key)!.push(t);
	}

	const byMessage = new Map<string, Record<string, unknown>[]>();
	for (const a of atts.rows as Record<string, unknown>[]) {
		const key = String(a.message_id);
		if (!byMessage.has(key)) byMessage.set(key, []);
		byMessage.get(key)!.push(a);
	}

	const messages = (r.rows as Record<string, unknown>[]).map((m) => ({
		...m,
		attachments: byMessage.get(String(m.id)) ?? [],
		threats: threatsByMessage.get(String(m.id)) ?? [],
	}));

	return json({
		ok: true,
		mailbox: box.address,
		label: box.label,
		canSend: box.canSend,
		folder,
		folders,
		unread: Number((unread.rows[0] as Record<string, unknown>)?.n ?? 0),
		folderUnread: Number((folderUnread.rows[0] as Record<string, unknown>)?.n ?? 0),
		messages,
	});
};

// ── POST — compose or reply ──────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
	const who = await admin(request);
	if (who instanceof Response) return who;

	let body: Record<string, unknown>;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

	const box = findMailboxForAdmin(String(body.mailbox ?? ''), who);
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	// Enforced server-side as well as hidden in the UI. A read-only mailbox must refuse
	// even a hand-rolled request — the flag is a boundary, not a display preference.
	if (!box.canSend) {
		return json({ ok: false, error: `Sending is disabled for ${box.address}.` }, 403);
	}

	const to = String(body.to ?? '').trim();
	const cc = String(body.cc ?? '').trim();
	const subject = String(body.subject ?? '').trim().slice(0, MAX_SUBJECT);
	const text = String(body.body ?? '').trim();
	const replyToId = body.replyToId ? String(body.replyToId) : undefined;

	if (!to) return json({ ok: false, error: 'A recipient is required.' }, 400);
	if (!text) return json({ ok: false, error: 'Message cannot be empty.' }, 400);
	if (text.length > MAX_BODY) return json({ ok: false, error: 'Message is too long.' }, 400);

	const result = await sendFromMailbox({
		box, to, cc, subject: subject || '(no subject)', bodyText: text, replyToId,
	});

	// The row is recorded either way, so a failure here is reportable rather than lost.
	return result.ok
		? json({ ok: true, id: result.id })
		: json({ ok: false, error: result.error ?? 'Send failed.' }, 502);
};

// ── PATCH — mark read ────────────────────────────────────────────────────────
export const PATCH: APIRoute = async ({ request }) => {
	const who = await admin(request);
	if (who instanceof Response) return who;

	let body: Record<string, unknown>;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

	// One or many. `id` is shorthand for a single-element `ids`, so the same endpoint
	// serves a row button and a bulk action.
	const ids = Array.isArray(body.ids)
		? body.ids.map(String).filter(Boolean)
		: body.id ? [String(body.id)] : [];
	if (!ids.length) return json({ ok: false, error: 'Nothing selected' }, 400);

	// Scope the update to mailboxes this admin owns, so an id alone is not enough to
	// touch someone else's window.
	const allowed = findMailboxForAdmin(String(body.mailbox ?? ''), who);
	if (!allowed) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	// Absent means read — that is the overwhelmingly common case and keeps every
	// existing caller working unchanged.
	const read = body.read === undefined ? true : Boolean(body.read);

	const placeholders = ids.map(() => '?').join(',');
	await db.execute({
		sql: read
			? `UPDATE mail_messages SET read_at = now()
			   WHERE mailbox = ? AND id IN (${placeholders}) AND read_at IS NULL`
			: `UPDATE mail_messages SET read_at = NULL
			   WHERE mailbox = ? AND id IN (${placeholders})`,
		args: [allowed.address, ...ids],
	});

	return json({ ok: true, count: ids.length });
};
