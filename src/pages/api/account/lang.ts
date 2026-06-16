import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { isLang } from '@/lib/i18n/locale';
import { setUserLang } from '@/lib/i18n/userLang';

// Persist the dashboard language switch to the user's account so emails
// (digests, price/health alerts, promo expiry, receipts) match it. Called
// fire-and-forget by the Layout.astro switcher before it reloads.
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

	const raw =
		body && typeof body === 'object' && 'lang' in body
			? String((body as Record<string, unknown>).lang ?? '')
			: '';
	if (!isLang(raw)) {
		return json({ ok: false, error: 'Invalid language' }, 400);
	}

	await setUserLang(session.user.id, raw);
	return json({ ok: true, lang: raw });
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
