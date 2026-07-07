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

// Per-wallet rate limit: one email per wallet per hour.
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60 * 60 * 1000;

// Per-tenant burst limit: at most one email per 10 minutes across ALL wallets
// for the same tenant. Prevents cold-start floods where every wallet fires
// simultaneously and each one would otherwise send its own email.
const tenantBurstMap = new Map<string, number>();
const TENANT_BURST_MS = 10 * 60 * 1000;

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

	// Tenant-level burst check first — if another wallet already fired an email
	// for this tenant in the last 10 minutes, skip entirely.
	const lastTenantSent = tenantBurstMap.get(tenantId) ?? 0;
	if (Date.now() - lastTenantSent < TENANT_BURST_MS) {
		return json({ ok: true, reported: false, reason: 'tenant_burst_limited' });
	}

	const rateKey = `${tenantId}:${walletId}`;
	const lastSent = rateLimitMap.get(rateKey) ?? 0;
	if (Date.now() - lastSent < RATE_LIMIT_MS) {
		return json({ ok: true, reported: false, reason: 'rate_limited' });
	}
	rateLimitMap.set(rateKey, Date.now());
	tenantBurstMap.set(tenantId, Date.now());

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
