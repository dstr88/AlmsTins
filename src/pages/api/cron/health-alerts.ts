/**
 * GET /api/cron/health-alerts
 *
 * Checks Aave health factors for every user who has an alert preference
 * and an alert email set.  Sends an email when the health factor crosses
 * their configured threshold, rate-limited to once every 4 hours per wallet.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 * Called by the GitHub Actions workflow: .github/workflows/health-alerts.yml
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { isLang } from '@/lib/i18n/locale';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { getHealthAlert } from '@/i18n/emails/healthAlert';

export const prerender = false;

const RATE_LIMIT_HOURS = 4;
const AAVE_HEALTH_BASE  = process.env.AUTH_URL ?? 'https://almstins.com';

export const GET: APIRoute = async ({ request }) => {
	// ── Auth ────────────────────────────────────────────────────────────────
	const secret   = import.meta.env.CRON_SECRET;
	const provided =
		request.headers.get('x-cron-secret') ??
		new URL(request.url).searchParams.get('secret');

	if (!secret || provided !== secret) {
		console.warn('[cron/health-alerts] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/health-alerts] Starting health factor check');

	// ── Load all actionable preferences ────────────────────────────────────
	// Join with auth_users to get alert_email + lang, join with wallets to get address.
	// Only rows where:
	//   - alert is enabled
	//   - user has an alert_email
	//   - wallet_id is set (wallet-level alerts only for now)
	await ensureUserLangColumn();
	const rows = await db.execute(`
		SELECT
			ap.id            AS pref_id,
			ap.user_id,
			ap.wallet_id,
			ap.threshold,
			ap.direction,
			ap.last_alerted_at,
			au.alert_email,
			au.lang          AS lang,
			w.address        AS wallet_address,
			w.label          AS wallet_label
		FROM alert_preferences ap
		JOIN auth_users  au ON au.id = ap.user_id
		JOIN wallets      w ON w.id  = ap.wallet_id
		WHERE ap.enabled    = 1
		  AND au.alert_email IS NOT NULL
		  AND ap.wallet_id  IS NOT NULL
	`);

	const prefs = rows.rows as unknown as Array<Record<string, unknown> & { lang: unknown }>;
	console.log(`[cron/health-alerts] Checking ${prefs.length} active alert(s)`);

	const results: Array<{ walletId: string; status: string; hf?: number }> = [];

	for (const pref of prefs) {
		const prefId      = String(pref.pref_id);
		const walletId    = String(pref.wallet_id);
		const address     = String(pref.wallet_address ?? '');
		const label       = String(pref.wallet_label ?? address.slice(0, 8));
		const alertEmail  = String(pref.alert_email);
		const threshold   = Number(pref.threshold);
		const direction   = String(pref.direction);  // 'below' | 'above'
		const lastAlerted = pref.last_alerted_at ? new Date(String(pref.last_alerted_at)) : null;

		// ── Rate-limit check ─────────────────────────────────────────────────
		if (lastAlerted) {
			const hoursSinceLast = (Date.now() - lastAlerted.getTime()) / 3_600_000;
			if (hoursSinceLast < RATE_LIMIT_HOURS) {
				console.log(`[cron/health-alerts] Skipping ${label} — alerted ${hoursSinceLast.toFixed(1)}h ago`);
				results.push({ walletId, status: 'rate-limited' });
				continue;
			}
		}

		// ── Fetch health factor ───────────────────────────────────────────────
		let hf: number | null = null;
		let hfChain = 'unknown';
		try {
			const res  = await fetch(
				`${AAVE_HEALTH_BASE}/api/aave/health?address=${encodeURIComponent(address)}`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json() as { ok?: boolean; chains?: Record<string, { healthFactor?: unknown }> };

			// Find the first chain with a real health factor
			for (const [chain, summary] of Object.entries(data.chains ?? {})) {
				const raw = Number(summary?.healthFactor ?? NaN);
				if (Number.isFinite(raw) && raw > 0) {
					hf      = raw;
					hfChain = chain;
					break;
				}
			}
		} catch (err) {
			console.error(`[cron/health-alerts] Failed to fetch HF for ${label}`, err);
			results.push({ walletId, status: 'fetch-error' });
			continue;
		}

		if (hf === null) {
			console.log(`[cron/health-alerts] No active positions for ${label}`);
			results.push({ walletId, status: 'no-positions' });
			continue;
		}

		// ── Threshold check ───────────────────────────────────────────────────
		const triggered =
			direction === 'below' ? hf < threshold :
			direction === 'above' ? hf > threshold : false;

		console.log(
			`[cron/health-alerts] ${label} HF=${hf.toFixed(2)} threshold=${direction} ${threshold} triggered=${triggered}`,
		);

		if (!triggered) {
			results.push({ walletId, status: 'ok', hf });
			continue;
		}

		// ── Send alert email ──────────────────────────────────────────────────
		const hfFormatted = hf.toFixed(2);
		const chainLabel  = hfChain.charAt(0).toUpperCase() + hfChain.slice(1);
		const lang        = typeof pref.lang === 'string' && isLang(pref.lang) ? pref.lang : 'en';
		const { subject, text } = getHealthAlert(lang).render({
			label,
			address,
			chainLabel,
			hfFormatted,
			direction,
			threshold,
			appBase: AAVE_HEALTH_BASE,
		});

		try {
			await sendMail({ to: alertEmail, subject, text });

			// ── Record send time ───────────────────────────────────────────────
			await db.execute({
				sql: `UPDATE alert_preferences SET last_alerted_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
				args: [prefId],
			});

			console.log(`[cron/health-alerts] Alert sent to ${alertEmail} for ${label} (HF=${hfFormatted})`);
			results.push({ walletId, status: 'alerted', hf });
		} catch (err) {
			console.error(`[cron/health-alerts] Email send failed for ${label}`, err);
			results.push({ walletId, status: 'email-error', hf });
		}

		// Small pause between wallets to avoid hammering the Aave API
		await new Promise((r) => setTimeout(r, 500));
	}

	const elapsed  = Date.now() - startedAt;
	const alerted  = results.filter((r) => r.status === 'alerted').length;
	const skipped  = results.filter((r) => r.status === 'rate-limited' || r.status === 'ok' || r.status === 'no-positions').length;
	const errored  = results.filter((r) => r.status.includes('error')).length;

	console.log(`[cron/health-alerts] Done in ${elapsed}ms — alerted: ${alerted}, skipped: ${skipped}, errors: ${errored}`);

	return json({ ok: true, elapsed_ms: elapsed, alerted, skipped, errored, results });
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
