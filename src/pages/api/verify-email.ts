import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, redirect }) => {
	const url = new URL(request.url);
	const token = url.searchParams.get('token');
	const email = url.searchParams.get('email');

	if (!token || !email) {
		return redirect('/login?verified=failed', 303);
	}

	const lookup = await db.execute({
		sql: 'SELECT token, expires FROM signup_verification_tokens WHERE identifier = ? AND token = ? LIMIT 1',
		args: [`signup:${email.toLowerCase()}`, token],
	});
	if (!lookup.rows.length) {
		return redirect('/login?verified=failed', 303);
	}

	const expires = String(lookup.rows[0].expires ?? '');
	if (expires && new Date(expires).getTime() < Date.now()) {
		await db.execute({
			sql: 'DELETE FROM signup_verification_tokens WHERE identifier = ? AND token = ?',
			args: [`signup:${email.toLowerCase()}`, token],
		});
		return redirect('/login?verified=expired', 303);
	}

	await db.execute({
		sql: `UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE email = ?`,
		args: [email.toLowerCase()],
	});
	await db.execute({
		sql: 'DELETE FROM signup_verification_tokens WHERE identifier = ? AND token = ?',
		args: [`signup:${email.toLowerCase()}`, token],
	});

	return redirect('/login?verified=success', 303);
};
