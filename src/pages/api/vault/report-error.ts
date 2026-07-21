/**
 * POST /api/vault/report-error
 *
 * Called client-side when a WalletSummary tin fails to load its data.
 * Sends an alert email to the site owner and (if set) the user's alert email.
 * Rate-limited to one email per wallet per hour to prevent floods.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { sendMail } from '@/lib/email';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getWalletErrorAlert } from '@/i18n/emails/walletErrorAlert';

export const prerender = false;

const OWNER_EMAIL = 'donnie@titaniumhut.com';

// Rate limit: one email per wallet per hour.
//
// This used to be in-memory only, and that was the bug behind the flood. Render's
// free tier sleeps and cold-starts constantly, wiping the Map, so "once per hour"
// silently became "once per login". The durable floor now lives in a tiny table
// that survives restarts; the Map stays as a zero-latency fast path in front of it.
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60 * 60 * 1000;

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS vault_error_alerts (
				        tenant_id    TEXT        NOT NULL,
				        wallet_id    TEXT        NOT NULL,
				        last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				        PRIMARY KEY (tenant_id, wallet_id)
				      )`,
				args: [],
			})
			.then(() => undefined)
			.catch((err) => {
				// Reset so a later call retries; never throw out of the limiter.
				tableReady = null;
				console.error('[vault/report-error] ensureTable failed', err?.message);
			});
	}
	return tableReady;
}

/**
 * True if an alert for this wallet is still within the cooldown. Durable across
 * restarts. On any DB error it falls back to the in-memory decision only, so a
 * database hiccup can neither block a genuine alert nor open the floodgates beyond
 * what the Map already allows.
 */
async function isRateLimited(tenantId: string, walletId: string): Promise<boolean> {
	const key = `${tenantId}:${walletId}`;
	const memLast = rateLimitMap.get(key) ?? 0;
	if (Date.now() - memLast < RATE_LIMIT_MS) return true;

	try {
		await ensureTable();
		const res = await db.execute({
			sql: `SELECT last_sent_at FROM vault_error_alerts
			       WHERE tenant_id = ? AND wallet_id = ?`,
			args: [tenantId, walletId],
		});
		const last = (res.rows?.[0] as any)?.last_sent_at ?? null;
		if (last) {
			const ageMs = Date.now() - new Date(String(last)).getTime();
			if (Number.isFinite(ageMs) && ageMs < RATE_LIMIT_MS) {
				rateLimitMap.set(key, Date.now() - ageMs); // mirror into the fast path
				return true;
			}
		}
	} catch {
		// fall through — memory fast-path already said "not limited"
	}
	return false;
}

async function markSent(tenantId: string, walletId: string): Promise<void> {
	rateLimitMap.set(`${tenantId}:${walletId}`, Date.now());
	try {
		await ensureTable();
		await db.execute({
			sql: `INSERT INTO vault_error_alerts (tenant_id, wallet_id, last_sent_at)
			      VALUES (?, ?, now())
			      ON CONFLICT (tenant_id, wallet_id)
			        DO UPDATE SET last_sent_at = now()`,
			args: [tenantId, walletId],
		});
	} catch { /* the Map still holds the limit for this process */ }
}

export const POST: APIRoute = async ({ request }) => {
	const lang = getLang(request);
	const session = await requireTenantSession(request);
	if (!session) return json({ ok: false }, 401);
	const { tenantId } = session;

	let body: { walletId?: unknown; refCode?: unknown; message?: unknown } = {};
	try { body = await request.json(); } catch { /* ignore bad JSON */ }

	const walletId = String(body.walletId ?? '').slice(0, 64);
	const refCode  = String(body.refCode  ?? '').slice(0, 32);
	const message  = String(body.message  ?? '').slice(0, 500);

	if (!walletId || !refCode) {
		return json({ ok: true, reported: false, reason: 'missing_fields' });
	}

	if (await isRateLimited(tenantId, walletId)) {
		return json({ ok: true, reported: false, reason: 'rate_limited' });
	}
	await markSent(tenantId, walletId);

	const now = new Date().toISOString();

	// Look up the user's alert email via tenant membership
	let userAlertEmail: string | null = null;
	try {
		const res = await db.execute({
			sql: `SELECT au.alert_email
			      FROM tenant_memberships tm
			      JOIN auth_users au ON au.id = tm.user_id
			      WHERE tm.tenant_id = ?
			      LIMIT 1`,
			args: [tenantId],
		});
		const row = res.rows[0] as Record<string, unknown> | undefined;
		userAlertEmail = typeof row?.alert_email === 'string' ? row.alert_email : null;
	} catch { /* non-fatal */ }

	const adminSubject = `[Almstins] Vault load error — wallet …${walletId.slice(-5)}`;
	const adminText = [
		`Ref:    ${refCode}`,
		`Wallet: …${walletId.slice(-5)}`,
		`Tenant: …${tenantId.slice(-8)}`,
		`Error:  ${message || '(no message)'}`,
		`Time:   ${now}`,
		'',
		'A vault tin could not load its token data. Check Alchemy / Blockstream API',
		'status or review Render logs around the timestamp above.',
	].join('\n');

	void sendMail({ to: OWNER_EMAIL, subject: adminSubject, text: adminText }).catch(() => {});

	if (userAlertEmail && userAlertEmail.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
		const { subject: userSubject, text: userText } = getWalletErrorAlert(lang).render({ refCode });
		void sendMail({ to: userAlertEmail, subject: userSubject, text: userText }).catch(() => {});
	}

	console.log(`[vault/report-error] sent for wallet …${walletId.slice(-5)}, ref ${refCode}`);
	return json({ ok: true, reported: true, refCode });
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
