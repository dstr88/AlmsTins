import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from '@/lib/db';
import { ensureTenantForUser } from '@/lib/tenants';
import { hashPassword } from '@/lib/passwords';

export const prerender = false;

const MIN_PASSWORD_LENGTH = 10;

function normalizeEmail(input: FormDataEntryValue | null) {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function normalizeName(input: FormDataEntryValue | null) {
	if (typeof input !== 'string') return null;
	const value = input.trim();
	return value.length ? value.slice(0, 120) : null;
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
	const firstName = normalizeName(form.get('first_name'));
	const lastName = normalizeName(form.get('last_name'));
	const password = form.get('password');

	if (!email) {
		return redirect('/signup?error=email', 303);
	}
	if (!firstName) {
		return redirect('/signup?error=first_name', 303);
	}
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
		return redirect('/signup?error=password', 303);
	}

	const existing = await db.execute({
		sql: 'SELECT id FROM auth_users WHERE email = ? LIMIT 1',
		args: [email],
	});
	if (existing.rows.length) {
		return redirect('/signup?error=exists', 303);
	}

	const userId = crypto.randomUUID();
	const fullName = lastName ? `${firstName} ${lastName}` : firstName;
	const passwordHash = await hashPassword(password);

	await db.execute({
		sql: 'INSERT INTO auth_users (id, name, email, email_verified, image) VALUES (?, ?, ?, NULL, NULL)',
		args: [userId, fullName, email],
	});
	await db.execute({
		sql: 'INSERT INTO auth_credentials (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
		args: [userId, passwordHash],
	});

	await ensureTenantForUser(userId, firstName);

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

	return redirect('/login?signup=success', 303);
};
