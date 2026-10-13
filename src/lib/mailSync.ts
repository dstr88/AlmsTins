/**
 * mailSync.ts
 *
 * The two halves of the /admin mailbox windows that touch the outside world:
 *
 *   pollMailbox()  — IMAP → mail_messages   (run by the sync-mail cron)
 *   sendFromMailbox() — compose/reply → SMTP → mail_messages + IMAP Sent
 *
 * Deliberately separate from src/lib/email.ts. That file is system mail: one shared
 * EMAIL_SERVER transport sending magic links and alerts as no-reply@. This file is
 * operator correspondence, authenticating per-mailbox as a real human address. Mixing
 * them would mean a leaked EMAIL_SERVER credential could send as donnie@.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { getMailServerConfig, type Mailbox } from './mailboxes';
import { newScanBudget, scanAndRecord, sweepVerdictCache } from './mailThreats';
import { ensureMailTables } from './mailTables';

/** Newest-first cap per poll, so a long-dormant mailbox cannot stall the cron. */
const MAX_PER_POLL = 200;
/** IMAP can hang on a wedged connection; every network step gets a ceiling. */
const IMAP_TIMEOUT_MS = 30_000;
/**
 * Per-file ceiling. Above this the row is recorded with skipped='too_large' and no
 * content, so the panel can say what happened rather than showing nothing — which
 * would be indistinguishable from "no attachment".
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface PollResult {
	mailbox: string;
	fetched: number;
	inserted: number;
	folders?: number;
	error?: string;
}

export interface MailFolder {
	path: string;
	name: string;
	/** '\Sent', '\Drafts', '\Junk', '\Archive', or null for an ordinary folder. */
	specialUse: string | null;
}

/**
 * Folders worth polling, in display order.
 *
 * EVERYTHING is polled — Junk and Trash included. An earlier version skipped them to
 * save storage, which was the wrong trade for this product: one operator reaches his
 * mail ONLY through this panel, so a folder the panel does not sync is mail he cannot
 * find at all. Legitimate messages land in Junk regularly, and "check webmail instead"
 * is not an answer when the panel is the mail client.
 *
 * The one exception is \All (Gmail's All Mail and its equivalents), which is a view
 * over every other folder rather than a folder of its own. Polling it would store a
 * second copy of every message under a different UID, which the dedupe index cannot
 * catch because the UID genuinely differs.
 */
const SKIP_SPECIAL_USE = new Set(['\\All']);

/**
 * Name fallback for servers that do not advertise SPECIAL-USE, matching the same
 * all-mail idea by name.
 */
const SKIP_NAME = /^(inbox[./])?(all mail|all)$/i;

/**
 * Should this folder be hidden from the operator?
 *
 * Exported because the RAIL and the POLL must agree. They read different sources —
 * the rail lists mail_folder_state, the poll lists IMAP — so a cursor row written
 * before a folder was skipped would otherwise keep its tab alive forever. One
 * predicate, both callers.
 */
export function isHiddenFolder(path: string, specialUse: string | null): boolean {
	if (specialUse && SKIP_SPECIAL_USE.has(specialUse)) return true;
	return SKIP_NAME.test(path);
}

