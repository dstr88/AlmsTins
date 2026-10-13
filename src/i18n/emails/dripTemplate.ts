// Shared drip-email template — used by every campaign (onboarding, business, …).
// Each campaign supplies its own DripLocale content (EN/ES/FR); this renders the
// HTML/text, including the Telegram + reply contact line and the unsubscribe footer.
// Content is static (no user input), so no escaping is needed.

import type { Lang } from '@/lib/i18n/locale';

export interface DripEmail {
  subject: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaPath: string; // appended to the app base for an absolute link
}

export interface DripLocale {
  lang: Lang;
  brand: string;
  signoff: string;
  unsubscribe: string;
  contact: string; // "reply or reach me on Telegram" lead-in (@devdonnie is appended)
  emails: DripEmail[];
}

export const TELEGRAM_HANDLE = '@devdonnie';
export const TELEGRAM_URL = 'https://t.me/devdonnie';

/** Render one step (1-based) of a campaign locale into { subject, html, text }. */
export function renderDrip(
  loc: DripLocale,
  step: number,
  appBase: string,
  unsubscribeUrl: string,
): { subject: string; html: string; text: string } {
  const idx = Math.min(Math.max(step, 1), loc.emails.length) - 1;
  const e = loc.emails[idx];
  const ctaUrl = `${appBase}${e.ctaPath}`;

  const text = [
    ...e.paragraphs,
    `${e.ctaLabel}: ${ctaUrl}`,
    loc.signoff,
    `${loc.contact}: ${TELEGRAM_HANDLE} (${TELEGRAM_URL})`,
    '',
    `${loc.unsubscribe}: ${unsubscribeUrl}`,
  ].join('\n\n');

  const paras = e.paragraphs
    .map((p) => `<p style="font-size:15px;line-height:1.6;color:#33373d;margin:0 0 16px;">${p}</p>`)
    .join('');

  const html = `<div style="background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;color:#1a1a1a;">
    <div style="font-weight:700;font-size:18px;color:#0a0f1a;margin-bottom:20px;">${loc.brand}</div>
    ${paras}
    <a href="${ctaUrl}" style="display:inline-block;background:#2dd4a8;color:#08120e;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:8px;margin:6px 0 20px;">${e.ctaLabel} &rarr;</a>
    <p style="font-size:15px;line-height:1.6;color:#33373d;margin:0;">${loc.signoff}</p>
    <hr style="border:none;border-top:1px solid #e6e8eb;margin:24px 0 14px;">
    <p style="font-size:12px;line-height:1.5;color:#9aa0a6;margin:0;">
      ${loc.contact}: <a href="${TELEGRAM_URL}" style="color:#2dd4a8;text-decoration:none;">${TELEGRAM_HANDLE}</a><br>
      ${loc.brand} &middot; <a href="${appBase}" style="color:#9aa0a6;">almstins.com</a><br>
      <a href="${unsubscribeUrl}" style="color:#9aa0a6;">${loc.unsubscribe}</a>
    </p>
  </div>
</div>`;

  return { subject: e.subject, html, text };
}
