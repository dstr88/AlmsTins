/**
 * mailboxWindows.client.ts — behavior for the /admin mail hero.
 *
 * Markup lives in MailboxWindows.astro, presentation in MailboxWindows.css. This
 * file touches the DOM only through classes and data attributes, with one
 * exception: the drag handle writes an explicit pixel height, because a resizable
 * panel's size IS state and there is no class that can express "371px".
 */

import { escapeHtml } from '@/lib/escapeHtml';

const DEFAULT_OPEN_PX = 320;
const MIN_PX = 90;
const heightKey = (mb: string) => `mh:h:${mb}`;

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const panels = () => Array.from(document.querySelectorAll<HTMLElement>('.mh'));

const fmt = (v: unknown) =>
	v ? new Date(String(v)).toLocaleString('en-US', {
		month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
	}) : '';

const fmtSize = (n: number) =>
	n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
	: n >= 1024 ? `${Math.round(n / 1024)} KB`
	: `${n} B`;

const mailboxOf = (el: Element) => el.closest<HTMLElement>('.mh')!.dataset.mailbox!;
const activeFolder = (panel: HTMLElement) =>
	q<HTMLElement>(panel, '.mh__rf--on')?.dataset.folder ?? '';

function setStatus(panel: HTMLElement, msg: string) {
	const el = q<HTMLElement>(panel, '.mh__status');
	if (el) el.textContent = msg;
}

// ── Open / close ──────────────────────────────────────────────────────────
function setOpen(panel: HTMLElement, open: boolean) {
	panel.classList.toggle('mh--open', open);
	q<HTMLElement>(panel, '.mh__bar')?.setAttribute('aria-expanded', String(open));
	if (!open) return;

	const body = q<HTMLElement>(panel, '.mh__body')!;
	const saved = Number(localStorage.getItem(heightKey(panel.dataset.mailbox!)) || 0);
	body.style.height = `${saved > MIN_PX ? saved : DEFAULT_OPEN_PX}px`;
	if (!body.dataset.loaded) load(panel);
}

document.addEventListener('click', (e) => {
	const bar = (e.target as Element).closest<HTMLElement>('.mh__bar');
	// Buttons inside the bar act on their own; only bare bar clicks toggle.
	if (!bar || (e.target as Element).closest('.mh__btn')) return;
	const panel = bar.closest<HTMLElement>('.mh')!;
	setOpen(panel, !panel.classList.contains('mh--open'));
});

document.addEventListener('keydown', (e) => {
	const bar = (e.target as Element).closest<HTMLElement>('.mh__bar');
	if (!bar || (e.key !== 'Enter' && e.key !== ' ')) return;
	e.preventDefault();
	const panel = bar.closest<HTMLElement>('.mh')!;
	setOpen(panel, !panel.classList.contains('mh--open'));
});

// ── Drag to resize ────────────────────────────────────────────────────────
// Pointer events rather than mouse events so a trackpad, touch screen and stylus
// all work from the same code path.
let drag: { panel: HTMLElement; startY: number; startH: number } | null = null;

document.addEventListener('pointerdown', (e) => {
	const grip = (e.target as Element).closest<HTMLElement>('.mh__grip');
	if (!grip) return;
	const panel = grip.closest<HTMLElement>('.mh')!;
	const body = q<HTMLElement>(panel, '.mh__body')!;
	drag = { panel, startY: e.clientY, startH: body.getBoundingClientRect().height };
	grip.setPointerCapture(e.pointerId);
	e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
	if (!drag) return;
	const body = q<HTMLElement>(drag.panel, '.mh__body')!;
	const next = Math.max(MIN_PX, drag.startH + (e.clientY - drag.startY));
	body.style.height = `${next}px`;
});

document.addEventListener('pointerup', () => {
	if (!drag) return;
	const body = q<HTMLElement>(drag.panel, '.mh__body')!;
	localStorage.setItem(heightKey(drag.panel.dataset.mailbox!), String(Math.round(body.getBoundingClientRect().height)));
	drag = null;
});

// Keyboard resize, so the grip is not mouse-only.
document.addEventListener('keydown', (e) => {
	const grip = (e.target as Element).closest<HTMLElement>('.mh__grip');
	if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
	e.preventDefault();
	const panel = grip.closest<HTMLElement>('.mh')!;
	const body = q<HTMLElement>(panel, '.mh__body')!;
	const next = Math.max(MIN_PX, body.getBoundingClientRect().height + (e.key === 'ArrowDown' ? 40 : -40));
	body.style.height = `${next}px`;
	localStorage.setItem(heightKey(panel.dataset.mailbox!), String(Math.round(next)));
});

// ── Tabs ──────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
	const tab = (e.target as Element).closest<HTMLElement>('.mh__rf');
	if (!tab) return;
	const panel = tab.closest<HTMLElement>('.mh')!;
	panel.querySelectorAll('.mh__rf').forEach((t) => t.classList.remove('mh__rf--on'));
	tab.classList.add('mh__rf--on');
	load(panel);
});

// ── Load + render ─────────────────────────────────────────────────────────
async function load(panel: HTMLElement) {
	const list = q<HTMLElement>(panel, '.mh__list')!;
	const body = q<HTMLElement>(panel, '.mh__body')!;
	const mailbox = panel.dataset.mailbox!;
	const folder = activeFolder(panel);

	list.setAttribute('aria-busy', 'true');
	try {
		const res = await fetch(`/api/admin/mail?mailbox=${encodeURIComponent(mailbox)}&folder=${encodeURIComponent(folder)}`);
		const data = await res.json();
		if (!data.ok) throw new Error(data.error ?? 'Could not load');

		body.dataset.loaded = '1';
		// Drafts shows composed drafts AND anything sitting in the IMAP Drafts folder,
		// so it renders both lists rather than choosing one.
		list.innerHTML = folder === '__drafts__'
			? renderDrafts(data) + renderMessages(data, mailbox)
			: renderMessages(data, mailbox);
		if (!list.innerHTML) list.innerHTML = '<p class="mh__empty">Nothing here.</p>';

		// Rebuild the Move-to menu for THIS folder: the one being viewed is excluded from
		// its own menu, so the list differs per folder. Without this the menu opens empty,
		// which looks like a broken control rather than a missing call.
		fillMoveMenu(panel, data);

		// A selection does not survive a re-render — the rows it referred to are gone.
		const all = q<HTMLInputElement>(panel, '.mh__bulkall');
		if (all) all.checked = false;
		syncBulkBar(panel);
	} catch (err) {
		list.innerHTML = `<p class="mh__empty">${escapeHtml(err instanceof Error ? err.message : 'Could not load')}</p>`;
	} finally {
		list.setAttribute('aria-busy', 'false');
	}
}

