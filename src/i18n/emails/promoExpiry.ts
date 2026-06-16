// Promo-expiry warning email (cron) — EN · ES · FR.
//
// Email-i18n pattern: same as priceAlert.ts — the locale exposes
// render(args) -> { subject, text, html }; the cron resolves the recipient's
// stored language (auth_users.lang via au.lang in the SELECT) and calls render().
// Bodies use template literals (backticks), so apostrophes are safe.
// Numbers, dates, $ amounts, URLs, HTML tags, and inline styles are untouched.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedPromoExpiryEmail {
  subject: string;
  text: string;
  html: string;
}

export interface PromoExpiryEmailLocale {
  lang: Lang;
  render: (a: {
    days: number;
    expiryDisplay: string; // pre-formatted date string, e.g. "June 30, 2026"
    urgency: string;       // '🚨' or '⏳'
    billingUrl: string;
    dashboardUrl: string;
  }) => RenderedPromoExpiryEmail;
}

export const en: PromoExpiryEmailLocale = {
  lang: 'en',
  render: ({ days, expiryDisplay, urgency, billingUrl, dashboardUrl }) => {
    const dayWord = days === 1 ? 'day' : 'days';
    return {
      subject: `${urgency} Your Almstins free year expires in ${days} ${dayWord}`,
      text: `
Hi there,

Just a heads-up — your free year of Almstins Unlimited access expires on ${expiryDisplay} (${days} ${dayWord} from now).

After that date your account will revert to the Free plan, which includes:
  - Up to 3 wallets
  - Core portfolio tracking
  - No CSV downloads or Year Summary PDF

To keep your full access — including unlimited wallets, FIFO gain/loss exports, and the Year Summary PDF — upgrade before your promo expires.

View plans and upgrade: ${billingUrl}

Your account and all your data will always be safe — upgrading just keeps your features intact.

— The Almstins Team
${dashboardUrl}
      `.trim(),
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">

    <div style="background:#1a1f2e;border:1px solid rgba(251,191,36,.2);border-top:3px solid #fbbf24;border-radius:12px;padding:32px;">

      <p style="font-size:28px;margin:0 0 8px;">${urgency}</p>
      <h1 style="font-size:20px;font-weight:700;color:#fde68a;margin:0 0 8px;">
        Your free year expires in ${days} ${dayWord}
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
      `.trim(),
    };
  },
};

export const es: PromoExpiryEmailLocale = {
  lang: 'es',
  render: ({ days, expiryDisplay, urgency, billingUrl, dashboardUrl }) => {
    const dayWord = days === 1 ? "día" : "días";
    return {
      subject: `${urgency} Tu año gratuito de Almstins vence en ${days} ${dayWord}`,
      text: `
Hola,

Solo un aviso — tu año gratuito de acceso Almstins Unlimited vence el ${expiryDisplay} (en ${days} ${dayWord}).

Después de esa fecha tu cuenta volverá al plan Gratuito, que incluye:
  - Hasta 3 wallets
  - Seguimiento de portafolio básico
  - Sin descargas CSV ni PDF de Resumen Anual

Para mantener tu acceso completo — incluidas wallets ilimitadas, exportaciones de ganancias/pérdidas FIFO y el PDF de Resumen Anual — actualiza tu plan antes de que venza tu promoción.

Ver planes y actualizar: ${billingUrl}

Tu cuenta y todos tus datos siempre estarán seguros — actualizar solo conserva tus funciones.

— El equipo de Almstins
${dashboardUrl}
      `.trim(),
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">

    <div style="background:#1a1f2e;border:1px solid rgba(251,191,36,.2);border-top:3px solid #fbbf24;border-radius:12px;padding:32px;">

      <p style="font-size:28px;margin:0 0 8px;">${urgency}</p>
      <h1 style="font-size:20px;font-weight:700;color:#fde68a;margin:0 0 8px;">
        Tu año gratuito vence en ${days} ${dayWord}
      </h1>
      <p style="font-size:14px;color:#9ca3af;margin:0 0 24px;">
        El acceso promocional finaliza el <strong style="color:#fef3c7;">${expiryDisplay}</strong>
      </p>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 16px;">
        Después de esta fecha tu cuenta vuelve al <strong style="color:#fff;">plan Gratuito</strong>, que te limita a:
      </p>
      <ul style="font-size:14px;color:#9ca3af;margin:0 0 24px;padding-left:20px;line-height:2;">
        <li>Hasta 3 wallets (tins)</li>
        <li>Sin descargas CSV</li>
        <li>Sin PDF de Resumen Anual</li>
      </ul>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 24px;">
        Actualiza antes del <strong style="color:#fef3c7;">${expiryDisplay}</strong> para conservar todo —
        wallets ilimitadas, exportaciones de ganancias/pérdidas y tu Resumen Anual.
      </p>

      <a href="${billingUrl}"
         style="display:inline-block;background:#6366f1;color:#fff;font-weight:700;font-size:15px;
                padding:12px 28px;border-radius:8px;text-decoration:none;">
        Ver planes y actualizar →
      </a>

      <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:28px 0;">

      <p style="font-size:13px;color:#6b7280;margin:0;">
        Tu cuenta y todos tus datos siempre están seguros — esto solo se refiere a conservar tus funciones.
        <br><a href="${dashboardUrl}" style="color:#6366f1;">Ir al panel</a>
      </p>

    </div>
  </div>
</body>
</html>
      `.trim(),
    };
  },
};

