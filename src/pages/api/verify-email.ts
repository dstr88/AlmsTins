/**
 * Password sign-up email verification.
 *
 *   GET  /api/verify-email?token&email[&lang]  -> 303 to the /verify-email confirmation page.
 *        Links in emails sent before the page existed point here. A GET never verifies
 *        anything: mail-security scanners open every link in an inbox, and a GET that
 *        verified would let a scanner confirm a password someone else registered on the
 *        recipient's address.
 *   POST /api/verify-email (form: token, email, lang) -> verify, then 303 to the sign-in
 *        page in that language with ?verified=success|expired|failed.
 *
 * Public (isPublicPath): the token is the capability, and the person verifying is by
 * definition not signed in yet (password sign-in refuses unverified addresses).
 *
 * A token stays usable until it expires, so pressing the button twice, or opening an older
 * link from the same day, still says "verified" instead of "failed". Taking the address
 * back through Google/GitHub or an email link (authLinkGuard) spends them all.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { invalidateUserAuthFacts } from '@/lib/sessionGate';
import { loginPathForLang } from '@/lib/authErrorRedirect';

export const prerender = false;

const langOf = (v: unknown) => (v === 'es' || v === 'fr' ? v : 'en');

export const GET: APIRoute = async ({ request, redirect }) => {
	const src = new URL(request.url).searchParams;
	const dest = new URLSearchParams();
	for (const key of ['token', 'email', 'lang']) {
		const v = src.get(key);
		if (v) dest.set(key, v);
	}
	return redirect(`/verify-email?${dest.toString()}`, 303);
};

export const POST: APIRoute = async ({ request, redirect }) => {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return redirect('/login?verified=failed', 303);
	}
	const token = String(form.get('token') ?? '').trim();
	const email = String(form.get('email') ?? '').trim().toLowerCase();
	const login = loginPathForLang(langOf(form.get('lang')));

	if (!token || !email || token.length > 256 || email.length > 254) {
		return redirect(`${login}?verified=failed`, 303);
	}
	const identifier = `signup:${email}`;

	const lookup = await db.execute({
		sql: 'SELECT token, expires FROM signup_verification_tokens WHERE identifier = ? AND token = ? LIMIT 1',
		args: [identifier, token],
	});
	if (!lookup.rows.length) {
		return redirect(`${login}?verified=failed`, 303);
	}

	const expires = String(lookup.rows[0].expires ?? '');
	if (expires && new Date(expires).getTime() < Date.now()) {
		await db.execute({
			sql: 'DELETE FROM signup_verification_tokens WHERE identifier = ? AND token = ?',
			args: [identifier, token],
		});
		return redirect(`${login}?verified=expired`, 303);
	}

	const verified = await db.execute({
		sql: `UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
		      WHERE email = ? AND (email_verified IS NULL OR email_verified = '')
		      RETURNING id`,
		args: [email],
	});
	// The session gate caches "unverified" for up to a minute; drop it so the user can sign
	// in right away.
	for (const row of verified.rows as Record<string, unknown>[]) {
		invalidateUserAuthFacts(String(row.id));
	}
	if (!verified.rows.length) {
		// Nothing changed: already verified (a second press), or the account is gone.
		const still = await db.execute({ sql: 'SELECT 1 AS ok FROM auth_users WHERE email = ? LIMIT 1', args: [email] });
		if (!still.rows.length) return redirect(`${login}?verified=failed`, 303);
	}

	return redirect(`${login}?verified=success`, 303);
};