/**
 * Defang the URLs of flagged domains inside a message body.
 *
 *   https://evil-drainer.com/claim  →  hxxps://evil-drainer[.]com/claim
 *
 * The body is escaped and therefore not clickable, so this is not about stopping a
 * click in this panel. It is about what happens NEXT: a live-looking URL gets copied,
 * pasted into an address bar and followed. Defanged, it cannot be followed without
 * being deliberately repaired first — which is exactly the moment of thought a drainer
 * link is designed to skip.
 *
 * Only flagged domains are defanged. Mangling every link would make legitimate mail
 * unreadable and teach the reader to ignore the mangling.
 */
function defangFlagged(body: string, threats: any[]): string {
	const domains = threats
		.filter((t) => t.kind === 'url' && t.severity === 'danger')
		.map((t) => String(t.value).toLowerCase());
	if (!domains.length) return body;

	let out = body;
	for (const domain of domains) {
		// Escape for RegExp — a dot in a hostname is a literal, not "any character".
		const safe = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		out = out.replace(
			new RegExp(`https?://(www\\.)?${safe}`, 'gi'),
			(match) => match.replace(/^http/i, 'hxxp').replace(/\./g, '[.]'),
		);
		out = out.replace(new RegExp(`\\b${safe}\\b`, 'gi'), domain.replace(/\./g, '[.]'));
	}
	return out;
}

/** First line of the body, for the one-line preview next to the subject. */
const snippet = (t: string) => {
	const line = String(t ?? '').replace(/\s+/g, ' ').trim();
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
};

/**
 * The "Move to…" control for one message.
 *
 * Rendered per message rather than as one shared control because the current folder is
 * excluded from its own list — offering "move to where it already is" is a no-op that
 * reads as a broken action.
 */
/**
 * Is this message already in Trash?
 *
 * Decides which of the two removal buttons a row gets: Delete (reversible, files it in
 * Trash) everywhere else, Destroy (permanent) only here. One button per row, so there
 * is never an irreversible action sitting next to a reversible one that looks like it.
 */
function inJunk(m: any): boolean {
	return /^(inbox[./])?(junk|spam)$/i.test(String(m.folder ?? ''));
}

function inTrash(m: any): boolean {
	return /^(inbox[./])?(trash|deleted items?)$/i.test(String(m.folder ?? ''));
}

