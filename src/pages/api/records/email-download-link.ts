/**
 * POST /api/records/email-download-link   body: { "path": "/dashboard/wallets" }
 *
 * Emails the signed-in account's own address a link to the dashboard page it asked from. The email
 * never carries the file: the link opens the page, and the download is made from there with the
 * session (src/lib/historyDownloadLink.ts). Same plan rule as the download itself
 * (src/lib/historyAccess.ts). Demo sessions get a 403, so no mail goes out for a demo account.
 *
 * One link per account every few minutes: a second request inside the cooldown is a JSON 429.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAuthSession } from '@/lib/authSession';
import { getActivePlan } from '@/lib/subscriptions';
import { canDownloadHistoryByWallet } from '@/lib/historyAccess';
import { sendMail } from '@/lib/email';
import { getLang } from '@/lib/i18n/locale';
import { json } from '@/lib/http';
import {
	downloadLinkEmail,
	emailCooldownLeft,
	markEmailSent,
	safeDashboardPath,
} from '@/lib/historyDownloadLink';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401, { noStore: true });
	if (session.isDemo) return json({ error: 'Not available in the demo.' }, 403, { noStore: true });

	const auth = await getAuthSession(request).catch(() => null);
	const userId = auth?.user?.id;
	const email = auth?.user?.email;
	if (!userId || !email) return json({ error: 'This account has no email address.' }, 400, { noStore: true });

	const plan = await getActivePlan(session.tenantId);
	if (!canDownloadHistoryByWallet(plan.id, session.tenantId)) {
		return json({ error: 'Downloading your history by wallet is included in every paid plan.', planRequired: 'paid' }, 403, {
			noStore: true,
		});
	}

	const cooldown = emailCooldownLeft(userId);
	if (cooldown > 0) {
		return json({ error: 'A link was sent recently.', retryAfterSeconds: Math.ceil(cooldown / 1000) }, 429, {
			noStore: true,
		});
	}

	const body = (await request.json().catch(() => ({}))) as { path?: unknown };
	const pageUrl = new URL(safeDashboardPath(body.path), new URL(request.url).origin).toString();
	const mail = downloadLinkEmail({ lang: getLang(request), url: pageUrl });

	await sendMail({ to: email, subject: mail.subject, text: mail.text });
	markEmailSent(userId);
	return json({ ok: true }, 200, { noStore: true });
};