export const fr: PromoExpiryEmailLocale = {
  lang: 'fr',
  render: ({ days, expiryDisplay, urgency, billingUrl, dashboardUrl }) => {
    const dayWord = days === 1 ? "jour" : "jours";
    return {
      subject: `${urgency} Votre année gratuite Almstins expire dans ${days} ${dayWord}`,
      text: `
Bonjour,

Petit rappel — votre année gratuite d'accès Almstins Unlimited expire le ${expiryDisplay} (dans ${days} ${dayWord}).

Après cette date, votre compte repassera au plan Gratuit, qui comprend :
  - Jusqu'à 3 wallets
  - Suivi de portefeuille de base
  - Pas de téléchargement CSV ni de PDF Bilan Annuel

Pour conserver votre accès complet — wallets illimités, exports gains/pertes FIFO et le PDF Bilan Annuel — mettez à niveau votre abonnement avant l'expiration de votre promo.

Voir les plans et mettre à niveau : ${billingUrl}

Votre compte et toutes vos données sont toujours en sécurité — la mise à niveau permet simplement de conserver vos fonctionnalités.

— L'équipe Almstins
${dashboardUrl}
      `.trim(),
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Inter,system-ui,sans-serif;color:#e0e0e0;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">

    <div style="background:#1a1f2e;border:1px solid rgba(251,191,36,.2);border-top:3px solid #fbbf24;border-radius:12px;padding:32px;">

      <p style="font-size:28px;margin:0 0 8px;">${urgency}</p>
      <h1 style="font-size:20px;font-weight:700;color:#fde68a;margin:0 0 8px;">
        Votre année gratuite expire dans ${days} ${dayWord}
      </h1>
      <p style="font-size:14px;color:#9ca3af;margin:0 0 24px;">
        L'accès promotionnel se termine le <strong style="color:#fef3c7;">${expiryDisplay}</strong>
      </p>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 16px;">
        Après cette date, votre compte repasse au <strong style="color:#fff;">plan Gratuit</strong>, qui vous limite à :
      </p>
      <ul style="font-size:14px;color:#9ca3af;margin:0 0 24px;padding-left:20px;line-height:2;">
        <li>Jusqu'à 3 wallets (tins)</li>
        <li>Pas de téléchargement CSV</li>
        <li>Pas de PDF Bilan Annuel</li>
      </ul>

      <p style="font-size:15px;color:#d1d5db;margin:0 0 24px;">
        Mettez à niveau avant le <strong style="color:#fef3c7;">${expiryDisplay}</strong> pour tout conserver —
        wallets illimités, exports gains/pertes et votre Bilan Annuel.
      </p>

      <a href="${billingUrl}"
         style="display:inline-block;background:#6366f1;color:#fff;font-weight:700;font-size:15px;
                padding:12px 28px;border-radius:8px;text-decoration:none;">
        Voir les plans et mettre à niveau →
      </a>

      <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:28px 0;">

      <p style="font-size:13px;color:#6b7280;margin:0;">
        Votre compte et toutes vos données sont toujours en sécurité — il s'agit uniquement de conserver vos fonctionnalités.
        <br><a href="${dashboardUrl}" style="color:#6366f1;">Accéder au tableau de bord</a>
      </p>

    </div>
  </div>
</body>
</html>
      `.trim(),
    };
  },
};

const MAP: Record<Lang, PromoExpiryEmailLocale> = { en, es, fr };

export function getPromoExpiry(lang: Lang): PromoExpiryEmailLocale {
  return MAP[lang] ?? en;
}