function folderOptions(data: any, m: any): string {
	const folders = (data.folders ?? []) as Array<{ path: string; specialUse: string | null }>;
	const others = folders.filter((f) => f.path !== m.folder);
	if (!others.length) return '';

	const label = (f: { path: string; specialUse: string | null }) =>
		f.path.toUpperCase() === 'INBOX' ? 'Inbox'
		: f.specialUse === '\\Sent' ? 'Sent'
		: f.specialUse === '\\Archive' ? 'Archive'
		: f.path.split(/[./]/).pop() || f.path;

	return `<select class="mh__btn mhc__move" data-id="${escapeHtml(m.id)}" aria-label="Move to folder">
		<option value="">Move to…</option>
		${others.map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(label(f))}</option>`).join('')}
	</select>`;
}

function renderMessages(data: any, mailbox: string): string {
	return (data.messages as any[]).map((m) => {
		const out = m.direction === 'out';
		const who = out
			? `To: ${escapeHtml(m.to_addrs)}`
			: escapeHtml(m.from_name || m.from_addr);
		const unread = !out && !m.read_at;
		const atts = (m.attachments ?? []) as any[];

		// Two independent verdicts, shown separately because they mean different things.
		// spam_flag is the MAIL SERVER's judgment of the message; threat_level is the
		// WALLET CHECKER's judgment of the addresses and links inside it. A message can
		// be either, both, or neither.
		// "Junk" throughout, matching the folder name and IMAP's own \Junk flag. Spam and
		// junk are the same concept under different vendor names, and using both words in
		// one panel invites the reader to hunt for a distinction that does not exist.
		//
		// The badge is suppressed inside the Junk folder itself: everything there is junk
		// by definition, so marking it says nothing. What the badge is FOR is the message
		// that scored high and was delivered to the Inbox anyway — borderline mail that
		// reached you, which is invisible without it.
		const spam = Boolean(m.spam_flag) && !inJunk(m);
		const spamScore = m.spam_score == null ? '' : ` ${Number(m.spam_score).toFixed(1)}`;
		const threats = (m.threats ?? []) as any[];
		const danger = m.threat_level === 'danger';
		const caution = m.threat_level === 'warning';

		const body = defangFlagged(String(m.body_text ?? ''), threats);

		return `
			<div class="mhc${unread ? ' mhc--unread' : ''}${out ? ' mhc--out' : ''}${spam || danger ? ' mhc--spam' : ''}${caution && !danger ? ' mhc--caution' : ''}" data-id="${escapeHtml(m.id)}" data-from="${escapeHtml(m.from_addr)}" draggable="true">
				<div class="mhc__row">
					<input class="mhc__chk" type="checkbox" data-id="${escapeHtml(m.id)}" aria-label="Select message" />
					${spam ? `<span class="mhc__scam" title="Your mail server scored this as junk but delivered it anyway">⚠ JUNK${escapeHtml(spamScore)}</span>` : ''}
					${danger ? '<span class="mhc__scam" title="A wallet address or link in this message is on a scam list">⚠ SCAM</span>' : ''}
					${caution && !danger ? '<span class="mhc__caution" title="Something here is worth checking before acting on it">⚠ CHECK</span>' : ''}
					<span class="mhc__who">${who}</span>
					<span class="mhc__subj">${escapeHtml(m.subject || '(no subject)')}${
						body ? ` <span class="mhc__snip">— ${escapeHtml(snippet(body))}</span>` : ''
					}</span>
					${atts.length ? '<span class="mhc__clip">📎</span>' : ''}
					<span class="mhc__when">${escapeHtml(fmt(m.sent_at))}</span>
				</div>
				<div class="mhc__open">
					${threats.length ? `<div class="mhc__threats${threats.every((t: any) => t.severity === 'known') ? ' mhc__threats--ok' : ''}">
						<div class="mhc__threathead">${
							threats.every((t: any) => t.severity === 'known')
								? 'Recognised address:'
								: 'Checked against the scam lists — verify before acting on this:'
						}</div>
						${threats.map((t: any) => `<div class="mhc__threat mhc__threat--${escapeHtml(t.severity)}">
							<code>${escapeHtml(t.kind === 'url' ? String(t.value).replace(/\./g, '[.]') : t.value)}</code> <span>${escapeHtml(t.reason)}</span>
						</div>`).join('')}
					</div>` : ''}
					${!String(m.body_text ?? '').trim() && m.has_html
						? `<p class="mhc__nobody">This message was sent as HTML only. Open it to read it — it opens sandboxed, with scripts and remote images blocked.</p>`
						: `<p class="mhc__body">${escapeHtml(body)}</p>`}
					${m.has_html
						? `<p class="mhc__htmlrow"><a class="mh__btn" href="/api/admin/mail/html?id=${encodeURIComponent(String(m.id))}" target="_blank" rel="noopener noreferrer">Open original</a></p>`
						: ''}
					${atts.length ? `<div class="mhc__atts">${atts.map((a: any) =>
						a.skipped
							? `<span class="mhc__att mhc__att--skip">📎 ${escapeHtml(a.filename)} (too large)</span>`
							: `<a class="mhc__att" href="/api/admin/mail/attachment?id=${encodeURIComponent(String(a.id))}" download>📎 ${escapeHtml(a.filename)} <span>${escapeHtml(fmtSize(Number(a.size_bytes ?? 0)))}</span></a>`
					).join('')}</div>` : ''}
					${m.send_error ? `<p class="mhc__err">Not sent: ${escapeHtml(m.send_error)}</p>` : ''}
					<div class="mhc__acts">
						${data.canSend && !out ? `<button class="mh__btn mhc__reply" type="button" data-id="${escapeHtml(m.id)}">Reply</button>` : ''}
						${!out ? (unread
							? `<button class="mh__btn mhc__read" type="button" data-id="${escapeHtml(m.id)}" data-mailbox="${escapeHtml(mailbox)}">Mark read</button>`
							: `<button class="mh__btn mhc__unread" type="button" data-id="${escapeHtml(m.id)}" data-mailbox="${escapeHtml(mailbox)}">Mark unread</button>`) : ''}
						${folderOptions(data, m)}
						${inTrash(m)
							? `<button class="mh__btn mhc__destroy" type="button" data-id="${escapeHtml(m.id)}" data-subject="${escapeHtml(m.subject || '(no subject)')}" title="Delete permanently — cannot be undone">Destroy</button>`
							: `<button class="mh__btn mhc__del" type="button" data-id="${escapeHtml(m.id)}" title="Move to Trash">Delete</button>`}
					</div>
				</div>
			</div>`;
	}).join('');
}

function renderDrafts(data: any): string {
	return (data.drafts as any[]).map((d) => `
		<div class="mhc mhc--out" data-draft="${escapeHtml(d.id)}">
			<div class="mhc__row">
				<span class="mhc__who">To: ${escapeHtml(d.to_addrs || '(no recipient)')}</span>
				<span class="mhc__subj">${escapeHtml(d.subject || '(no subject)')}${
					d.body_text ? ` <span class="mhc__snip">— ${escapeHtml(snippet(d.body_text))}</span>` : ''
				}</span>
				<span class="mhc__when">${escapeHtml(fmt(d.updated_at))}</span>
			</div>
			<div class="mhc__open">
				<p class="mhc__body">${escapeHtml(d.body_text)}</p>
				<div class="mhc__acts">
					<button class="mh__btn mhc__editdraft" type="button" data-draft="${escapeHtml(d.id)}">Edit</button>
					<button class="mh__btn mhc__deldraft" type="button" data-draft="${escapeHtml(d.id)}">Discard</button>
				</div>
			</div>
		</div>`).join('');
}

// Click a row to open it; clicking the open one again closes it. Buttons inside the
// expanded area act on their own and must not toggle the row shut underneath them.
document.addEventListener('click', (e) => {
	const row = (e.target as Element).closest<HTMLElement>('.mhc');
	if (!row || (e.target as Element).closest('.mh__btn, .mhc__att, .mhc__chk')) return;
	const wasOpen = row.classList.contains('mhc--sel');
	row.closest('.mh__list')?.querySelectorAll('.mhc--sel').forEach((r) => r.classList.remove('mhc--sel'));
	if (!wasOpen) {
		row.classList.add('mhc--sel');
		// Opening a message marks it read, because that is what opening a message means.
		// Requiring a separate "Mark read" click made the panel disagree with the person
		// using it: they had plainly read it, and the count still said otherwise.
		void markRead(row);
	}
});

/**
 * Mark one message read, in the database and in the panel.
 *
 * No-ops when the row is already read, so re-opening a message costs nothing and
 * cannot drive the badge below the truth.
 */
async function markRead(row: HTMLElement): Promise<void> {
	if (!row.classList.contains('mhc--unread')) return;
	const panel = row.closest<HTMLElement>('.mh')!;
	const id = row.dataset.id;
	if (!id) return;

	// Cleared first so a second click cannot fire a second request while this one is
	// still in flight.
	row.classList.remove('mhc--unread');
	row.querySelector('.mhc__read')?.remove();
	decrementUnread(panel);

	try {
		const res = await fetch('/api/admin/mail', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, mailbox: panel.dataset.mailbox }),
		});
		if (!res.ok) throw new Error(String(res.status));
	} catch {
		// Put it back rather than showing read state the server does not agree with.
		row.classList.add('mhc--unread');
		setStatus(panel, 'Could not mark read');
	}
}

// ── Compose / reply / drafts ──────────────────────────────────────────────
/**
 * Fill the To/Cc completions for one panel, once.
 *
 * Loaded lazily on first compose rather than at page load: most visits never open the
 * composer, and a mailbox with years of history is a query worth not running.
 *
 * Each option's value is the bare address, because that is what the field must submit.
 * The label carries the name, so typing "Don" matches a person whose address is
 * donnie@almstins.com even though the two strings share only three letters.
 */
async function loadContacts(panel: HTMLElement): Promise<void> {
	const list = panel.querySelector<HTMLDataListElement>('datalist');
	if (!list || list.dataset.loaded) return;
	list.dataset.loaded = '1';

	try {
		const res = await fetch(`/api/admin/mail/contacts?mailbox=${encodeURIComponent(panel.dataset.mailbox!)}`);
		const data = await res.json();
		if (!data.ok) return;

		list.innerHTML = '';
		for (const c of data.contacts as Array<{ address: string; name: string | null }>) {
			const opt = document.createElement('option');
			opt.value = c.address;
			// textContent, never innerHTML: a display name is chosen by whoever emailed
			// you, and this is the admin origin.
			if (c.name) opt.textContent = `${c.name} — ${c.address}`;
			list.appendChild(opt);
		}
	} catch {
		// No completions is a smaller problem than a broken composer; allow a retry.
		delete list.dataset.loaded;
	}
}

function openForm(panel: HTMLElement, v: { to?: string; subject?: string; body?: string; replyToId?: string; draftId?: string } = {}) {
	const form = q<HTMLFormElement>(panel, '.mh__form')!;
	const dlg = q<HTMLDialogElement>(panel, '.mh__dlg')!;
	void loadContacts(panel);
	// showModal() rather than an .open class: focus trapping, an inert background
	// and Escape all come from the browser.
	if (!dlg.open) dlg.showModal();
	q<HTMLInputElement>(form, '.mh__to')!.value = v.to ?? '';
	q<HTMLInputElement>(form, '.mh__subj')!.value = v.subject ?? '';
	q<HTMLTextAreaElement>(form, '.mh__text')!.value = v.body ?? '';
	q<HTMLInputElement>(form, '.mh__replyto')!.value = v.replyToId ?? '';
	q<HTMLInputElement>(form, '.mh__draftid')!.value = v.draftId ?? '';
	q<HTMLElement>(form, '.mh__formstatus')!.textContent = '';
	q<HTMLTextAreaElement>(form, '.mh__text')!.focus();
}

document.addEventListener('click', (e) => {
	const t = e.target as Element;

	const compose = t.closest<HTMLElement>('.mh__compose');
	if (compose) {
		// No need to expand the panel first — the modal stands on its own, so New
		// works from a collapsed bar.
		openForm(compose.closest<HTMLElement>('.mh')!);
		return;
	}

	const cancel = t.closest<HTMLElement>('.mh__cancel');
	if (cancel) {
		cancel.closest<HTMLDialogElement>('.mh__dlg')?.close();
		return;
	}

	const reply = t.closest<HTMLElement>('.mhc__reply');
	if (reply) {
		const panel = reply.closest<HTMLElement>('.mh')!;
		const card = reply.closest<HTMLElement>('.mhc')!;
		const subjEl = q<HTMLElement>(card, '.mhc__subj');
		// Subject only — strip the preview snippet that shares the element.
		const snip = q<HTMLElement>(card, '.mhc__snip')?.textContent ?? '';
		const subj = (subjEl?.textContent ?? '').replace(snip, '').trim();
		openForm(panel, {
			// data-from carries the real address; the visible row shows a display name.
			to: card.dataset.from || '',
			subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
			replyToId: reply.dataset.id,
		});
		return;
	}

	const edit = t.closest<HTMLElement>('.mhc__editdraft');
	if (edit) {
		const panel = edit.closest<HTMLElement>('.mh')!;
		const card = edit.closest<HTMLElement>('.mhc')!;
		openForm(panel, {
			to: (q<HTMLElement>(card, '.mhc__who')?.textContent ?? '').replace(/^To:\s*/, '').trim(),
			subject: (q<HTMLElement>(card, '.mhc__subj')?.textContent ?? '')
				.replace(q<HTMLElement>(card, '.mhc__snip')?.textContent ?? '', '').trim(),
			body: q<HTMLElement>(card, '.mhc__body')?.textContent ?? '',
			draftId: edit.dataset.draft,
		});
		return;
	}
});

// Mark unread — the inverse of opening a message, for when it needs to stay on the
// list as something still to deal with.
document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mhc__unread');
	if (!btn?.dataset.id) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	const card = btn.closest<HTMLElement>('.mhc');
	btn.disabled = true;
	try {
		const res = await fetch('/api/admin/mail', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: btn.dataset.id, mailbox: btn.dataset.mailbox, read: false }),
		});
		if (!res.ok) throw new Error(String(res.status));
		card?.classList.add('mhc--unread');
		// Collapse it too: leaving an unread message open on screen contradicts the
		// state that was just asked for.
		card?.classList.remove('mhc--sel');
		incrementUnread(panel);
		btn.remove();
	} catch {
		btn.disabled = false;
		setStatus(panel, 'Could not mark unread');
	}
});

// Mark read
document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mhc__read');
	if (!btn?.dataset.id) return;
	btn.disabled = true;
	try {
		const res = await fetch('/api/admin/mail', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: btn.dataset.id, mailbox: btn.dataset.mailbox }),
		});
		if (!res.ok) throw new Error();
		const card = btn.closest<HTMLElement>('.mhc');
		card?.classList.remove('mhc--unread');
		btn.remove();
		decrementUnread(btn.closest<HTMLElement>('.mh')!);
	} catch { btn.disabled = false; }
});

// Discard draft
document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mhc__deldraft');
	if (!btn?.dataset.draft) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	btn.disabled = true;
	try {
		await fetch('/api/admin/mail/draft', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: mailboxOf(btn), draftId: btn.dataset.draft }),
		});
		load(panel);
	} catch { btn.disabled = false; }
});

// Save draft
document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mh__savedraft');
	if (!btn) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	const form = btn.closest<HTMLFormElement>('.mh__form')!;
	const statusEl = q<HTMLElement>(form, '.mh__formstatus')!;
	btn.disabled = true;
	statusEl.textContent = 'Saving…';
	try {
		const res = await fetch('/api/admin/mail/draft', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				mailbox: panel.dataset.mailbox,
				draftId: q<HTMLInputElement>(form, '.mh__draftid')!.value || undefined,
				to: q<HTMLInputElement>(form, '.mh__to')!.value.trim(),
				cc: q<HTMLInputElement>(form, '.mh__cc')!.value.trim(),
				subject: q<HTMLInputElement>(form, '.mh__subj')!.value.trim(),
				body: q<HTMLTextAreaElement>(form, '.mh__text')!.value,
				replyToId: q<HTMLInputElement>(form, '.mh__replyto')!.value || undefined,
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? 'Save failed');
		q<HTMLInputElement>(form, '.mh__draftid')!.value = data.id;
		statusEl.textContent = 'Saved to Drafts.';
	} catch (err) {
		statusEl.textContent = err instanceof Error ? err.message : 'Save failed';
	} finally {
		btn.disabled = false;
	}
});

// Send
document.addEventListener('submit', async (e) => {
	const form = (e.target as Element).closest<HTMLFormElement>('.mh__form');
	if (!form) return;
	e.preventDefault();

	const panel = form.closest<HTMLElement>('.mh')!;
	const statusEl = q<HTMLElement>(form, '.mh__formstatus')!;
	const sendBtn = q<HTMLButtonElement>(form, '.mh__send')!;
	const draftId = q<HTMLInputElement>(form, '.mh__draftid')!.value;

	const payload = {
		mailbox: panel.dataset.mailbox,
		to: q<HTMLInputElement>(form, '.mh__to')!.value.trim(),
		cc: q<HTMLInputElement>(form, '.mh__cc')!.value.trim(),
		subject: q<HTMLInputElement>(form, '.mh__subj')!.value.trim(),
		body: q<HTMLTextAreaElement>(form, '.mh__text')!.value.trim(),
		replyToId: q<HTMLInputElement>(form, '.mh__replyto')!.value || undefined,
	};
	if (!payload.to) { statusEl.textContent = 'Add a recipient.'; return; }
	if (!payload.body) { statusEl.textContent = 'Message is empty.'; return; }

	sendBtn.disabled = true;
	statusEl.textContent = 'Sending…';
	try {
		const res = await fetch('/api/admin/mail', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

		// A sent draft is no longer a draft. Discard the server copy so it does not
		// linger in the Drafts folder alongside the message that actually went.
		if (draftId) {
			await fetch('/api/admin/mail/draft', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mailbox: panel.dataset.mailbox, draftId }),
			}).catch(() => {});
		}

		statusEl.textContent = 'Sent.';
		q<HTMLDialogElement>(panel, '.mh__dlg')?.close();
		load(panel);
	} catch (err) {
		statusEl.textContent = err instanceof Error ? err.message : 'Send failed.';
	} finally {
		sendBtn.disabled = false;
	}
});

// ── Check now ─────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mh__check');
	if (!btn) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	btn.disabled = true;
	setStatus(panel, 'Checking…');
	try {
		const res = await fetch('/api/admin/mail/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

		// Surface a per-mailbox IMAP error rather than a blanket success — a wrong
		// password would otherwise look identical to an empty inbox.
		const failed = (data.results ?? []).find((r: any) => r.error);
		if (failed) setStatus(panel, failed.error);
		else if (!data.results?.length && data.throttled?.length) setStatus(panel, 'Just checked.');
		else setStatus(panel, data.inserted > 0 ? `${data.inserted} new` : 'Up to date');

		setOpen(panel, true);
		load(panel);
	} catch (err) {
		setStatus(panel, err instanceof Error ? err.message : 'Check failed');
	} finally {
		btn.disabled = false;
	}
});

// ── Organize: delete, move, new folder ──────────────────────────────────────
async function organize(panel: HTMLElement, body: Record<string, unknown>): Promise<boolean> {
	setStatus(panel, 'Working…');
	try {
		const res = await fetch('/api/admin/mail/organize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox, ...body }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
		setStatus(panel, '');
		return true;
	} catch (err) {
		setStatus(panel, err instanceof Error ? err.message : 'Failed');
		return false;
	}
}

document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mhc__del');
	if (!btn?.dataset.id) return;
	const panel = btn.closest<HTMLElement>('.mh')!;

	// Deleting moves to Trash rather than destroying, so this asks once and plainly
	// instead of demanding a scary confirmation for a reversible act.
	if (!confirm('Move this message to Trash?')) return;

	btn.disabled = true;
	if (await organize(panel, { action: 'delete', id: btn.dataset.id })) {
		btn.closest('.mhc')?.remove();
	} else {
		btn.disabled = false;
	}
});

document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mhc__destroy');
	if (!btn?.dataset.id) return;
	const panel = btn.closest<HTMLElement>('.mh')!;

	// Named, and typed. Delete gets a one-click confirm because it is reversible; this
	// one is not, so it asks for a deliberate act rather than a reflex. Naming the
	// subject means the operator confirms THIS message, not "a message".
	const subject = btn.dataset.subject ?? 'this message';
	if (!confirm(`Permanently delete "${subject}"? This cannot be undone.`)) return;

	btn.disabled = true;
	if (await organize(panel, { action: 'destroy', id: btn.dataset.id })) {
		btn.closest('.mhc')?.remove();
	} else {
		btn.disabled = false;
	}
});

document.addEventListener('change', async (e) => {
	const sel = (e.target as Element).closest<HTMLSelectElement>('.mhc__move');
	if (!sel?.value || !sel.dataset.id) return;
	const panel = sel.closest<HTMLElement>('.mh')!;
	const target = sel.value;
	sel.disabled = true;
	if (await organize(panel, { action: 'move', id: sel.dataset.id, folder: target })) {
		sel.closest('.mhc')?.remove();
	} else {
		sel.disabled = false;
		sel.value = '';
	}
});

document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mh__newfolder');
	if (!btn) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	const name = prompt('New folder name');
	if (!name) return;
	if (await organize(panel, { action: 'create-folder', name })) {
		// The rail is server-rendered from mail_folder_state, which the next poll fills.
		// Check now so the folder appears without waiting for the cron.
		await fetch('/api/admin/mail/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox }),
		}).catch(() => {});
		location.reload();
	}
});

// ── Bulk selection ──────────────────────────────────────────────────────────
// Junk arrives in volume. Selecting, select-all, and Ctrl+Shift+Delete are what make
// this usable as an actual mail client rather than a demo.

/**
 * Build the Move-to menu for a panel.
 *
 * Rebuilt on every load because the folder currently being viewed is left out of its
 * own menu — "move these to where they already are" is a no-op that reads as broken.
 *
 * Items are created with textContent, never innerHTML: folder names are
 * operator-supplied text rendered in the admin origin.
 */
function fillMoveMenu(panel: HTMLElement, data: any): void {
	const menu = q<HTMLElement>(panel, '.mh__movemenu');
	if (!menu) return;
	const current = activeFolder(panel);
	const folders = ((data.folders ?? []) as Array<{ path: string; specialUse: string | null }>)
		.filter((f) => f.path !== current);

	const label = (f: { path: string; specialUse: string | null }) =>
		f.path.toUpperCase() === 'INBOX' ? 'Inbox'
		: f.specialUse === '\\Sent' ? 'Sent'
		: f.specialUse === '\\Archive' ? 'Archive'
		: f.specialUse === '\\Junk' ? 'Spam'
		: f.specialUse === '\\Trash' ? 'Trash'
		: f.path.split(/[./]/).pop() || f.path;

	menu.innerHTML = '';
	if (!folders.length) {
		const hint = document.createElement('div');
		hint.className = 'mh__movehint';
		hint.textContent = 'No other folders';
		menu.appendChild(hint);
		return;
	}
	for (const f of folders) {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'mh__moveitem';
		item.dataset.folder = f.path;
		item.setAttribute('role', 'menuitem');
		item.textContent = label(f);
		menu.appendChild(item);
	}
}

/** Close every open move menu. */
function closeMoveMenus(): void {
	document.querySelectorAll<HTMLElement>('.mh__movemenu').forEach((m) => { m.hidden = true; });
	document.querySelectorAll<HTMLElement>('.mh__movebtn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

/**
 * After filing mail, offer to make it a standing rule.
 *
 * Asked from the gesture rather than from a settings screen: you have just dragged
 * three messages from someone into Nairobi, so the intent is obvious and the question
 * costs one click. Rules built this way describe what you actually did, instead of what
 * you predicted you would want.
 *
 * Only offered when every moved message came from ONE sender. Two senders means no
 * single rule is implied, and guessing at one would file mail you never meant to bind.
 */
function offerRule(panel: HTMLElement, senders: string[], folder: string): void {
	const bar = q<HTMLElement>(panel, '.mh__ruleoffer');
	if (!bar) return;

	const unique = [...new Set(senders.filter(Boolean))];
	if (unique.length !== 1) { bar.hidden = true; return; }

	const addr = unique[0];
	const domain = addr.split('@')[1] ?? '';
	const name = folder.split(/[./]/).pop() || folder;

	bar.hidden = false;
	bar.innerHTML = '';

	const label = document.createElement('span');
	// textContent throughout: the address is attacker-supplied and this is the admin origin.
	label.textContent = `Always file mail from ${addr} in ${name}?`;
	bar.appendChild(label);

	const make = (text: string, matchType: 'address' | 'domain', match: string) => {
		const b = document.createElement('button');
		b.className = 'mh__btn';
		b.type = 'button';
		b.textContent = text;
		b.addEventListener('click', async () => {
			bar.hidden = true;
			await fetch('/api/admin/mail/organize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mailbox: panel.dataset.mailbox, action: 'create-rule', match, matchType, folder }),
			}).catch(() => {});
			setStatus(panel, `Rule saved — ${match} → ${name}`);
		});
		return b;
	};

	bar.appendChild(make('This sender', 'address', addr));
	if (domain) bar.appendChild(make(`Everyone at @${domain}`, 'domain', domain));

	const no = document.createElement('button');
	no.className = 'mh__btn';
	no.type = 'button';
	no.textContent = 'No';
	no.addEventListener('click', () => { bar.hidden = true; });
	bar.appendChild(no);
}

/**
 * Drop the unread count by one, on the bar and on the folder in the rail.
 *
 * Both are rendered by the server at page load, so clicking "Mark read" updated the
 * database and removed the button while the badge kept saying 1. The message was read
 * and the panel still insisted otherwise, which reads as the click not working.
 *
 * Adjusted in place rather than re-fetched: the count is one number and a round trip to
 * decrement it would be slower than the click that caused it.
 */
/** Raise the unread count by one, creating the badge if it had gone away. */
function incrementUnread(panel: HTMLElement): void {
	const bump = (host: HTMLElement | null, existing: HTMLElement | null, cls: string) => {
		if (existing) {
			existing.textContent = String(Number(existing.textContent?.replace(/\D/g, '') || 0) + 1);
			return;
		}
		if (!host) return;
		const badge = document.createElement('span');
		badge.className = cls;
		badge.textContent = '1';
		host.appendChild(badge);
	};

	const bar = q<HTMLElement>(panel, '.mh__bar');
	bump(bar, q<HTMLElement>(panel, '.mh__badge'), 'mh__badge');
	const tab = q<HTMLElement>(panel, '.mh__rf--on');
	bump(tab, tab?.querySelector<HTMLElement>('.mh__rfcount') ?? null, 'mh__rfcount');
}

function decrementUnread(panel: HTMLElement): void {
	const bump = (el: HTMLElement | null) => {
		if (!el) return;
		const next = Math.max(0, Number(el.textContent?.replace(/\D/g, '') || 0) - 1);
		// A zero badge is not a quiet badge, it is a wrong one — remove it.
		if (next === 0) el.remove();
		else el.textContent = String(next);
	};

	bump(q<HTMLElement>(panel, '.mh__badge'));
	const tab = q<HTMLElement>(panel, '.mh__rf--on');
	if (tab) bump(tab.querySelector<HTMLElement>('.mh__rfcount'));
}

/**
 * Re-read the unread counts for every folder in this panel.
 *
 * Called after anything that moves mail between folders. The badges are server-rendered
 * once; without this they keep describing the arrangement the page loaded with.
 */
async function refreshCounts(panel: HTMLElement): Promise<void> {
	try {
		const res = await fetch(`/api/admin/mail?mailbox=${encodeURIComponent(panel.dataset.mailbox!)}&limit=1`);
		const data = await res.json();
		if (!data.ok) return;

		const bar = q<HTMLElement>(panel, '.mh__badge');
		if (bar) {
			if (!data.unread) bar.remove();
			else bar.textContent = String(data.unread);
		}

		// Per-folder counts are not in the list response, so ask each tab for its own.
		for (const tab of Array.from(panel.querySelectorAll<HTMLElement>('.mh__rf'))) {
			const folder = tab.dataset.folder;
			if (!folder || folder === '__drafts__') continue;
			const r = await fetch(`/api/admin/mail?mailbox=${encodeURIComponent(panel.dataset.mailbox!)}&folder=${encodeURIComponent(folder)}&limit=1`);
			const d = await r.json();
			if (!d.ok) continue;

			let badge = tab.querySelector<HTMLElement>('.mh__rfcount');
			const n = Number(d.folderUnread ?? 0);
			if (!n) { badge?.remove(); continue; }
			if (!badge) {
				badge = document.createElement('span');
				badge.className = 'mh__rfcount';
				tab.appendChild(badge);
			}
			badge.textContent = String(n);
		}
	} catch {
		// Stale counts are a smaller problem than a panel that errors while tidying up.
	}
}

function checkedIds(panel: HTMLElement): string[] {
	return Array.from(panel.querySelectorAll<HTMLInputElement>('.mhc__chk:checked'))
		.map((c) => c.dataset.id!)
		.filter(Boolean);
}

/** Toolbar label and button state follow the selection. */
function syncBulkBar(panel: HTMLElement): void {
	const n = checkedIds(panel).length;
	const bar = q<HTMLElement>(panel, '.mh__bulk');
	if (!bar) return;
	bar.classList.toggle('mh__bulk--on', n > 0);
	const count = q<HTMLElement>(bar, '.mh__bulkcount');
	if (count) count.textContent = n ? `${n} selected` : '';

	// Destroy only makes sense in Trash — same rule as the per-row button.
	const inTrashFolder = /^(inbox[./])?(trash|deleted items?)$/i.test(activeFolder(panel));
	const destroy = q<HTMLButtonElement>(bar, '.mh__bulkdestroy');
	if (destroy) destroy.hidden = !inTrashFolder;
	const del = q<HTMLButtonElement>(bar, '.mh__bulkdel');
	if (del) del.hidden = inTrashFolder;
}

async function bulkAct(panel: HTMLElement, action: 'delete' | 'destroy'): Promise<void> {
	const ids = checkedIds(panel);
	if (!ids.length) return;

	// One confirm, naming the count. Delete is reversible so it barely needs asking;
	// destroy is not, so it asks plainly — but neither demands typing. A prompt people
	// meet twenty times a day has to be answerable in one click or they stop reading it.
	const question = action === 'destroy'
		? `Permanently delete ${ids.length} message${ids.length === 1 ? '' : 's'}? This cannot be undone.`
		: `Move ${ids.length} message${ids.length === 1 ? '' : 's'} to Trash?`;
	if (!confirm(question)) return;

	setStatus(panel, action === 'destroy' ? 'Deleting…' : 'Moving to Trash…');
	try {
		const res = await fetch('/api/admin/mail/organize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox, action, ids }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

		for (const id of data.done ?? []) {
			panel.querySelector(`.mhc[data-id="${CSS.escape(String(id))}"]`)?.remove();
		}
		// Partial failure is named rather than hidden — nineteen of twenty is not a
		// failure, but the one left behind should not vanish from the story.
		setStatus(panel, (data.failed ?? []).length
			? `${data.done.length} done, ${data.failed.length} failed: ${data.failed[0].error}`
			: '');
		const all = q<HTMLInputElement>(panel, '.mh__bulkall');
		if (all) all.checked = false;
		syncBulkBar(panel);
	} catch (err) {
		setStatus(panel, err instanceof Error ? err.message : 'Failed');
	}
}

document.addEventListener('change', (e) => {

	const chk = (e.target as Element).closest<HTMLInputElement>('.mhc__chk');
	if (chk) { syncBulkBar(chk.closest<HTMLElement>('.mh')!); return; }

	const all = (e.target as Element).closest<HTMLInputElement>('.mh__bulkall');
	if (!all) return;
	const panel = all.closest<HTMLElement>('.mh')!;
	panel.querySelectorAll<HTMLInputElement>('.mhc__chk').forEach((c) => { c.checked = all.checked; });
	syncBulkBar(panel);
});

document.addEventListener('click', async (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mh__bulkunread');
	if (!btn) return;
	const panel = btn.closest<HTMLElement>('.mh')!;
	const ids = checkedIds(panel);
	if (!ids.length) { setStatus(panel, 'Nothing selected'); return; }

	setStatus(panel, 'Marking unread…');
	try {
		const res = await fetch('/api/admin/mail', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox, ids, read: false }),
		});
		if (!res.ok) throw new Error(String(res.status));
		setStatus(panel, `${ids.length} marked unread`);
		load(panel);
	} catch {
		setStatus(panel, 'Could not mark unread');
	}
});

document.addEventListener('click', (e) => {
	const del = (e.target as Element).closest<HTMLButtonElement>('.mh__bulkdel');
	if (del) { void bulkAct(del.closest<HTMLElement>('.mh')!, 'delete'); return; }
	const destroy = (e.target as Element).closest<HTMLButtonElement>('.mh__bulkdestroy');
	if (destroy) { void bulkAct(destroy.closest<HTMLElement>('.mh')!, 'destroy'); }
});

// Ctrl/Cmd+Shift+Delete on whatever panel holds the selection.
document.addEventListener('keydown', (e) => {
	if (e.key !== 'Delete' && e.key !== 'Backspace') return;
	if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return;

	const panel = panels().find((pl) => checkedIds(pl).length > 0);
	if (!panel) return;
	e.preventDefault();

	// In Trash the shortcut destroys, everywhere else it files in Trash — the same
	// meaning the visible buttons have, so the shortcut is never the more dangerous
	// version of what the button would do.
	const inTrashFolder = /^(inbox[./])?(trash|deleted items?)$/i.test(activeFolder(panel));
	void bulkAct(panel, inTrashFolder ? 'destroy' : 'delete');
});

// ── Drag messages onto a folder ─────────────────────────────────────────────
// The same move the toolbar performs, by the gesture people reach for when the list
// and the folders are both on screen. Dragging a SELECTED row carries the whole
// selection; dragging an unselected one carries just it — which is what every mail
// client does and therefore what the hand expects.

let dragIds: string[] = [];

document.addEventListener('dragstart', (e) => {
	const row = (e.target as Element).closest<HTMLElement>('.mhc');
	if (!row?.dataset.id) return;
	const panel = row.closest<HTMLElement>('.mh')!;

	const selected = checkedIds(panel);
	dragIds = selected.includes(row.dataset.id) ? selected : [row.dataset.id];

	row.classList.add('mhc--dragging');
	// Some browsers refuse to start a drag without data on the transfer object.
	e.dataTransfer?.setData('text/plain', dragIds.join(','));
	if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
});

document.addEventListener('dragend', () => {
	document.querySelectorAll('.mhc--dragging').forEach((r) => r.classList.remove('mhc--dragging'));
	document.querySelectorAll('.mh__rf--over').forEach((r) => r.classList.remove('mh__rf--over'));
	dragIds = [];
});

document.addEventListener('dragover', (e) => {
	const tab = (e.target as Element).closest<HTMLElement>('.mh__rf');
	if (!tab || !dragIds.length) return;
	// Not a real folder, and not the folder the messages are already in.
	const folder = tab.dataset.folder;
	if (!folder || folder === '__drafts__' || tab.classList.contains('mh__rf--on')) return;

	// preventDefault is what makes an element a drop target at all. Withholding it on
	// the current folder means that tab visibly refuses the drag rather than accepting
	// a drop that would do nothing.
	e.preventDefault();
	tab.classList.add('mh__rf--over');
});

document.addEventListener('dragleave', (e) => {
	(e.target as Element).closest<HTMLElement>('.mh__rf')?.classList.remove('mh__rf--over');
});

document.addEventListener('drop', async (e) => {
	const tab = (e.target as Element).closest<HTMLElement>('.mh__rf');
	const folder = tab?.dataset.folder;
	if (!tab || !folder || folder === '__drafts__' || !dragIds.length) return;
	e.preventDefault();
	tab.classList.remove('mh__rf--over');

	const panel = tab.closest<HTMLElement>('.mh')!;
	const ids = [...dragIds];
	dragIds = [];

	setStatus(panel, `Moving ${ids.length}…`);
	try {
		const res = await fetch('/api/admin/mail/organize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox, action: 'move', ids, folder }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
		const senders: string[] = [];
		for (const id of data.done ?? []) {
			const row = panel.querySelector<HTMLElement>(`.mhc[data-id="${CSS.escape(String(id))}"]`);
			if (row?.dataset.from) senders.push(row.dataset.from);
			row?.remove();
		}
		setStatus(panel, (data.failed ?? []).length
			? `${data.done.length} moved, ${data.failed.length} failed`
			: `${data.done.length} moved`);
		// The rail counts came from the server at page load, so after moving mail between
		// folders they describe where things WERE. A count that outlives its messages is
		// how an empty Trash ends up claiming two unread.
		void refreshCounts(panel);
		offerRule(panel, senders, folder);
		const all = q<HTMLInputElement>(panel, '.mh__bulkall');
		if (all) all.checked = false;
		syncBulkBar(panel);
	} catch (err) {
		setStatus(panel, err instanceof Error ? err.message : 'Move failed');
	}
});

// ── Move-to menu ────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
	const btn = (e.target as Element).closest<HTMLButtonElement>('.mh__movebtn');
	if (!btn) return;
	const menu = btn.parentElement?.querySelector<HTMLElement>('.mh__movemenu');
	if (!menu) return;
	const willOpen = menu.hidden;
	closeMoveMenus();
	menu.hidden = !willOpen;
	btn.setAttribute('aria-expanded', String(willOpen));
});

// Clicking elsewhere or pressing Escape closes it. A menu that can only be dismissed
// by choosing something is a trap.
document.addEventListener('click', (e) => {
	if (!(e.target as Element).closest('.mh__movewrap')) closeMoveMenus();
});
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') closeMoveMenus();
});

document.addEventListener('click', async (e) => {
	const item = (e.target as Element).closest<HTMLButtonElement>('.mh__moveitem');
	if (!item?.dataset.folder) return;
	const panel = item.closest<HTMLElement>('.mh')!;
	const target = item.dataset.folder;
	closeMoveMenus();

	const ids = checkedIds(panel);
	if (!ids.length) { setStatus(panel, 'Select messages first'); return; }

	setStatus(panel, 'Moving…');
	try {
		const res = await fetch('/api/admin/mail/organize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mailbox: panel.dataset.mailbox, action: 'move', ids, folder: target }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

		const senders: string[] = [];
		for (const id of data.done ?? []) {
			const row = panel.querySelector<HTMLElement>(`.mhc[data-id="${CSS.escape(String(id))}"]`);
			if (row?.dataset.from) senders.push(row.dataset.from);
			row?.remove();
		}
		setStatus(panel, (data.failed ?? []).length
			? `${data.done.length} moved, ${data.failed.length} failed`
			: `${data.done.length} moved`);
		void refreshCounts(panel);
		offerRule(panel, senders, target);
		const all = q<HTMLInputElement>(panel, '.mh__bulkall');
		if (all) all.checked = false;
		syncBulkBar(panel);
	} catch (err) {
		setStatus(panel, err instanceof Error ? err.message : 'Move failed');
	}
});

// Restore any panel the operator left open.
// Open on first visit — a mail panel that shows nothing until it is discovered and
// clicked reads as broken. After that the operator's own choice is remembered.
for (const panel of panels()) {
	if (localStorage.getItem(`mh:open:${panel.dataset.mailbox}`) !== '0') setOpen(panel, true);
}
document.addEventListener('click', (e) => {
	const bar = (e.target as Element).closest<HTMLElement>('.mh__bar');
	if (!bar || (e.target as Element).closest('.mh__btn')) return;
	const panel = bar.closest<HTMLElement>('.mh')!;
	localStorage.setItem(`mh:open:${panel.dataset.mailbox}`, panel.classList.contains('mh--open') ? '1' : '0');
});
