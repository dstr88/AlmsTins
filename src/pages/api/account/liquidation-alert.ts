import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}

	try {
		const res = await db.execute({
			sql: 'SELECT liquidation_alert FROM auth_users WHERE id = ?',
			args: [session.user.id],
		});
		const row = res.rows[0] as Record<string, unknown> | undefined;
		const enabled = (row?.liquidation_alert as number) === 1;
		return json({ ok: true, enabled });
	} catch (err) {
		console.error('[liquidation-alert] GET failed', err);
		return json({ ok: false, error: 'Failed to load' }, 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
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

	const enabled =
		body && typeof body === 'object' && 'enabled' in body
			? Boolean((body as Record<string, unknown>).enabled)
			: false;

	try {
		await db.execute({
			sql: 'UPDATE auth_users SET liquidation_alert = ? WHERE id = ?',
			args: [enabled ? 1 : 0, session.user.id],
		});
		return json({ ok: true, enabled });
	} catch (err) {
		console.error('[liquidation-alert] POST failed', err);
		return json({ ok: false, error: 'Failed to save' }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
