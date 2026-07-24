/**
 * mailboxes.ts
 *
 * Config for the mailbox windows on /admin. Reads indexed env vars so the same code
 * runs on both products with nothing but Render env differing:
 *
 *   SusuFinance : admin@susufinance.com, second@susufinance.com
 *   Almstins    : donnie@almstins.com,   hello@almstins.com
 *
 * ── Env shape ────────────────────────────────────────────────────────────────
 *   MAIL_IMAP_HOST       mail.susufinance.com
 *   MAIL_IMAP_PORT       993            (optional, default 993 / TLS)
 *   MAIL_SMTP_HOST       mail.susufinance.com
 *   MAIL_SMTP_PORT       465            (optional, default 465 / TLS)
 *
 *   MAILBOX_1_ADDRESS    admin@susufinance.com
 *   MAILBOX_1_PASSWORD   ...
 *   MAILBOX_1_LABEL      Admin          (optional, defaults to the local part)
 *   MAILBOX_1_SEND       true           (optional, default true)
 *   MAILBOX_1_OWNER      donnie@...     (optional, comma list; empty = every admin)
 *   MAILBOX_1_TENANT     5c5133b3-...   (optional; enables member-aware address checks)
 *
 *   MAILBOX_2_ADDRESS    second@susufinance.com
 *   MAILBOX_2_SEND       false          ← read-only until the mailbox owner has agreed
 *   ...
 *
 * Each mailbox authenticates as itself. cPanel accounts cannot generally send as one
 * another, so there is no shared credential — one password per address. These are NOT
 * the same as EMAIL_SERVER, which stays reserved for system mail (magic links, alerts)
 * and must not be reused here.
 *
 * ── Why `send` is per-mailbox ────────────────────────────────────────────────
 * Reading someone's mail and sending as them are different capabilities. A compose
 * button on someone else's mailbox can put words in their name in front of people who will read them
 * as his. That ships disabled and turns on with one env var once he has said yes.
 */

export interface Mailbox {
	/** Full address. Also the join key into mail_messages.mailbox. */
	address: string;
	/** Display name for the window header. */
	label: string;
	/** Password for both IMAP and SMTP. Never leaves the server. */
	password: string;
	/** False = window renders read-only, compose and reply hidden AND refused server-side. */
	canSend: boolean;
	/** Admin emails allowed to see this window. Empty = all admins. Lowercased. */
	owners: string[];
	/**
	 * The programme this mailbox belongs to, for member-aware checks.
	 *
	 * Optional and fails CLOSED: with no tenant set, the scanner does not look at
	 * members at all. It must never be inferred, because the alternative — searching
	 * every tenant's members for a matching payout address — would answer questions
	 * about one programme's people using another programme's mail. Tenant isolation is
	 * architecture here, not a setting.
	 */
	tenantId: string | null;
}

export interface MailServerConfig {
	imapHost: string;
	imapPort: number;
	smtpHost: string;
	smtpPort: number;
}

/** How many MAILBOX_n_* slots to look for. Raise if a product ever needs more. */
const MAX_MAILBOXES = 6;

const env = (key: string): string => (process.env[key] ?? '').trim();

/**
 * Truthy unless explicitly switched off. Absent means "yes" for send, because the
 * common case is a mailbox you own; the exception is the one you must opt into.
 */
const envBool = (key: string, fallback: boolean): boolean => {
	const raw = env(key).toLowerCase();
	if (!raw) return fallback;
	return raw !== 'false' && raw !== '0' && raw !== 'no' && raw !== 'off';
};

export function getMailServerConfig(): MailServerConfig | null {
	const imapHost = env('MAIL_IMAP_HOST');
	const smtpHost = env('MAIL_SMTP_HOST') || imapHost;
	if (!imapHost) return null;
	return {
		imapHost,
		imapPort: Number(env('MAIL_IMAP_PORT') || 993),
		smtpHost,
		smtpPort: Number(env('MAIL_SMTP_PORT') || 465),
	};
}

/**
 * Every configured mailbox, in env order. Slots may be sparse — a gap at 2 does not
 * stop 3 from loading, so removing a mailbox never means renumbering the rest.
 */
export function getMailboxes(): Mailbox[] {
	const boxes: Mailbox[] = [];
	for (let i = 1; i <= MAX_MAILBOXES; i++) {
		const address = env(`MAILBOX_${i}_ADDRESS`).toLowerCase();
		const password = env(`MAILBOX_${i}_PASSWORD`);
		if (!address || !password) continue;
		boxes.push({
			address,
			label: env(`MAILBOX_${i}_LABEL`) || address.split('@')[0],
			password,
			canSend: envBool(`MAILBOX_${i}_SEND`, true),
			owners: env(`MAILBOX_${i}_OWNER`)
				.split(',')
				.map((e) => e.trim().toLowerCase())
				.filter(Boolean),
			tenantId: env(`MAILBOX_${i}_TENANT`) || null,
		});
	}
	return boxes;
}

/**
 * Who is asking. Both identifiers are checked against MAILBOX_n_OWNER, so an owner
 * entry may be written as either a login email or a user id (auth_users.id).
 *
 * The user id is the dependable one: an OAuth provider can withhold an email, and an
 * email can change, but the id is always present in the session and names exactly one
 * person. Email is still accepted because it is the readable option when you are
 * writing the env var by hand.
 */
export interface AdminIdentity {
	userId?: string | null;
	email?: string | null;
}

/**
 * The mailboxes a given admin may see.
 *
 * Empty owners list = shared with every admin (the intent for a company address like
 * admin@). A populated list = private to those named (the intent for a personal box).
 */
export function getMailboxesForAdmin(who: AdminIdentity): Mailbox[] {
	const email = (who.email ?? '').trim().toLowerCase();
	const userId = (who.userId ?? '').trim().toLowerCase();
	return getMailboxes().filter(
		(b) =>
			b.owners.length === 0 ||
			(email && b.owners.includes(email)) ||
			(userId && b.owners.includes(userId)),
	);
}

/** Look up one mailbox an admin is allowed to touch. Null if absent or not theirs. */
export function findMailboxForAdmin(address: string, who: AdminIdentity): Mailbox | null {
	const want = (address ?? '').trim().toLowerCase();
	return getMailboxesForAdmin(who).find((b) => b.address === want) ?? null;
}

/** Config presence, for the admin page to explain itself when nothing is set up yet. */
export function mailConfigStatus(): { configured: boolean; reason: string } {
	if (!getMailServerConfig()) {
		return { configured: false, reason: 'MAIL_IMAP_HOST is not set.' };
	}
	if (getMailboxes().length === 0) {
		return { configured: false, reason: 'No MAILBOX_n_ADDRESS / MAILBOX_n_PASSWORD pairs are set.' };
	}
	return { configured: true, reason: '' };
}
