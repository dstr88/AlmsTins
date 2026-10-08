import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getAccountErrors } from '@/i18n/apiErrors/account';
import { normalizeSignupEmail } from '@/lib/emailAddress';
import { isVerifiedUser } from '@/lib/sessionGate';

/**
 * GET returns what verify-monitor's getOwner() would actually mail today: the explicit
 * alert_email if one is set, otherwise the sign-in email it falls back to (SD1) — so the
 * dashboard's "Alerts go to X" line is never out of step with where an alert really goes.
 */
export const GET: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}
	try {
		const res = await db.execute({
			sql: 'SELECT alert_email, email FROM auth_users WHERE id = ? LIMIT 1',
			args: [session.user.id],
		});
		const row = res.rows[0] as Record<string, unknown> | undefined;
		const alertEmail = row && typeof row.alert_email === 'string' ? row.alert_email : null;
		const signInEmail = row && typeof row.email === 'string' ? row.email : null;
		return json({ ok: true, alertEmail, signInEmail, effective: alertEmail ?? signInEmail });
	} catch (err) {
		console.error('[alert-email] DB read failed', err);
		return json({ ok: false, error: 'Failed to load' }, 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const t = getAccountErrors(getLang(request));
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON' }, 400);
	}

	const alertEmail =
		body && typeof body === 'object' && 'alertEmail' in body
			? String((body as Record<string, unknown>).alertEmail ?? '').trim()
			: null;

	// Allow clearing the alert email by sending an empty string
	let value: string | null = alertEmail === '' ? null : alertEmail;

	if (value !== null) {
		// Same conservative check as sign-up: the cron jobs mail whatever is stored here.
		value = normalizeSignupEmail(value);
		if (!value) {
			return json({ ok: false, error: t.invalidEmail }, 400);
		}
		// Pointing alerts at another address makes Almstins mail it on a schedule, so only
		// an accountable account may (a verified email, or a Google/GitHub sign-in).
		if (!(await isVerifiedUser(session.user.id))) {
			return json({ ok: false, error: t.unverified }, 403);
		}
	}

	try {
		await db.execute({
			sql: 'UPDATE auth_users SET alert_email = ? WHERE id = ?',
			args: [value, session.user.id],
		});
		return json({ ok: true, alertEmail: value });
	} catch (err) {
		console.error('[alert-email] DB update failed', err);
		return json({ ok: false, error: 'Failed to save' }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
