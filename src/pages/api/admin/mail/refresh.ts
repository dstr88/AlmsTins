/**
 * POST /api/admin/mail/refresh   { mailbox?: string }
 *
 * Polls now, instead of waiting for the 15-minute cron.
 *
 * This exists because the panel is the only way one operator reaches his mail. Without
 * it, "I just emailed you" is followed by refreshing a page that cannot possibly show
 * the message yet, which reads as broken rather than as scheduled.
 *
 * Admin-guarded (not CRON_SECRET) — it is a user action, and it only ever polls
 * mailboxes the calling admin can already see.
 */

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { findMailboxForAdmin, getMailboxesForAdmin, mailConfigStatus } from '@/lib/mailboxes';
import { pollMailbox, type PollResult } from '@/lib/mailSync';

export const prerender = false;

/**
 * Per-mailbox cooldown, in memory. IMAP servers throttle aggressive reconnection, and
 * a held-down button should not be the thing that gets the account rate-limited.
 * Resets on restart, which is fine — the worst case is one extra poll.
 */
const COOLDOWN_MS = 15_000;
const lastPoll = new Map<string, number>();

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	let who: { userId: string; email: string };
	try {
		who = await requireAdminSession(request);
	} catch (resp) {
		return resp instanceof Response ? resp : json({ ok: false, error: 'Unauthorized' }, 401);
	}

	const status = mailConfigStatus();
	if (!status.configured) return json({ ok: false, error: status.reason }, 400);

	// A specific mailbox if asked for, otherwise every one this admin can see.
	let targets = getMailboxesForAdmin(who);
	const requested = await request.json().catch(() => ({} as Record<string, unknown>));
	if (requested && typeof requested === 'object' && (requested as any).mailbox) {
		const one = findMailboxForAdmin(String((requested as any).mailbox), who);
		if (!one) return json({ ok: false, error: 'Unknown mailbox' }, 404);
		targets = [one];
	}

	const now = Date.now();
	const results: PollResult[] = [];
	const throttled: string[] = [];

	for (const box of targets) {
		const last = lastPoll.get(box.address) ?? 0;
		if (now - last < COOLDOWN_MS) {
			throttled.push(box.address);
			continue;
		}
		lastPoll.set(box.address, now);
		results.push(await pollMailbox(box));
	}

	return json({
		ok: true,
		inserted: results.reduce((n, r) => n + r.inserted, 0),
		throttled,
		results,
	});
};
