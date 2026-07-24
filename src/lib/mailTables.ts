/**
 * mailTables.ts
 *
 * Lazy schema for the operator mailbox windows on /admin. Almstins builds every
 * table this way — CREATE TABLE IF NOT EXISTS on first use (see checkLog.ts,
 * verifyEntities.ts) — because the old Turso `db:migrate` runner is retired and the
 * runtime is Postgres. The migrations-pg/00{26..33}_mail*.sql files are the mirror
 * of this DDL, kept for parity/auditability; THIS is what actually runs.
 *
 * Deliberately NOT tenant-scoped: operator mail is the operator's own
 * correspondence, belongs to no tenant, and is guarded by requireAdminSession on
 * every read/write path rather than by a tenant_id column. Never join to these
 * tables from a tenant-facing endpoint.
 *
 * Ordering matters: mail_messages first, because mail_attachments and mail_threats
 * carry a FK to it. Everything is IF NOT EXISTS, so running it repeatedly is a no-op.
 */

import { db } from './db';

const STATEMENTS: string[] = [
	`CREATE TABLE IF NOT EXISTS mail_messages (
		id           TEXT        PRIMARY KEY,
		mailbox      TEXT        NOT NULL,
		direction    TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
		uid          BIGINT,
		uid_validity BIGINT,
		message_id   TEXT,
		in_reply_to  TEXT,
		refs         TEXT,
		from_addr    TEXT        NOT NULL DEFAULT '',
		from_name    TEXT,
		to_addrs     TEXT        NOT NULL DEFAULT '',
		cc_addrs     TEXT,
		subject      TEXT        NOT NULL DEFAULT '',
		body_text    TEXT        NOT NULL DEFAULT '',
		body_html    TEXT,
		sent_at      TIMESTAMPTZ,
		fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
		read_at      TIMESTAMPTZ,
		send_error   TEXT,
		folder       TEXT        NOT NULL DEFAULT 'INBOX',
		special_use  TEXT,
		spam_flag    BOOLEAN     NOT NULL DEFAULT false,
		spam_score   NUMERIC(6,2),
		threat_level TEXT        CHECK (threat_level IS NULL OR threat_level IN ('danger', 'warning')),
		scanned_at   TIMESTAMPTZ
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_uid_idx
		ON mail_messages (mailbox, folder, uid_validity, uid) WHERE uid IS NOT NULL`,
	`CREATE INDEX IF NOT EXISTS mail_messages_box_idx
		ON mail_messages (mailbox, folder, sent_at DESC NULLS LAST)`,
	`CREATE INDEX IF NOT EXISTS mail_messages_unread_idx
		ON mail_messages (mailbox, folder) WHERE direction = 'in' AND read_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS mail_messages_thread_idx ON mail_messages (message_id)`,
	`CREATE INDEX IF NOT EXISTS mail_messages_spam_idx
		ON mail_messages (mailbox, sent_at DESC) WHERE spam_flag = true`,
	`CREATE INDEX IF NOT EXISTS mail_messages_threat_idx
		ON mail_messages (mailbox, sent_at DESC) WHERE threat_level IS NOT NULL`,

	`CREATE TABLE IF NOT EXISTS mail_attachments (
		id           TEXT   PRIMARY KEY,
		message_id   TEXT   NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
		filename     TEXT   NOT NULL DEFAULT 'attachment',
		content_type TEXT   NOT NULL DEFAULT 'application/octet-stream',
		size_bytes   BIGINT NOT NULL DEFAULT 0,
		content_b64  TEXT,
		skipped      TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS mail_attachments_msg_idx ON mail_attachments (message_id)`,

	`CREATE TABLE IF NOT EXISTS mail_folder_state (
		mailbox      TEXT        NOT NULL,
		folder       TEXT        NOT NULL,
		uid_validity BIGINT      NOT NULL,
		last_uid     BIGINT      NOT NULL DEFAULT 0,
		special_use  TEXT,
		updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (mailbox, folder)
	)`,

	`CREATE TABLE IF NOT EXISTS mail_drafts (
		id          TEXT        PRIMARY KEY,
		mailbox     TEXT        NOT NULL,
		imap_uid    BIGINT,
		imap_folder TEXT,
		to_addrs    TEXT        NOT NULL DEFAULT '',
		cc_addrs    TEXT,
		subject     TEXT        NOT NULL DEFAULT '',
		body_text   TEXT        NOT NULL DEFAULT '',
		reply_to_id TEXT,
		updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS mail_drafts_box_idx ON mail_drafts (mailbox, updated_at DESC)`,

	`CREATE TABLE IF NOT EXISTS mail_threats (
		id         TEXT        PRIMARY KEY,
		message_id TEXT        NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
		kind       TEXT        NOT NULL CHECK (kind IN ('address', 'url')),
		value      TEXT        NOT NULL,
		severity   TEXT        NOT NULL CHECK (severity IN ('danger', 'warning', 'known')),
		reason     TEXT        NOT NULL DEFAULT '',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (message_id, kind, value)
	)`,
	`CREATE INDEX IF NOT EXISTS mail_threats_msg_idx ON mail_threats (message_id)`,

	`CREATE TABLE IF NOT EXISTS mail_rules (
		id          TEXT        PRIMARY KEY,
		mailbox     TEXT        NOT NULL,
		match_type  TEXT        NOT NULL CHECK (match_type IN ('address', 'domain')),
		match_value TEXT        NOT NULL,
		folder      TEXT        NOT NULL,
		created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
		UNIQUE (mailbox, match_type, match_value)
	)`,
	`CREATE INDEX IF NOT EXISTS mail_rules_box_idx ON mail_rules (mailbox)`,
];

// Cached: the DDL runs once per process, then every later call is a no-op await.
// Reset to null on failure so a transient DB error retries rather than sticking.
let ready: Promise<void> | null = null;

export function ensureMailTables(): Promise<void> {
	if (!ready) {
		ready = (async () => {
			for (const sql of STATEMENTS) {
				await db.execute({ sql });
			}
		})().catch((e) => {
			ready = null;
			throw e;
		});
	}
	return ready;
}
