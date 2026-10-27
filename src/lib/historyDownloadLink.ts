/**
 * The "email me a download link" action on the history download: the cooldown, the page the link
 * opens, and the email text. The email never carries the file (see src/i18n/historyDownloadEmail.ts).
 */
import { getDownloadLinkEmail } from '@/i18n/historyDownloadEmail';
import type { Lang } from '@/lib/i18n/locale';

export const DOWNLOAD_LINK_COOLDOWN_MS = 5 * 60 * 1000;

const DEFAULT_PAGE = '/dashboard/wallets';
// Only a dashboard page is ever linked: the path comes from the browser, and an email should never
// point anywhere else.
const SAFE_PATH = /^\/dashboard\/[a-z0-9/-]*(\?[a-z0-9=&_-]*)?$/i;

const lastSentAt = new Map<string, number>();

/** Milliseconds until this account may ask for another link (0 when it may ask now). */
export function emailCooldownLeft(userId: string, now: number = Date.now()): number {
	const last = lastSentAt.get(userId);
	if (last === undefined) return 0;
	return Math.max(0, DOWNLOAD_LINK_COOLDOWN_MS - (now - last));
}

export function markEmailSent(userId: string, now: number = Date.now()): void {
	lastSentAt.set(userId, now);
}

/** Tests reset the cooldowns between cases. */
export function resetEmailCooldowns(): void {
	lastSentAt.clear();
}

/** The dashboard page the button was pressed on, or the wallets page when the path is not one. */
export function safeDashboardPath(input: unknown): string {
	if (typeof input !== 'string' || !SAFE_PATH.test(input) || input.includes('//')) return DEFAULT_PAGE;
	return input;
}

export function downloadLinkEmail(opts: { lang: Lang; url: string }): { subject: string; text: string } {
	const t = getDownloadLinkEmail(opts.lang).mail;
	return {
		subject: t.subject,
		text: [t.body, '', t.linkIntro, opts.url, '', t.footer].join('\n'),
	};
}
