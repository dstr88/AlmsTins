import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getAccountErrors } from '@/i18n/apiErrors/account';

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
	const value = alertEmail === '' ? null : alertEmail;

	// Basic format check when a value is provided
	if (value !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
		return json({ ok: false, error: t.invalidEmail }, 400);
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
