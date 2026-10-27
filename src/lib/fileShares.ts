/**
 * The share folder: one curated file, one link. An owner uploads a file they choose and gets a link
 * to it. The link works until it expires, runs out of downloads, or the owner revokes it. The
 * recipient needs no account, so the link itself is the key: it is random, only its SHA-256 is
 * stored, and it is shown once, when the share is made.
 *
 * Nothing here reads the owner's transaction data. A share is a copy the owner chose to make, so
 * it is stored as uploaded and deleted on revoke or when it is no longer usable.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';

export const ALLOWED_TYPES = ['text/csv', 'application/pdf', 'application/json', 'text/plain', 'text/markdown'] as const;
// Archives and scripts are refused by name as well as type. A zip with a script inside is what
// Google blocked; an HTML or SVG file can run code in the browser that opens it.
export const BLOCKED_EXTENSIONS = [
	'zip', 'js', 'mjs', 'cjs', 'html', 'htm', 'svg', 'exe', 'sh', 'bat', 'command', 'app', 'dmg', 'msi', 'ps1', 'py', 'php',
] as const;
export const MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_EXPIRY_DAYS = 7;
export const DEFAULT_MAX_DOWNLOADS = 3;
export const MAX_ACTIVE_SHARES = 20;

export interface ShareRow {
	id: string;
	tenant_id: string;
	label: string;
	filename: string;
	mime_type: string;
	file_size: number;
	expires_at: string;
	max_downloads: number;
	downloads: number;
	revoked_at: string | null;
	created_at: string;
}

export type ShareStatus = 'active' | 'revoked' | 'expired' | 'exhausted';

export function newToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function newShareId(): string {
	return randomUUID();
}

export function shareLink(origin: string, token: string): string {
	return `${origin}/shares/${token}`;
}

/** The ISO timestamp a new share expires, UTC. */
export function expiryFrom(now: Date, days: number = DEFAULT_EXPIRY_DAYS): string {
	return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Whether a share can still be downloaded, and if not, why. */
export function shareStatus(row: Pick<ShareRow, 'expires_at' | 'max_downloads' | 'downloads' | 'revoked_at'>, now: Date): ShareStatus {
	if (row.revoked_at) return 'revoked';
	if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
	if (row.downloads >= row.max_downloads) return 'exhausted';
	return 'active';
}

/** Refuses a file by type, by name, or by size. Returns the reason, or null when it may be shared. */
export function uploadRefusal(input: { filename: string; mimeType: string; size: number }): string | null {
	const ext = input.filename.toLowerCase().split('.').pop() ?? '';
	if (ext && (BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
		return 'This kind of file cannot be shared. Use CSV, PDF, JSON, plain text or Markdown.';
	}
	if (!(ALLOWED_TYPES as readonly string[]).includes(input.mimeType)) {
		return 'Unsupported file type. Use CSV, PDF, JSON, plain text or Markdown.';
	}
	if (input.size <= 0) return 'The file is empty.';
	if (input.size > MAX_SIZE_BYTES) return 'File too large (max 5 MB).';
	return null;
}

const ENSURE_SHARES_SQL = `
	CREATE TABLE IF NOT EXISTS file_shares (
		id            TEXT NOT NULL PRIMARY KEY,
		tenant_id     TEXT NOT NULL,
		label         TEXT NOT NULL DEFAULT '',
		filename      TEXT NOT NULL,
		mime_type     TEXT NOT NULL,
		file_size     INTEGER NOT NULL,
		data          TEXT,
		token_hash    TEXT NOT NULL UNIQUE,
		expires_at    TEXT NOT NULL,
		max_downloads INTEGER NOT NULL,
		downloads     INTEGER NOT NULL DEFAULT 0,
		revoked_at    TEXT,
		created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
	)
`;

const ENSURE_SHARE_LOG_SQL = `
	CREATE TABLE IF NOT EXISTS file_share_log (
		id        TEXT NOT NULL PRIMARY KEY,
		share_id  TEXT NOT NULL,
		tenant_id TEXT NOT NULL,
		at        TEXT NOT NULL,
		outcome   TEXT NOT NULL
	)
`;

const ENSURE_INDEXES_SQL = [
	`CREATE INDEX IF NOT EXISTS idx_file_shares_tenant ON file_shares (tenant_id, created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_file_share_log_share ON file_share_log (share_id, at DESC)`,
];

/** Creates the share tables on first use, the same way the receipts tables are made. */
export async function ensureShareTables(): Promise<void> {
	await db.execute({ sql: ENSURE_SHARES_SQL, args: [] });
	await db.execute({ sql: ENSURE_SHARE_LOG_SQL, args: [] });
	for (const sql of ENSURE_INDEXES_SQL) await db.execute({ sql, args: [] });
}

export async function countActiveShares(tenantId: string, now: Date): Promise<number> {
	const r = await db.execute({
		sql: `SELECT COUNT(*) AS n FROM file_shares
		      WHERE tenant_id = ? AND revoked_at IS NULL AND expires_at > ? AND downloads < max_downloads`,
		args: [tenantId, now.toISOString()],
	});
	return Number((r.rows[0] as Record<string, unknown> | undefined)?.n ?? 0);
}

/**
 * Counts one download, but only if the share is still usable at the moment of the update, so two
 * requests at once cannot both take the last download. Returns false when the share is no longer
 * usable.
 */
export async function takeDownload(shareId: string, now: Date): Promise<boolean> {
	const r = await db.execute({
		sql: `UPDATE file_shares SET downloads = downloads + 1
		      WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND downloads < max_downloads`,
		args: [shareId, now.toISOString()],
	});
	return (r.rowsAffected ?? 0) > 0;
}

export async function logShareEvent(shareId: string, tenantId: string, outcome: string, now: Date): Promise<void> {
	await db.execute({
		sql: `INSERT INTO file_share_log (id, share_id, tenant_id, at, outcome) VALUES (?, ?, ?, ?, ?)`,
		args: [newShareId(), shareId, tenantId, now.toISOString(), outcome],
	});
}
