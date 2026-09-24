/**
 * The password sign-up's email verification: issue a token and email the link, at sign-up
 * and again (rate-limited) when an unverified password user tries to sign in.
 *
 * The resend is limited three ways, because each attempt mails an address someone typed
 * into a form and that someone need not own it:
 *   - per address, in memory: at most one per 15 minutes;
 *   - per client IP (an IPv6 client by its /64), in memory: at most 10 per hour;
 *   - per address, durable: nothing if a token was issued in the last 15 minutes, and
 *     nothing once 3 tokens are still live (24h). Read from signup_verification_tokens,
 *     so a deploy or restart does not reset it.
 * Never logs the address.
 */
import crypto from 'node:crypto';
import { db } from './db';
import { sendMail } from './email';
import { clientIpKey, createFixedWindowLimiter } from './rateLimit';
import { getUserLang } from './i18n/userLang';
import type { Lang } from './i18n/locale';
import { getVerifyEmail } from '@/i18n/emails/verifyEmail';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_LIVE_TOKENS = 3;

const perEmail = createFixedWindowLimiter({ windowMs: RESEND_COOLDOWN_MS, max: 1 });
const perIp = createFixedWindowLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

export const signupTokenIdentifier = (email: string) => `signup:${email}`;

/** Public origin for emailed links. Never the request origin: behind Render's proxy that is localhost. */
export function appBaseUrl(): string {
	const importMetaEnv = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {});
	const raw = (process.env.AUTH_URL || importMetaEnv.AUTH_URL || '').trim();
	if (!raw) return 'https://almstins.com';
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	return withScheme.replace(/\/+$/, '');
}

/** Create a 24h verification token for `email` and email the link. Throws only if the token can't be stored. */
export async function issueSignupVerification({ email, lang }: { email: string; lang: Lang }): Promise<void> {
	const token = crypto.randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
	await db.execute({
		sql: 'INSERT INTO signup_verification_tokens (identifier, token, expires) VALUES (?, ?, ?)',
		args: [signupTokenIdentifier(email), token, expires],
	});

	// The confirmation page, not the API: opening the link confirms nothing (see /verify-email).
	const verifyUrl = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&lang=${lang}`;
	const t = getVerifyEmail(lang);
	try {
		await sendMail({ to: email, subject: t.subject, text: t.text(verifyUrl), html: t.html(verifyUrl) });
	} catch (error) {
		console.warn('[signupVerification] failed to send verification email', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** True when the durable token log says this address was mailed too recently or too often. */
async function recentlyIssued(email: string, now: number): Promise<boolean> {
	const res = await db.execute({
		sql: `SELECT expires FROM signup_verification_tokens WHERE identifier = ?`,
		args: [signupTokenIdentifier(email)],
	});
	const issuedAt = (res.rows as Record<string, unknown>[])
		.map((r) => Date.parse(String(r.expires ?? '')) - TOKEN_TTL_MS)
		.filter((t) => Number.isFinite(t));
	const live = issuedAt.filter((t) => t + TOKEN_TTL_MS > now);
	if (live.length >= MAX_LIVE_TOKENS) return true;
	return issuedAt.some((t) => t > now - RESEND_COOLDOWN_MS);
}

export type ResendOutcome = 'sent' | 'throttled' | 'failed';

/**
 * Re-send the verification email for an unverified password user who just proved the
 * password. Rate-limited as described above; never throws.
 */
export async function maybeResendSignupVerification(
	userId: string,
	email: string,
	request: Request | null | undefined,
	now = Date.now(),
): Promise<ResendOutcome> {
	try {
		if (perEmail.hit(email, now)) return 'throttled';
		if (perIp.hit(request ? clientIpKey(request) : 'ip:unknown', now)) return 'throttled';
		if (await recentlyIssued(email, now)) return 'throttled';
		await issueSignupVerification({ email, lang: await getUserLang(userId) });
		return 'sent';
	} catch (error) {
		console.warn('[signupVerification] resend failed', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}

/** Test hook: clear the in-memory limiters. */
export function __resetSignupVerificationLimitsForTests(): void {
	perEmail.reset();
	perIp.reset();
}
