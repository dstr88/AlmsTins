/**
 * GET /api/cron/promo-expiry
 *
 * Sends warning emails to users whose promo access is expiring soon.
 * Runs daily via GitHub Actions.
 *
 * Sends two warnings per redemption:
 *   - 30-day warning  (warning_30d_sent_at)
 *   - 7-day warning   (warning_7d_sent_at)
 *
 * Protected by CRON_SECRET header or ?secret= query param.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { isLang } from '@/lib/i18n/locale';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { getPromoExpiry } from '@/i18n/emails/promoExpiry';

export const prerender = false;

const APP_BASE = process.env.AUTH_URL ?? 'https://almstins.com';
const SENTINEL = '9999-12-31T23:59:59Z';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function daysUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(iso));
}

export const GET: APIRoute = async ({ request }) => {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret   = process.env.CRON_SECRET ?? import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret');

  if (!secret || provided !== secret) {
    console.warn('[cron/promo-expiry] Unauthorized');
    return json({ error: 'Unauthorized' }, 401);
  }

  console.log('[cron/promo-expiry] Starting promo expiry check');
  const results: Array<{ redemptionId: string; email: string; days: number; type: '30d' | '7d'; sent: boolean }> = [];

  // ── Ensure auth_users.lang column exists ──────────────────────────────────
  await ensureUserLangColumn();

  // ── Find redemptions needing a warning email ───────────────────────────────
  // Join through tenant_memberships → auth_users to get email and lang.
  // Only promos that actually expire (not the sentinel) and are still active.
  const rows = await db.execute(`
    SELECT
      pr.id                  AS redemption_id,
      pr.tenant_id,
      pr.code,
      pr.access_expires_at,
      pr.warning_30d_sent_at,
      pr.warning_7d_sent_at,
      COALESCE(au.alert_email, au.email) AS email,
      au.lang                AS lang
    FROM promo_redemptions pr
    JOIN tenant_memberships tm ON tm.tenant_id = pr.tenant_id AND tm.role = 'owner'
    JOIN auth_users au ON au.id = tm.user_id
    WHERE pr.access_expires_at != '${SENTINEL}'
      AND pr.access_expires_at > to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND (
           (julianday(pr.access_expires_at) - julianday('now') <= 30 AND pr.warning_30d_sent_at IS NULL)
        OR (julianday(pr.access_expires_at) - julianday('now') <= 7  AND pr.warning_7d_sent_at  IS NULL)
      )
  `).then(r => r.rows as Array<Record<string, unknown>>).catch(() => []);

  for (const row of rows) {
    const redemptionId = String(row.redemption_id);
    const expiresAt    = String(row.access_expires_at);
    const email        = row.email ? String(row.email) : null;
    const days         = daysUntil(expiresAt);

    if (!email || days <= 0) continue;

    // Determine which warning to send (7d takes priority if both are due)
    const need7d  = days <= 7  && !row.warning_7d_sent_at;
    const need30d = days <= 30 && !row.warning_30d_sent_at;
    const type: '30d' | '7d' = need7d ? '7d' : '30d';

    if (!need7d && !need30d) continue;

    // Resolve language and render the locale
    const rawLang = row.lang;
    const lang = isLang(rawLang) ? rawLang : 'en';
    const expiryDisplay = fmtDate(expiresAt);
    const urgency = days <= 7 ? '🚨' : '⏳';
    const { subject, text, html } = getPromoExpiry(lang).render({
      days,
      expiryDisplay,
      urgency,
      billingUrl: `${APP_BASE}/dashboard/billing`,
      dashboardUrl: `${APP_BASE}/dashboard`,
    });

    let sent = false;
    try {
      await sendMail({ to: email, subject, text, html });
      sent = true;

      // Mark as sent
      const col = type === '7d' ? 'warning_7d_sent_at' : 'warning_30d_sent_at';
      await db.execute({
        sql: `UPDATE promo_redemptions SET ${col} = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id = ?`,
        args: [redemptionId],
      });

      console.log(`[cron/promo-expiry] Sent ${type} warning to ${email} (${days} days left)`);
    } catch (err) {
      console.error(`[cron/promo-expiry] Failed to send to ${email}:`, err);
    }

    results.push({ redemptionId, email, days, type, sent });
  }

  console.log(`[cron/promo-expiry] Done — processed ${results.length} warning(s)`);
  return json({ ok: true, checked: rows.length, sent: results.filter(r => r.sent).length, results });
};
