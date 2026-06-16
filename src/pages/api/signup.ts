import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from '@/lib/db';
import { ensureTenantForUser } from '@/lib/tenants';
import { hashPassword } from '@/lib/passwords';
import { isEmailDomainBlocked } from '@/lib/blockedEmailDomains';
import { isLang, type Lang } from '@/lib/i18n/locale';
import { setUserLang } from '@/lib/i18n/userLang';

export const prerender = false;

const MIN_PASSWORD_LENGTH = 10;

function normalizeEmail(input: FormDataEntryValue | null) {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

async function sendVerificationEmail(email: string, verifyUrl: string) {
	const server = import.meta.env.EMAIL_SERVER;
	const from = import.meta.env.EMAIL_FROM;
	if (!server || !from) return;

	const transport = nodemailer.createTransport(server);
	await transport.sendMail({
		to: email,
		from,
		subject: 'Verify your email address',
		text: `Verify your email address: ${verifyUrl}`,
		html: `<p>Verify your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
	});
}

export const POST: APIRoute = async ({ request, redirect }) => {
	const form = await request.formData();
	const email = normalizeEmail(form.get('email'));
	const password = form.get('password');
	const langRaw = String(form.get('lang') ?? '');
	const lang: Lang = isLang(langRaw) ? langRaw : 'en';
	const signupPath = lang === 'es' ? '/signup/es' : lang === 'fr' ? '/signup/fr' : '/signup';

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
	await db.execute({
		sql: 'INSERT INTO auth_users (id, name, email, email_verified, image) VALUES (?, NULL, ?, NULL, NULL)',
		args: [userId, email],
	});
	await db.execute({
		sql: 'INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
		args: [userId, passwordHash],
	});

	await ensureTenantForUser(userId);
	await setUserLang(userId, lang);

	const token = crypto.randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
	await db.execute({
		sql: 'INSERT INTO signup_verification_tokens (identifier, token, expires) VALUES (?, ?, ?)',
		args: [`signup:${email}`, token, expires],
	});

	const baseUrl = import.meta.env.AUTH_URL || new URL(request.url).origin;
	const verifyUrl = `${baseUrl}/api/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
	try {
		await sendVerificationEmail(email, verifyUrl);
	} catch (error) {
		console.warn('Failed to send verification email', error);
	}

	const loginSuccess =
		lang === 'es' ? '/es?signup=success' : lang === 'fr' ? '/fr?signup=success' : '/login?signup=success';
	return redirect(loginSuccess, 303);
};
