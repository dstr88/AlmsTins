/**
 * POST /api/admin/mail/organize
 *
 *   { mailbox, action: 'delete',        id | ids[] }         → move to Trash
 *   { mailbox, action: 'destroy',       id | ids[] }         → permanent, Trash only
 *   { mailbox, action: 'move',          id | ids[], folder } → file it elsewhere
 *   { mailbox, action: 'create-folder', name }               → new folder
 *   { mailbox, action: 'create-rule',   match, matchType, folder }
 *                                                           → always file this sender
 *   { mailbox, action: 'delete-rule',   match, matchType }   → stop doing that
 *
 * Delete moves to Trash and never expunges. A small button beside a message must not
 * be able to destroy it — Trash is polled like any other folder, so a deleted message
 * stays readable and can be moved back. Permanent removal is the mail server's
 * retention policy to apply, not a side effect of a click here.
 *
 * Guards match the rest of the mail API: requireAdminSession, then findMailboxForAdmin
 * so no one can act on a mailbox that is not theirs. Every action also re-reads the
 * message FROM THE DATABASE scoped to that mailbox, so an id alone is never enough.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { findMailboxForAdmin } from '@/lib/mailboxes';
import { createMailFolder, deleteMessage, destroyMessage, moveMessage } from '@/lib/mailSync';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	let who;
	try { who = await requireAdminSession(request); }
	catch (resp) { return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401); }

	let body: Record<string, unknown>;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

	const box = findMailboxForAdmin(String(body.mailbox ?? ''), who);
	if (!box) return json({ ok: false, error: 'Unknown mailbox' }, 404);

	const action = String(body.action ?? '');

	// ── New folder ───────────────────────────────────────────────────────────
	if (action === 'create-folder') {
		const result = await createMailFolder(box, String(body.name ?? ''));
		return result.ok ? json({ ok: true, path: result.path }) : json(result, 400);
	}

	// ── Filing rules ─────────────────────────────────────────────────────────
	if (action === 'create-rule' || action === 'delete-rule') {
		const matchType = String(body.matchType ?? 'address');
		if (matchType !== 'address' && matchType !== 'domain') {
			return json({ ok: false, error: 'matchType must be address or domain' }, 400);
		}
		const match = String(body.match ?? '').trim().toLowerCase();
		if (!match) return json({ ok: false, error: 'match is required' }, 400);

		if (action === 'delete-rule') {
			await db.execute({
				sql: `DELETE FROM mail_rules WHERE mailbox = ? AND match_type = ? AND match_value = ?`,
				args: [box.address, matchType, match],
			});
			return json({ ok: true });
		}

		const folder = String(body.folder ?? '').trim();
		if (!folder) return json({ ok: false, error: 'folder is required' }, 400);

		// Re-filing the same sender REPLACES the rule. Two rules for one sender would
		// mean a message with two right answers, and whichever won would look arbitrary.
		await db.execute({
			sql: `INSERT INTO mail_rules (id, mailbox, match_type, match_value, folder)
			      VALUES (?, ?, ?, ?, ?)
			      ON CONFLICT (mailbox, match_type, match_value)
			      DO UPDATE SET folder = EXCLUDED.folder, created_at = now()`,
			args: [randomUUID(), box.address, matchType, match, folder],
		});
		return json({ ok: true });
	}

	// ── Delete / destroy / move — all operate on one or many ─────────────────
	//
	// Bulk is the normal case, not an edge case: junk arrives in volume, and a client
	// that can only act on one message at a time is a client nobody uses. `id` is kept
	// as shorthand for a single-element `ids`.
	const ids = Array.isArray(body.ids)
		? body.ids.map(String).filter(Boolean)
		: body.id ? [String(body.id)] : [];

	if (!ids.length) return json({ ok: false, error: 'Nothing selected' }, 400);

	// One statement rather than a query per id, and scoped to this mailbox so a crafted
	// list of ids cannot reach another mailbox's mail.
	const placeholders = ids.map(() => '?').join(',');
	const r = await db.execute({
		sql: `SELECT id, folder, uid FROM mail_messages
		      WHERE mailbox = ? AND id IN (${placeholders})`,
		args: [box.address, ...ids],
	});
	const rows = r.rows as Record<string, unknown>[];
	if (!rows.length) return json({ ok: false, error: 'No such messages' }, 404);

	const results: Array<{ id: string; ok: boolean; error?: string }> = [];

	for (const row of rows) {
		const id = String(row.id);
		const folder = String(row.folder);

		// A null uid is a placeholder written at send time, before the server's copy came
		// back. There is nothing on the server to act on yet.
		if (row.uid == null) {
			results.push({ id, ok: false, error: 'Not synced to the server yet' });
			continue;
		}
		const uid = Number(row.uid);

		if (action === 'delete') {
			const out = await deleteMessage(box, folder, uid);
			results.push({ id, ok: out.ok, error: out.error });
		} else if (action === 'destroy') {
			// Trash-only, checked HERE rather than trusted from the UI. This is the one
			// action with no undo, so the restriction has to hold for every id in the
			// batch — including one slipped into a hand-rolled list.
			if (!/^(inbox[./])?(trash|deleted items?)$/i.test(folder)) {
				results.push({ id, ok: false, error: 'Only messages in Trash can be permanently deleted' });
				continue;
			}
			const out = await destroyMessage(box, folder, uid);
			results.push({ id, ok: out.ok, error: out.error });
		} else if (action === 'move') {
			const target = String(body.folder ?? '');
			if (!target) return json({ ok: false, error: 'folder is required' }, 400);
			if (target === folder) { results.push({ id, ok: true }); continue; }
			const out = await moveMessage(box, folder, uid, target);
			results.push({ id, ok: out.ok, error: out.error });
		} else {
			return json({ ok: false, error: 'Unknown action.' }, 400);
		}
	}

	const failed = results.filter((x) => !x.ok);
	// Partial success is reported as success with detail rather than a blanket error:
	// nineteen of twenty deleted is not a failure, but the operator still needs to know
	// which one did not.
	return json({
		ok: true,
		done: results.filter((x) => x.ok).map((x) => x.id),
		failed,
	});
}


