import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/passwords';
import { isEmailDomainBlocked } from '@/lib/blockedEmailDomains';
import { isLang, type Lang } from '@/lib/i18n/locale';
import { setUserLang } from '@/lib/i18n/userLang';
import { ensureAuthUsersCreatedAt } from '@/lib/authAdapter';
import { normalizeSignupEmail } from '@/lib/emailAddress';
import { getClientIp } from '@/lib/analytics/ip';
import { createFixedWindowLimiter, ipBucket } from '@/lib/rateLimit';
import { issueSignupVerification } from '@/lib/signupVerification';

export const prerender = false;

const MIN_PASSWORD_LENGTH = 10;

// /api/signup is a public path (no middleware in front of it), so this handler is the only
// place sign-up volume can be limited. Every POST counts, valid or not: a scanner probing
// the form with junk is exactly what this is for. Keyed on the Cloudflare-set client IP
// (an IPv6 client by its /64, see ipBucket).
const signupLimiter = createFixedWindowLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

function clientKey(request: Request, clientAddress: () => string): string {
	let fallback = 'unknown';
	try { fallback = clientAddress() || fallback; } catch { /* adapter without a client address */ }
	return `ip:${ipBucket(getClientIp(request) ?? fallback)}`;
}

export const POST: APIRoute = async (context) => {
	const { request, redirect } = context;
	const form = await request.formData();
	const email = normalizeSignupEmail(form.get('email'));
	const password = form.get('password');
	const langRaw = String(form.get('lang') ?? '');
	const lang: Lang = isLang(langRaw) ? langRaw : 'en';
	const signupPath = lang === 'es' ? '/signup/es' : lang === 'fr' ? '/signup/fr' : '/signup';

	if (signupLimiter.hit(clientKey(request, () => context.clientAddress))) {
		return redirect(`${signupPath}?error=rate_limited`, 303);
	}

	if (!email) {
		return redirect(`${signupPath}?error=email`, 303);
	}
	if (isEmailDomainBlocked(email)) {
		return redirect(`${signupPath}?error=email_domain`, 303);
	}
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
		return redirect(`${signupPath}?error=password`, 303);
	}

	const existing = await db.execute({
		sql: 'SELECT id FROM auth_users WHERE email = ? LIMIT 1',
		args: [email],
	});
	if (existing.rows.length) {
		return redirect(`${signupPath}?error=exists`, 303);
	}

	const userId = crypto.randomUUID();
	const passwordHash = await hashPassword(password);

	// Store no name — only the email — matching the OAuth path (authAdapter.createUser).
	await ensureAuthUsersCreatedAt();
	await db.execute({
		sql: `INSERT INTO auth_users (id, name, email, email_verified, image, created_at)
		      VALUES (?, NULL, ?, NULL, NULL, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [userId, email],
	});
	await db.execute({
		sql: `INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at) VALUES (?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'), to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [userId, passwordHash],
	});

	// No tenant yet. It is created at the first successful sign-in (the Auth.js jwt
	// callback), which a password user reaches only after verifying the address. An
	// unverified sign-up therefore owns nothing and triggers no new-tenant notice.
	await setUserLang(userId, lang);

	await issueSignupVerification({ email, lang });

	const loginSuccess =
		lang === 'es' ? '/es?signup=success' : lang === 'fr' ? '/fr?signup=success' : '/login?signup=success';
	return redirect(loginSuccess, 303);
};