export async function listFolders(imap: ImapFlow): Promise<MailFolder[]> {
	const raw = await imap.list();

	// Some mailboxes carry two junk folders: the one the server actually files spam
	// into (flagged \Junk — here it is INBOX.spam) and an unflagged leftover created
	// by some mail client along the way (INBOX.Junk). Showing both invites the operator
	// to check two places for the same thing, and to wonder which one is real.
	//
	// The FLAG decides. If any folder claims \Junk, an unflagged folder merely NAMED
	// junk or spam is a duplicate and is dropped from the list — never from the server.
	const hasFlaggedJunk = raw.some((f) => (f as { specialUse?: string }).specialUse === '\\Junk');
	const isUnflaggedJunkName = (path: string, specialUse: string | null) =>
		!specialUse && /^(inbox[./])?(junk|spam)$/i.test(path);

	const out: MailFolder[] = [];
	for (const f of raw) {
		const specialUse = (f as { specialUse?: string }).specialUse ?? null;
		if (isHiddenFolder(f.path, specialUse)) continue;
		if (hasFlaggedJunk && isUnflaggedJunkName(f.path, specialUse)) continue;
		out.push({ path: f.path, name: f.name ?? f.path, specialUse });
	}
	// INBOX first, then Sent, Drafts, then the rest alphabetically — the order the
	// tabs appear in, decided here so every caller agrees.
	const isJunkish = (f: MailFolder) =>
		f.specialUse === '\\Junk' || f.specialUse === '\\Trash' ||
		/^(inbox[./])?(junk|spam|trash|deleted items?)$/i.test(f.path);

	const rank = (f: MailFolder) =>
		f.path.toUpperCase() === 'INBOX' ? 0
		: f.specialUse === '\\Sent' ? 1
		: f.specialUse === '\\Drafts' ? 2
		// Junk and Trash last: findable, but not competing with the folders he uses.
		: isJunkish(f) ? 4
		: 3;
	return out.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

function client(box: Mailbox): ImapFlow {
	const cfg = getMailServerConfig();
	if (!cfg) throw new Error('MAIL_IMAP_HOST is not set');
	return new ImapFlow({
		host: cfg.imapHost,
		port: cfg.imapPort,
		secure: cfg.imapPort === 993,
		auth: { user: box.address, pass: box.password },
		logger: false,
		// Without this a dead socket keeps the cron open until the platform kills it.
		socketTimeout: IMAP_TIMEOUT_MS,
	});
}

/**
 * The sync cursor for one folder: the highest UID already stored, and the UIDVALIDITY
 * epoch it belongs to.
 *
 * Kept in mail_folder_state rather than derived with MAX(uid), because a folder that
 * has been emptied would derive back to 0 and re-fetch its whole history on the next
 * run. A cursor remembers where we got to even when the evidence is deleted.
 *
 * If the server reports a DIFFERENT uid_validity than we stored, the epoch has been
 * reset and every old UID is meaningless. The only safe response is to start over from
 * zero, which the caller does by treating the cursor as 0.
 */
async function folderCursor(mailbox: string, folder: string, uidValidity: number): Promise<number> {
	const r = await db.execute({
		sql: `SELECT last_uid, uid_validity FROM mail_folder_state
		      WHERE mailbox = ? AND folder = ? LIMIT 1`,
		args: [mailbox, folder],
	});
	const row = r.rows[0] as Record<string, unknown> | undefined;
	if (!row) return 0;
	if (Number(row.uid_validity) !== uidValidity) return 0;
	return Number(row.last_uid ?? 0);
}

async function saveCursor(
	mailbox: string, folder: string, uidValidity: number, lastUid: number, specialUse: string | null,
): Promise<void> {
	await db.execute({
		sql: `INSERT INTO mail_folder_state (mailbox, folder, uid_validity, last_uid, special_use, updated_at)
		      VALUES (?, ?, ?, ?, ?, now())
		      ON CONFLICT (mailbox, folder) DO UPDATE
		        SET uid_validity = EXCLUDED.uid_validity,
		            -- GREATEST so an out-of-order or partial run never rewinds the cursor
		            -- and causes the next poll to re-fetch what it already has.
		            last_uid = GREATEST(mail_folder_state.last_uid, EXCLUDED.last_uid),
		            special_use = EXCLUDED.special_use,
		            updated_at = now()`,
		args: [mailbox, folder, uidValidity, lastUid, specialUse],
	});
}

/**
 * The mail server's own spam verdict, read back out of the headers.
 *
 * SpamAssassin (what cPanel runs) writes some combination of:
 *   X-Spam-Flag:   YES
 *   X-Spam-Status: Yes, score=12.4 required=5.0 tests=...
 *   X-Spam-Score:  12.4
 *
 * Which of the three appear varies by configuration, so all three are checked and any
 * one saying yes is enough. We deliberately do NOT apply our own threshold to the
 * score: the server's required= value is the operator's configured policy, and second
 * -guessing it here would mean the panel disagrees with the mailbox.
 */
function readSpamVerdict(headers: Map<string, unknown> | undefined): { flag: boolean; score: number | null } {
	if (!headers) return { flag: false, score: null };

	const raw = (k: string): string => {
		const v = headers.get(k);
		if (v == null) return '';
		if (typeof v === 'string') return v;
		// mailparser hands back a structured object for some headers.
		return String((v as { value?: unknown }).value ?? v);
	};

	const flagHeader = raw('x-spam-flag').trim().toLowerCase();
	const status = raw('x-spam-status').trim();
	const scoreHeader = raw('x-spam-score').trim();

	// score= inside X-Spam-Status, or the standalone X-Spam-Score header.
	const fromStatus = status.match(/score=(-?\d+(?:\.\d+)?)/i)?.[1];
	const parsed = Number(fromStatus ?? scoreHeader);
	const score = Number.isFinite(parsed) ? parsed : null;

	const flag = flagHeader === 'yes' || /^yes\b/i.test(status);

	return { flag, score };
}


/**
 * Where does this message's conversation already live?
 *
 * Looks up the parent by Message-ID — first the direct In-Reply-To, then the References
 * chain newest-first, since a long thread names every ancestor and the nearest one is
 * the most likely to have been filed deliberately.
 *
 * Only ordinary folders are followed into. A reply must never be auto-filed into Sent,
 * Drafts, Junk, Trash or Archive: those describe what was DONE with a message, not what
 * it is about, and filing incoming mail there would hide it behind a meaning it does
 * not have.
 */
async function threadFolder(
	mailbox: string, inReplyTo: string | null, refs: string | null,
): Promise<string | null> {
	const candidates = [
		...(inReplyTo ? [inReplyTo] : []),
		...(refs ? refs.split(/\s+/).filter(Boolean).reverse() : []),
	];
	if (!candidates.length) return null;

	for (const messageId of candidates.slice(0, 10)) {
		try {
			const r = await db.execute({
				sql: `SELECT folder, special_use FROM mail_messages
				      WHERE mailbox = ? AND message_id = ?
				      ORDER BY COALESCE(sent_at, fetched_at) DESC
				      LIMIT 1`,
				args: [mailbox, messageId],
			});
			const row = r.rows[0] as Record<string, unknown> | undefined;
			if (!row) continue;

			const folder = String(row.folder);
			const special = row.special_use ? String(row.special_use) : null;

			if (folder.toUpperCase() === 'INBOX') return null;   // already where it would go
			if (special) return null;                             // Sent/Drafts/Archive/Junk/Trash
			if (/^(inbox[./])?(sent|drafts?|junk|spam|trash|archive|deleted items?)$/i.test(folder)) return null;

			return folder;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * A folder bound to this sender, if any.
 *
 * The exact address wins over the domain: a rule naming one person is a more
 * deliberate statement than one naming everybody at their company.
 *
 * Matching is equality on both, never a substring. A partial domain match is how mail
 * from evil-nairobi-scam.com gets filed alongside a trusted partner.
 */
async function senderFolder(mailbox: string, fromAddr: string): Promise<string | null> {
	const addr = (fromAddr ?? '').trim().toLowerCase();
	if (!addr.includes('@')) return null;
	const domain = addr.split('@')[1] ?? '';

	try {
		const r = await db.execute({
			sql: `SELECT folder, match_type FROM mail_rules
			      WHERE mailbox = ?
			        AND ((match_type = 'address' AND match_value = ?)
			          OR (match_type = 'domain'  AND match_value = ?))
			      ORDER BY CASE match_type WHEN 'address' THEN 0 ELSE 1 END
			      LIMIT 1`,
			args: [mailbox, addr, domain],
		});
		const row = r.rows[0] as Record<string, unknown> | undefined;
		return row ? String(row.folder) : null;
	} catch {
		return null;
	}
}

/** Poll one folder. Returns counts; throws only on a connection-level failure. */
async function pollFolder(
	imap: ImapFlow, box: Mailbox, folder: MailFolder,
	budget: { addressChecksLeft: number },
): Promise<{ fetched: number; inserted: number }> {
	let fetched = 0;
	let inserted = 0;

	const lock = await imap.getMailboxLock(folder.path);
	try {
		const mb = imap.mailbox;
		if (!mb || typeof mb === 'boolean') throw new Error(`${folder.path} did not open`);

		const uidValidity = Number(mb.uidValidity);
		const since = await folderCursor(box.address, folder.path, uidValidity);

		// A message we authored lives in Sent and Drafts; one that arrived lives
		// everywhere else. This is what makes the panel able to render a conversation
		// rather than two disconnected lists.
		const direction = folder.specialUse === '\\Sent' || folder.specialUse === '\\Drafts' ? 'out' : 'in';

		// `n:*` always returns at least the newest message even when nothing is new —
		// an IMAP quirk, not a bug. The unique index absorbs the duplicate.
		let highest = since;
		for await (const msg of imap.fetch(`${since + 1}:*`, { uid: true, source: true }, { uid: true })) {
			if (fetched >= MAX_PER_POLL) break;
			fetched++;
			const uid = Number(msg.uid);
			if (uid > highest) highest = uid;

			const parsed = await simpleParser(msg.source as Buffer);

			const refs = Array.isArray(parsed.references)
				? parsed.references.join(' ')
				: (parsed.references ?? null);

			const spam = readSpamVerdict(parsed.headers as Map<string, unknown> | undefined);

			// Converge with any local row for this message that has no UID.
			//
			// Two things create one: sendFromMailbox records a sent message immediately so
			// it appears without waiting for a poll, and moveMessage re-files a row and
			// clears its UID because UIDs are per-folder and the new one is not known yet.
			// In both cases the server's own copy arrives here carrying the same
			// Message-ID, so without this the panel shows the message twice.
			//
			// This was previously scoped to direction='out', which covered sending and
			// missed moving entirely — so every message moved between folders quietly
			// became two rows, and an unread count could outlive the messages it counted.
			// The UID-bearing copy is the one to keep: it is the one later polls dedupe
			// against.
			if (parsed.messageId) {
				await db.execute({
					sql: `DELETE FROM mail_messages
					      WHERE mailbox = ? AND message_id = ? AND uid IS NULL`,
					args: [box.address, parsed.messageId],
				});
			}

			const rowId = randomUUID();
			const res = await db.execute({
				sql: `INSERT INTO mail_messages
				        (id, mailbox, folder, special_use, direction, uid, uid_validity,
				         message_id, in_reply_to, refs,
				         from_addr, from_name, to_addrs, cc_addrs,
				         subject, body_text, body_html, sent_at, spam_flag, spam_score)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				      ON CONFLICT (mailbox, folder, uid_validity, uid)
				        WHERE uid IS NOT NULL
				      DO NOTHING`,
				args: [
					rowId,
					box.address,
					folder.path,
					folder.specialUse,
					direction,
					uid,
					uidValidity,
					parsed.messageId ?? null,
					parsed.inReplyTo ?? null,
					refs,
					parsed.from?.value?.[0]?.address ?? '',
					parsed.from?.value?.[0]?.name ?? null,
					(parsed.to as any)?.text ?? '',
					(parsed.cc as any)?.text ?? null,
					parsed.subject ?? '',
					parsed.text ?? '',
					parsed.html || null,
					parsed.date ? parsed.date.toISOString() : null,
					spam.flag,
					spam.score,
				],
			});

			// Attachments only on a genuinely new row — on a duplicate they already
			// exist and re-inserting would double them.
			if (Number(res.rowsAffected ?? 0) > 0) {
				inserted++;
				await storeAttachments(rowId, parsed.attachments ?? []);

				// A reply to something already filed follows it there, so a conversation
				// stays whole instead of splitting between Inbox and the folder its
				// earlier messages live in. Only for mail arriving in INBOX — moving a
				// message that the server already filed would fight the server's rules.
				if (direction === 'in' && folder.path.toUpperCase() === 'INBOX') {
					// Thread first, sender second. A reply belongs with its conversation
					// even when its author is bound to a different folder.
					const target =
						(await threadFolder(box.address, parsed.inReplyTo ?? null, refs)) ??
						(await senderFolder(box.address, parsed.from?.value?.[0]?.address ?? ''));
					if (target) {
						const moved = await moveMessage(box, folder.path, uid, target);
						if (!moved.ok) {
							console.warn(`[mailSync] thread-follow to ${target} failed:`, moved.error);
						}
					}
				}

				// Outbound is scanned too, but reports DANGER only.
				//
				// Inbound is the obvious case. Outbound matters for a different reason: if
				// an organizer pastes an address a scammer gave him into a reply, or
				// forwards a drainer link he was sent, this is the last place to catch it
				// before it reaches members. What outbound must NOT do is surface caution
				// -level noise about the operator's own known payout addresses — a warning
				// that fires on his normal behavior is one he learns to dismiss.
				const scanText = `${parsed.subject ?? ''}\n${parsed.text ?? ''}\n${parsed.html ?? ''}`;
				await scanAndRecord(rowId, scanText, budget, {
					dangerOnly: direction === 'out',
					tenantId: box.tenantId,
				});
			}
		}

		await saveCursor(box.address, folder.path, uidValidity, highest, folder.specialUse);
	} finally {
		lock.release();
	}

	return { fetched, inserted };
}

/**
 * Pull new mail for one mailbox, across every folder worth polling.
 *
 * Incremental by UID rather than by date: dates lie (clock skew, delayed relays) and a
 * date window would re-scan or skip. UIDs are monotonic within a UIDVALIDITY epoch, so
 * "everything above the cursor" is exact.
 *
 * Folders are polled in sequence, not in parallel — a single IMAP connection can only
 * have one folder selected at a time, and opening several connections per mailbox is
 * how you get throttled by a shared-hosting server.
 */
export async function pollMailbox(box: Mailbox): Promise<PollResult> {
	const out: PollResult = { mailbox: box.address, fetched: 0, inserted: 0, folders: 0 };
	let imap: ImapFlow | null = null;

	try {
		imap = client(box);
		await imap.connect();

		const folders = await listFolders(imap);
		out.folders = folders.length;

		// One budget for the whole mailbox, so a burst of mail in one folder cannot
		// exhaust the address-check quota for the others.
		const budget = newScanBudget();

		// Drop expired verdicts while we are here, so the cache cannot grow forever
		// without needing a cron of its own.
		await sweepVerdictCache();

		for (const folder of folders) {
			try {
				const r = await pollFolder(imap, box, folder, budget);
				out.fetched += r.fetched;
				out.inserted += r.inserted;
			} catch (err) {
				// One bad folder must not abandon the rest. A server that refuses SELECT on
				// a shared or broken folder is common and not worth failing the mailbox for.
				console.warn(
					`[mailSync] ${box.address} folder ${folder.path}:`,
					err instanceof Error ? err.message : err,
				);
			}
		}
	} catch (err) {
		// Non-fatal by design: one unreachable mailbox must not stop the others.
		out.error = err instanceof Error ? err.message : String(err);
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}

	return out;
}

/**
 * Persist a message's attachments.
 *
 * Failures are swallowed per file: a malformed or oversized attachment must not lose
 * the message it arrived with. Better to have the mail and know a file was dropped
 * than to have neither.
 */
async function storeAttachments(messageId: string, attachments: any[]): Promise<void> {
	for (const att of attachments) {
		try {
			const content: Buffer | undefined = att?.content;
			const size = Number(att?.size ?? content?.length ?? 0);
			const tooBig = !content || size > MAX_ATTACHMENT_BYTES;

			await db.execute({
				sql: `INSERT INTO mail_attachments
				        (id, message_id, filename, content_type, size_bytes, content_b64, skipped)
				      VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [
					randomUUID(),
					messageId,
					String(att?.filename ?? 'attachment'),
					String(att?.contentType ?? 'application/octet-stream'),
					size,
					tooBig ? null : content.toString('base64'),
					tooBig ? 'too_large' : null,
				],
			});
		} catch (err) {
			console.warn('[mailSync] attachment store failed:', err instanceof Error ? err.message : err);
		}
	}
}

export interface SendInput {
	box: Mailbox;
	to: string;
	cc?: string;
	subject: string;
	bodyText: string;
	/** mail_messages.id being replied to. Threads the reply and inherits the subject. */
	replyToId?: string;
}

export interface SendResult {
	ok: boolean;
	id?: string;
	error?: string;
}

/**
 * Send as one mailbox, then record it.
 *
 * Three things here are easy to omit and each one breaks something quietly:
 *
 *  1. In-Reply-To / References — without them a reply lands in the recipient's client
 *     as a new unrelated message, and neither of you can follow the conversation.
 *  2. Appending to the IMAP Sent folder — SMTP delivers to them, not to you. Skip this
 *     and your own phone will never show a message you sent, and your outbound record
 *     exists only inside this app.
 *  3. Recording the row before returning — so the panel shows a thread rather than a
 *     one-sided feed of what other people said.
 */
export async function sendFromMailbox(input: SendInput): Promise<SendResult> {
	const { box, to, cc, subject, bodyText, replyToId } = input;

	if (!box.canSend) {
		return { ok: false, error: `Sending is disabled for ${box.address}.` };
	}
	const cfg = getMailServerConfig();
	if (!cfg) return { ok: false, error: 'MAIL_SMTP_HOST is not set.' };

	// Inherit threading headers from the message being answered.
	let inReplyTo: string | null = null;
	let references: string | null = null;
	if (replyToId) {
		const r = await db.execute({
			sql: `SELECT message_id, refs FROM mail_messages WHERE id = ? AND mailbox = ? LIMIT 1`,
			args: [replyToId, box.address],
		});
		const row = r.rows[0] as Record<string, unknown> | undefined;
		if (row?.message_id) {
			inReplyTo = String(row.message_id);
			// References is the full ancestry: everything the parent cited, plus the parent.
			references = [row.refs ? String(row.refs) : '', inReplyTo].filter(Boolean).join(' ');
		}
	}

	const transport = nodemailer.createTransport({
		host: cfg.smtpHost,
		port: cfg.smtpPort,
		secure: cfg.smtpPort === 465,
		auth: { user: box.address, pass: box.password },
	});

	const id = randomUUID();
	let messageId: string | null = null;
	let sendError: string | null = null;
	let raw: string | Buffer | null = null;
	// Discovered during the Sent-folder append below; used for the placeholder row so
	// both agree on where the message lives.
	let sentFolder = 'Sent';

	try {
		// Build the RFC822 bytes ourselves, then send THOSE, rather than handing fields
		// to sendMail and hoping to get the bytes back.
		//
		// The previous version read info.message, which nodemailer only populates for
		// stream and json transports — over SMTP it is undefined. So `raw` was always
		// null, the Sent-folder append below never executed, and every message sent from
		// this panel was delivered to the recipient and recorded nowhere the operator
		// could see it. Composing first makes the copy we file byte-identical to the
		// copy we sent, which is also what keeps the Message-ID converge in pollFolder
		// working.
		const MailComposer = (await import('nodemailer/lib/mail-composer')).default;

		// Our own Message-ID rather than a generated one, so the header we file, the
		// header we store, and the header the recipient sees are the same string.
		const domain = box.address.split('@')[1] ?? 'localhost';
		const ownMessageId = `<${randomUUID()}@${domain}>`;

		const built: Buffer = await new MailComposer({
			from: `${box.label} <${box.address}>`,
			to,
			cc: cc || undefined,
			subject,
			text: bodyText,
			inReplyTo: inReplyTo ?? undefined,
			references: references ?? undefined,
			messageId: ownMessageId,
		}).compile().build();

		// An explicit envelope: with `raw`, nodemailer does not re-derive recipients from
		// the headers, and a Cc that is not in the envelope silently never gets the mail.
		const rcpt = [to, ...(cc ? cc.split(',') : [])]
			.map((a) => a.trim())
			.filter(Boolean);

		await transport.sendMail({
			envelope: { from: box.address, to: rcpt },
			raw: built,
		});

		messageId = ownMessageId;
		raw = built;
	} catch (err) {
		sendError = err instanceof Error ? err.message : String(err);
	}

	// Record either way. A failed send that leaves no trace is the worst outcome —
	// you would not know whether it went.
	// The placeholder must use the server's REAL Sent path, resolved above during the
	// append. Hardcoding 'Sent' put the row in a folder name this server does not have
	// (it uses INBOX.Sent), so a just-sent message was invisible in every tab until the
	// next poll fetched the server's own copy — which looked exactly like sending being
	// broken. Falls back to 'Sent' only when the append never ran.
	await db.execute({
		sql: `INSERT INTO mail_messages
		        (id, mailbox, folder, special_use, direction, message_id, in_reply_to, refs,
		         from_addr, from_name, to_addrs, cc_addrs,
		         subject, body_text, sent_at, read_at, send_error)
		      VALUES (?, ?, ?, '\\Sent', 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now(), ?)`,
		args: [
			id,
			box.address,
			sentFolder,
			messageId,
			inReplyTo,
			references,
			box.address,
			box.label,
			to,
			cc || null,
			subject,
			bodyText,
			sendError,
		],
	});

	if (sendError) return { ok: false, id, error: sendError };

	// Best-effort Sent copy. If this fails the message HAS still been delivered, so it
	// must not be reported as a failure — it only means your mail client won't show it.
	if (raw) {
		let imap: ImapFlow | null = null;
		try {
			imap = client(box);
			await imap.connect();
			const target = await findSentFolder(imap);
			if (target) {
				sentFolder = target;
				await imap.append(target, raw, ['\\Seen']);

				// Correct the row now that the real path is known. The insert above runs
				// first so a send is recorded even if the append fails, which means the
				// folder starts as a fallback and is fixed here — rather than leaving the
				// message filed under a folder name this server does not have.
				await db.execute({
					sql: `UPDATE mail_messages SET folder = ? WHERE id = ?`,
					args: [sentFolder, id],
				});
			}
		} catch (err) {
			// Delivered either way, so this is not a send failure — but it IS the thing
			// that hid a bug for a day, so it gets logged rather than swallowed.
			console.warn(
				`[mailSync] ${box.address}: sent but could not file a Sent copy:`,
				err instanceof Error ? err.message : err,
			);
		} finally {
			try { await imap?.logout(); } catch { /* already gone */ }
		}
	}

	return { ok: true, id };
}

export interface DraftInput {
	box: Mailbox;
	/** Existing draft id to replace. Omit to create a new one. */
	draftId?: string;
	to: string;
	cc?: string;
	subject: string;
	bodyText: string;
	replyToId?: string;
}

/**
 * Save a draft to the mailbox's IMAP Drafts folder, and remember which server message
 * it became.
 *
 * IMAP has no concept of editing a message in place — a "changed draft" is an append
 * of the new version plus a delete of the old one. Without the delete, every keystroke
 * batch would leave another copy behind and the Drafts folder would fill with near
 * duplicates. mail_drafts.imap_uid is what makes the delete possible.
 *
 * Order matters: append first, delete second. If the append fails, the previous
 * version is still there. Deleting first would risk losing the draft entirely on a
 * dropped connection, and a lost draft is worse than a duplicated one.
 */
export async function saveDraft(input: DraftInput): Promise<{ ok: boolean; id?: string; error?: string }> {
	const { box, draftId, to, cc, subject, bodyText, replyToId } = input;

	const cfg = getMailServerConfig();
	if (!cfg) return { ok: false, error: 'MAIL_IMAP_HOST is not set.' };

	// Previous server copy, if this is an edit.
	let prevUid: number | null = null;
	let prevFolder: string | null = null;
	if (draftId) {
		const r = await db.execute({
			sql: `SELECT imap_uid, imap_folder FROM mail_drafts WHERE id = ? AND mailbox = ? LIMIT 1`,
			args: [draftId, box.address],
		});
		const row = r.rows[0] as Record<string, unknown> | undefined;
		prevUid = row?.imap_uid != null ? Number(row.imap_uid) : null;
		prevFolder = row?.imap_folder ? String(row.imap_folder) : null;
	}

	const id = draftId ?? randomUUID();
	let imap: ImapFlow | null = null;
	let newUid: number | null = null;
	let targetFolder: string | null = null;

	try {
		// Build the RFC822 bytes without sending. MailComposer is nodemailer's own
		// message builder, so a draft is byte-identical in shape to what sending
		// would produce.
		const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
		const raw: Buffer = await new MailComposer({
			from: `${box.label} <${box.address}>`,
			to,
			cc: cc || undefined,
			subject: subject || '(no subject)',
			text: bodyText,
		}).compile().build();

		imap = client(box);
		await imap.connect();

		targetFolder = await findFolderBySpecialUse(imap, '\\Drafts', /^(inbox[./])?drafts?$/i);
		if (!targetFolder) throw new Error('No Drafts folder on this mailbox');

		const appended = await imap.append(targetFolder, raw, ['\\Draft', '\\Seen']);
		newUid = (appended as { uid?: number } | undefined)?.uid ?? null;

		// Remove the superseded copy only after the new one is safely stored.
		if (prevUid && prevFolder) {
			try {
				const lock = await imap.getMailboxLock(prevFolder);
				try { await imap.messageDelete({ uid: String(prevUid) }, { uid: true }); }
				finally { lock.release(); }
			} catch {
				// A leftover duplicate is untidy but harmless; losing the draft is not.
			}
		}
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}

	await db.execute({
		sql: `INSERT INTO mail_drafts
		        (id, mailbox, imap_uid, imap_folder, to_addrs, cc_addrs, subject, body_text, reply_to_id, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now())
		      ON CONFLICT (id) DO UPDATE
		        SET imap_uid = EXCLUDED.imap_uid,
		            imap_folder = EXCLUDED.imap_folder,
		            to_addrs = EXCLUDED.to_addrs,
		            cc_addrs = EXCLUDED.cc_addrs,
		            subject = EXCLUDED.subject,
		            body_text = EXCLUDED.body_text,
		            reply_to_id = EXCLUDED.reply_to_id,
		            updated_at = now()`,
		args: [id, box.address, newUid, targetFolder, to, cc || null, subject, bodyText, replyToId ?? null],
	});

	return { ok: true, id };
}

/** Discard a draft locally and on the server. */
export async function deleteDraft(box: Mailbox, draftId: string): Promise<void> {
	const r = await db.execute({
		sql: `SELECT imap_uid, imap_folder FROM mail_drafts WHERE id = ? AND mailbox = ? LIMIT 1`,
		args: [draftId, box.address],
	});
	const row = r.rows[0] as Record<string, unknown> | undefined;

	if (row?.imap_uid && row?.imap_folder) {
		let imap: ImapFlow | null = null;
		try {
			imap = client(box);
			await imap.connect();
			const lock = await imap.getMailboxLock(String(row.imap_folder));
			try { await imap.messageDelete({ uid: String(row.imap_uid) }, { uid: true }); }
			finally { lock.release(); }
		} catch {
			// Local delete still proceeds — the panel should not keep showing a draft
			// the operator discarded just because the server was unreachable.
		} finally {
			try { await imap?.logout(); } catch { /* already gone */ }
		}
	}

	await db.execute({
		sql: `DELETE FROM mail_drafts WHERE id = ? AND mailbox = ?`,
		args: [draftId, box.address],
	});
}

/**
 * Move one message to another folder, on the server and in our copy.
 *
 * IMAP UIDs are per-folder, so a moved message gets a NEW uid in its destination. We
 * therefore clear the uid locally rather than guess it: the next poll of the target
 * folder inserts the real row, and the unique index keeps that from duplicating. The
 * row stays visible in the meantime because its folder has already been updated.
 */
export async function moveMessage(
	box: Mailbox, fromFolder: string, uid: number, toFolder: string,
): Promise<{ ok: boolean; error?: string }> {
	let imap: ImapFlow | null = null;
	try {
		imap = client(box);
		await imap.connect();

		const lock = await imap.getMailboxLock(fromFolder);
		try {
			await imap.messageMove({ uid: String(uid) }, toFolder, { uid: true });
		} finally {
			lock.release();
		}

		await db.execute({
			sql: `UPDATE mail_messages
			      SET folder = ?, special_use = NULL, uid = NULL
			      WHERE mailbox = ? AND folder = ? AND uid = ?`,
			args: [toFolder, box.address, fromFolder, uid],
		});

		// The destination's cursor must not skip the message we just put there. Clearing
		// the cursor makes the next poll re-read that folder from the start, which the
		// unique index makes safe.
		await db.execute({
			sql: `DELETE FROM mail_folder_state WHERE mailbox = ? AND folder = ?`,
			args: [box.address, toFolder],
		});

		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}
}

/**
 * Delete = move to Trash. Never expunge.
 *
 * The operator clicking a small button next to a message must not be able to destroy
 * it. Trash is polled like every other folder, so a deleted message stays readable and
 * can be moved back. Actual destruction is the mail server's retention policy to apply,
 * not a side effect of a UI click.
 *
 * If the mailbox genuinely has no Trash folder, the message is flagged \Deleted rather
 * than expunged — still recoverable until the server cleans up.
 */
export async function deleteMessage(
	box: Mailbox, folder: string, uid: number,
): Promise<{ ok: boolean; error?: string }> {
	let imap: ImapFlow | null = null;
	try {
		imap = client(box);
		await imap.connect();
		const trash = await findFolderBySpecialUse(imap, '\\Trash', /^(inbox[./])?(trash|deleted items?)$/i);
		try { await imap.logout(); } catch { /* ignore */ }
		imap = null;

		if (trash && trash !== folder) return moveMessage(box, folder, uid, trash);

		// No Trash, or already in it: flag, do not expunge.
		imap = client(box);
		await imap.connect();
		const lock = await imap.getMailboxLock(folder);
		try {
			await imap.messageFlagsAdd({ uid: String(uid) }, ['\\Deleted'], { uid: true });
		} finally {
			lock.release();
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}
}

/**
 * Permanently destroy one message: flag \Deleted, then expunge that UID.
 *
 * This is the only operation in this file that ends something. Deliberately narrow:
 *
 *  - The caller must already have established that the message is in Trash. Destroying
 *    from an ordinary folder would make a single mis-click unrecoverable, which is the
 *    exact thing Delete-to-Trash exists to prevent.
 *  - One UID at a time. There is no bulk form and there should not be one — the cost of
 *    a wrong click must stay proportional to one message.
 *  - expunge is scoped with `uid`, so it removes THAT message rather than every message
 *    in the folder carrying a \Deleted flag. An unscoped expunge would destroy mail the
 *    operator never selected, including anything a previous failed delete had flagged.
 *
 * The local row is removed too; mail_attachments and mail_threats cascade from it.
 */
export async function destroyMessage(
	box: Mailbox, folder: string, uid: number,
): Promise<{ ok: boolean; error?: string }> {
	let imap: ImapFlow | null = null;
	try {
		imap = client(box);
		await imap.connect();

		const lock = await imap.getMailboxLock(folder);
		try {
			await imap.messageDelete({ uid: String(uid) }, { uid: true });
		} finally {
			lock.release();
		}

		await db.execute({
			sql: `DELETE FROM mail_messages WHERE mailbox = ? AND folder = ? AND uid = ?`,
			args: [box.address, folder, uid],
		});

		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}
}

/** Create a folder the operator can file mail into. */
export async function createMailFolder(
	box: Mailbox, name: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
	const clean = name.trim();
	// Slashes and dots are IMAP hierarchy separators depending on the server; letting
	// them through would silently create nested folders the operator did not ask for.
	if (!clean || /[./\\]/.test(clean)) {
		return { ok: false, error: 'Use a simple name without slashes or dots.' };
	}

	let imap: ImapFlow | null = null;
	try {
		imap = client(box);
		await imap.connect();

		// cPanel/Dovecot nests user folders under INBOX; creating a top-level folder on
		// such a server either fails or lands somewhere the client will not show.
		const list = await imap.list();
		const nested = list.some((f) => /^INBOX[./]/i.test(f.path));
		const sep = list.find((f) => f.delimiter)?.delimiter ?? '.';
		const path = nested ? `INBOX${sep}${clean}` : clean;

		await imap.mailboxCreate(path);
		return { ok: true, path };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		try { await imap?.logout(); } catch { /* already gone */ }
	}
}

/**
 * Find a folder by its SPECIAL-USE flag, falling back to a name pattern.
 *
 * Servers disagree on names — 'Sent' vs 'Sent Items' vs 'INBOX.Sent' — so the flag is
 * authoritative where it exists and the regex is the fallback for servers that don't
 * advertise SPECIAL-USE at all.
 */
async function findFolderBySpecialUse(
	imap: ImapFlow, flag: string, namePattern: RegExp,
): Promise<string | null> {
	try {
		const list = await imap.list();
		const flagged = list.find((f) => (f as { specialUse?: string }).specialUse === flag);
		if (flagged) return flagged.path;
		return list.find((f) => namePattern.test(f.path))?.path ?? null;
	} catch {
		return null;
	}
}

/**
 * Locate the Sent folder. Servers disagree — 'Sent', 'Sent Items', 'INBOX.Sent' —
 * so prefer the \Sent special-use flag and fall back to name matching.
 */
async function findSentFolder(imap: ImapFlow): Promise<string | null> {
	try {
		const list = await imap.list();
		const flagged = list.find((f) => (f as { specialUse?: string }).specialUse === '\\Sent');
		if (flagged) return flagged.path;
		const named = list.find((f) => /^(inbox[./])?sent(\s?items)?$/i.test(f.path));
		return named?.path ?? null;
	} catch {
		return null;
	}
}
