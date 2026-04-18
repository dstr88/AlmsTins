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

function buildEmail(days: number, expiresAt: string): { subject: string; text: string; html: string } {
  const expiryDisplay = fmtDate(expiresAt);
  const urgency = days <= 7 ? '🚨' : '⏳';
  const subject = `${urgency} Your Almstins free year expires in ${days} day${days === 1 ? '' : 's'}`;

  const billingUrl = `${APP_BASE}/dashboard/billing`;
  const dashboardUrl = `${APP_BASE}/dashboard`;

  const text = `
Hi there,

Just a heads-up — your free year of Almstins Unlimited access expires on ${expiryDisplay} (${days} day${days === 1 ? '' : 's'} from now).

After that date your account will revert to the Free plan, which includes:
  - Up to 3 wallets
  - Core portfolio tracking
  - No CSV downloads or Year Summary PDF

To keep your full access — including unlimited wallets, FIFO gain/loss exports, and the Year Summary PDF — upgrade before your promo expires.

View plans and upgrade: ${billingUrl}

Your account and all your data will always be safe — upgrading just keeps your features intact.

— The Almstins Team
${dashboardUrl}
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">

    <div style="background:#1a1f2e;border:1px solid rgba(251,191,36,.2);border-top:3px solid #fbbf24;border-radius:12px;padding:32px;">

      <p style="font-size:28px;margin:0 0 8px;">${urgency}</p>
      <h1 style="font-size:20px;font-weight:700;color:#fde68a;margin:0 0 8px;">
        Your free year expires in ${days} day${days === 1 ? '' : 's'}
      </h1>
      <p style="font-size:14px;color:#9ca3af;margin:0 0 24px;">
        Promo access ends <strong style="color:#fef3c7;">${expiryDisplay}</strong>
      </p>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 16px;">
        After this date your account reverts to the <strong style="color:#fff;">Free plan</strong>, which limits you to:
      </p>
      <ul style="font-size:14px;color:#9ca3af;margin:0 0 24px;padding-left:20px;line-height:2;">
        <li>Up to 3 wallets (tins)</li>
        <li>No CSV downloads</li>
        <li>No Year Summary PDF</li>
      </ul>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 24px;">
        Upgrade before <strong style="color:#fef3c7;">${expiryDisplay}</strong> to keep everything —
        unlimited wallets, gain/loss exports, and your Year Summary.
      </p>

      <a href="${billingUrl}"
         style="display:inline-block;background:#6366f1;color:#fff;font-weight:700;font-size:15px;
                padding:12px 28px;border-radius:8px;text-decoration:none;">
        View Plans &amp; Upgrade →
      </a>

      <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:28px 0;">

      <p style="font-size:13px;color:#6b7280;margin:0;">
        Your account and all your data are always safe — this is just about keeping your features.
        <br><a href="${dashboardUrl}" style="color:#6366f1;">Go to dashboard</a>
      </p>

    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, text, html };
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

  // ── Find redemptions needing a warning email ───────────────────────────────
  // Join through tenant_memberships → auth_users to get email.
  // Only promos that actually expire (not the sentinel) and are still active.
  const rows = await db.execute(`
    SELECT
      pr.id                  AS redemption_id,
      pr.tenant_id,
      pr.code,
      pr.access_expires_at,
      pr.warning_30d_sent_at,
      pr.warning_7d_sent_at,
      COALESCE(au.alert_email, au.email) AS email
    FROM promo_redemptions pr
    JOIN tenant_memberships tm ON tm.tenant_id = pr.tenant_id AND tm.role = 'owner'
    JOIN auth_users au ON au.id = tm.user_id
    WHERE pr.access_expires_at != '${SENTINEL}'
      AND pr.access_expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
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

    const { subject, text, html } = buildEmail(days, expiresAt);

    let sent = false;
    try {
      await sendMail({ to: email, subject, text, html });
      sent = true;

      // Mark as sent
      const col = type === '7d' ? 'warning_7d_sent_at' : 'warning_30d_sent_at';
      await db.execute({
        sql: `UPDATE promo_redemptions SET ${col} = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
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
