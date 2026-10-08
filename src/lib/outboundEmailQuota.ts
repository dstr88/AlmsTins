/**
 * Durable per-tenant cap on email Almstins sends to addresses a tenant typed in (the
 * receivables and milestone request emails). A rolling 24h window, shared by every channel.
 *
 * Durable on purpose: an in-memory daily cap would reset on every deploy or restart. The
 * per-hour guards in the send endpoints count requests CREATED, so re-sending the same
 * request was unlimited; this counts emails actually handed to the mail server.
 *
 * The claim is one statement (insert only while under the cap). Two concurrent claims can
 * both see count = cap - 1 and overshoot by one; that is acceptable for an abuse brake.
 * A claim is released if the send then fails, so a mail-server outage does not eat the day.
 */
import crypto from 'node:crypto';
import { db } from './db';

export const OUTBOUND_EMAILS_PER_TENANT_PER_DAY = 100;
const WINDOW_MS = 24 * 60 * 60 * 1000;

let ensured: Promise<void> | null = null;

export function ensureOutboundEmailTable(): Promise<void> {
	if (!ensured) {
		ensured = (async () => {
			await db.execute({
				sql: `CREATE TABLE IF NOT EXISTS tenant_outbound_emails (
				        id        TEXT PRIMARY KEY,
				        tenant_id TEXT NOT NULL,
				        channel   TEXT NOT NULL,
				        sent_at   TEXT NOT NULL
				      )`,
				args: [],
			});
			await db.execute({
				sql: 'CREATE INDEX IF NOT EXISTS tenant_outbound_emails_tenant_sent_idx ON tenant_outbound_emails (tenant_id, sent_at)',
				args: [],
			});
		})().catch((err: unknown) => {
			ensured = null;
			throw err;
		});
	}
	return ensured;
}

/**
 * Claim one outbound email for `tenantId`. Returns the claim id, or null when the tenant
 * has reached its cap for the last 24 hours. Throws on a database error (callers refuse).
 */
export async function claimOutboundEmail(
	tenantId: string,
	channel: string,
	now = Date.now(),
	cap = OUTBOUND_EMAILS_PER_TENANT_PER_DAY,
): Promise<string | null> {
	await ensureOutboundEmailTable();
	const id = crypto.randomUUID();
	const res = await db.execute({
		sql: `INSERT INTO tenant_outbound_emails (id, tenant_id, channel, sent_at)
		      SELECT ?, ?, ?, ?
		      WHERE (SELECT COUNT(*) FROM tenant_outbound_emails WHERE tenant_id = ? AND sent_at >= ?) < ?`,
		args: [id, tenantId, channel, new Date(now).toISOString(), tenantId, new Date(now - WINDOW_MS).toISOString(), cap],
	});
	return Number(res.rowsAffected ?? 0) === 1 ? id : null;
}

/** Give a claim back (the send failed). Best-effort. */
export async function releaseOutboundEmail(tenantId: string, claimId: string): Promise<void> {
	try {
		await db.execute({
			sql: 'DELETE FROM tenant_outbound_emails WHERE id = ? AND tenant_id = ?',
			args: [claimId, tenantId],
		});
	} catch (err) {
		console.warn('[outboundEmailQuota] release failed', err instanceof Error ? err.message : String(err));
	}
}

/** What the send endpoints return when they refuse, with text the desk UIs can show as-is. */
export const SEND_REFUSAL_DETAIL = {
	email_unverified:
		'Verify your email address before Almstins sends email on your behalf: open the link in your sign-up email, or sign in with Google, GitHub or an email link.',
	daily_limit: `This account has reached its limit of ${OUTBOUND_EMAILS_PER_TENANT_PER_DAY} emails in 24 hours. Copy the link and send it yourself.`,
	quota_unavailable: 'Could not check the sending limit just now. Copy the link and send it yourself, or try again shortly.',
} as const;
