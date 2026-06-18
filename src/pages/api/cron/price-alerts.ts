/**
 * GET /api/cron/price-alerts
 *
 * Checks price alert preferences for every user with an alert_email set.
 * Fires an email when the current price crosses their configured threshold.
 * Rate-limited to once every 4 hours per alert to avoid spam.
 *
 * Protected by CRON_SECRET — never exposes user sessions.
 * Called by the GitHub Actions workflow: .github/workflows/price-alerts.yml
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { sendMail } from '@/lib/email';
import { isLang } from '@/lib/i18n/locale';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { getPriceAlertEmail } from '@/i18n/emails/priceAlert';

export const prerender = false;

const RATE_LIMIT_HOURS = 4;
const APP_BASE = process.env.AUTH_URL ?? 'https://almstins.com';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ request }) => {
	// ── Auth ─────────────────────────────────────────────────────────────────
	const secret   = import.meta.env.CRON_SECRET;
	const provided =
		request.headers.get('x-cron-secret') ??
		new URL(request.url).searchParams.get('secret');

	if (!secret || provided !== secret) {
		console.warn('[cron/price-alerts] Unauthorized');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/price-alerts] Starting price alert check');

	// ── Load enabled alerts with email ────────────────────────────────────────
	await ensureUserLangColumn();
	const rows = await db.execute(`
		SELECT
			pap.id              AS alert_id,
			pap.asset_symbol,
			pap.direction,
			pap.threshold,
			pap.last_alerted_at,
			au.alert_email,
			au.email            AS fallback_email,
			au.lang             AS lang
		FROM price_alert_preferences pap
		JOIN auth_users au ON au.id = pap.user_id
		WHERE pap.enabled = 1
		  AND (au.alert_email IS NOT NULL OR au.email IS NOT NULL)
	`);

	type PrefRow = {
		alert_id: unknown;
		asset_symbol: unknown;
		direction: unknown;
		threshold: unknown;
		last_alerted_at: unknown;
		alert_email: unknown;
		fallback_email: unknown;
		lang: unknown;
	};
	const prefs = rows.rows as unknown as PrefRow[];
	console.log(`[cron/price-alerts] ${prefs.length} active alert(s)`);

	if (prefs.length === 0) {
		return json({ ok: true, elapsed_ms: Date.now() - startedAt, alerted: 0, skipped: 0, errored: 0 });
	}

	// ── Fetch current prices once for all alerts ──────────────────────────────
	let tickers: Array<{ symbol: string; quotes?: { USD?: { price?: number } } }> = [];
	try {
		tickers = (await getTickersUSD()) as typeof tickers;
	} catch (err) {
		console.error('[cron/price-alerts] CoinPaprika fetch failed', err);
		return json({ ok: false, error: 'Price feed unavailable' }, 503);
	}

	const priceMap = new Map<string, number>();
	for (const t of tickers) {
		const sym = t.symbol?.toUpperCase();
		if (sym && !priceMap.has(sym)) {
			const price = t.quotes?.USD?.price;
			if (price != null && price > 0) priceMap.set(sym, price);
		}
	}

	const results: Array<{ alertId: string; symbol: string; status: string; price?: number }> = [];

	for (const pref of prefs) {
		const alertId  = String(pref.alert_id);
		const symbol   = String(pref.asset_symbol).toUpperCase();
		const direction = String(pref.direction);
		const threshold = Number(pref.threshold);
		const toEmail  = String(pref.alert_email ?? pref.fallback_email ?? '');
		const lastAlerted = pref.last_alerted_at ? new Date(String(pref.last_alerted_at)) : null;

		if (!toEmail) {
			results.push({ alertId, symbol, status: 'no-email' });
			continue;
		}

		// Rate-limit check
		if (lastAlerted) {
			const hoursSince = (Date.now() - lastAlerted.getTime()) / 3_600_000;
			if (hoursSince < RATE_LIMIT_HOURS) {
				results.push({ alertId, symbol, status: 'rate-limited' });
				continue;
			}
		}

		// Get current price
		const currentPrice = priceMap.get(symbol) ?? null;
		if (currentPrice == null) {
			console.log(`[cron/price-alerts] No price for ${symbol}`);
			results.push({ alertId, symbol, status: 'no-price' });
			continue;
		}

		// Check threshold
		const triggered =
			direction === 'above' ? currentPrice > threshold :
			direction === 'below' ? currentPrice < threshold : false;

		if (!triggered) {
			results.push({ alertId, symbol, status: 'ok', price: currentPrice });
			continue;
		}

		// Send email
		const fmtPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(currentPrice);
		const fmtThreshold = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(threshold);
			const lang = typeof pref.lang === 'string' && isLang(pref.lang) ? pref.lang : 'en';
			const rendered = getPriceAlertEmail(lang).render({ symbol, fmtPrice, fmtThreshold, direction, appBase: APP_BASE });

			try {
				await sendMail({ to: toEmail, subject: rendered.subject, text: rendered.text });

			await db.execute({
				sql: `UPDATE price_alert_preferences SET last_alerted_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
				args: [alertId],
			});

			console.log(`[cron/price-alerts] Sent alert to ${toEmail} — ${symbol} ${direction} ${threshold} (current: ${currentPrice})`);
			results.push({ alertId, symbol, status: 'alerted', price: currentPrice });
		} catch (err) {
			console.error(`[cron/price-alerts] Email failed for ${symbol}`, err);
			results.push({ alertId, symbol, status: 'email-error', price: currentPrice });
		}
	}

	const elapsed  = Date.now() - startedAt;
	const alerted  = results.filter(r => r.status === 'alerted').length;
	const skipped  = results.filter(r => ['rate-limited', 'ok', 'no-price'].includes(r.status)).length;
	const errored  = results.filter(r => r.status.includes('error')).length;

	console.log(`[cron/price-alerts] Done in ${elapsed}ms — alerted: ${alerted}, skipped: ${skipped}, errors: ${errored}`);
	return json({ ok: true, elapsed_ms: elapsed, alerted, skipped, errored, results });
};
