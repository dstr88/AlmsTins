// Subscription welcome email (Stripe webhook) — EN · ES · FR.
//
// Email-i18n pattern: locale exposes render(args) -> { subject, text, html }; the
// webhook resolves the tenant's stored language via getTenantLang(tenantId) and
// calls render(). Bodies use template literals (backticks) so apostrophes are safe.
// Plan names (Starter, Pro, Premium) and URLs stay English in all locales.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedWelcomeEmail {
  subject: string;
  text: string;
  html: string;
}

export interface SubscriptionWelcomeLocale {
  lang: Lang;
  render: (a: { planLabel: string; dashboardUrl: string; appUrl: string }) => RenderedWelcomeEmail;
}

export const en: SubscriptionWelcomeLocale = {
  lang: 'en',
  render: ({ planLabel, dashboardUrl, appUrl }) => ({
    subject: `Welcome to almsTins — you're on ${planLabel}!`,
    text: [
      `Hi there,`,
      ``,
      `Thanks for subscribing to almsTins! Your ${planLabel} plan is now active.`,
      ``,
      `Get started by heading to your dashboard:`,
      dashboardUrl,
      ``,
      `Here's what you can do right now:`,
      `  • Upload a CSV from your exchange (Coinbase, Kraken, Exodus, and more)`,
      `  • Add a wallet address to track on-chain holdings`,
      `  • View your bookkeeping breakdown by year`,
      ``,
      `If you ever have questions, reply to this email — Donnie reads every one.`,
      ``,
      `— The almsTins team`,
      appUrl,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a1a;color:#f0f0f0;border-radius:10px;padding:32px;">
        <h2 style="color:#FA8072;margin-top:0;">Welcome to almsTins!</h2>
        <p style="color:#ccc;">Thanks for subscribing. Your <strong style="color:#FA8072;">${planLabel}</strong> plan is now active.</p>
        <a href="${dashboardUrl}" style="display:inline-block;margin:20px 0;background:#FA8072;color:#1a1a1a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to your dashboard →</a>
        <p style="color:#aaa;font-size:14px;">Here's what you can do right now:</p>
        <ul style="color:#ccc;font-size:14px;line-height:1.8;">
          <li>Upload a CSV from your exchange (Coinbase, Kraken, Exodus, and more)</li>
          <li>Add a wallet address to track on-chain holdings</li>
          <li>View your bookkeeping breakdown by year</li>
        </ul>
        <p style="color:#aaa;font-size:13px;margin-top:24px;">Questions? Just reply to this email — Donnie reads every one.</p>
        <p style="color:#555;font-size:12px;margin-top:16px;">almsTins · <a href="${appUrl}" style="color:#555;">${appUrl}</a></p>
      </div>
    `,
  }),
};

export const es: SubscriptionWelcomeLocale = {
  lang: 'es',
  render: ({ planLabel, dashboardUrl, appUrl }) => ({
    subject: `Bienvenido a almsTins — estás en el plan ${planLabel}!`,
    text: [
      `Hola,`,
      ``,
      `Gracias por suscribirte a almsTins. Tu plan ${planLabel} ya está activo.`,
      ``,
      `Empieza yendo a tu panel de control:`,
      dashboardUrl,
      ``,
      `Esto es lo que puedes hacer ahora mismo:`,
      `  • Subir un CSV de tu exchange (Coinbase, Kraken, Exodus y más)`,
      `  • Añadir una dirección de billetera para rastrear fondos on-chain`,
      `  • Ver el desglose de tu contabilidad por año`,
      ``,
      `Si tienes alguna pregunta, responde a este correo — Donnie lee todos y cada uno.`,
      ``,
      `— El equipo de almsTins`,
      appUrl,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a1a;color:#f0f0f0;border-radius:10px;padding:32px;">
        <h2 style="color:#FA8072;margin-top:0;">¡Bienvenido a almsTins!</h2>
        <p style="color:#ccc;">Gracias por suscribirte. Tu plan <strong style="color:#FA8072;">${planLabel}</strong> ya está activo.</p>
        <a href="${dashboardUrl}" style="display:inline-block;margin:20px 0;background:#FA8072;color:#1a1a1a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Ir a tu panel →</a>
        <p style="color:#aaa;font-size:14px;">Esto es lo que puedes hacer ahora mismo:</p>
        <ul style="color:#ccc;font-size:14px;line-height:1.8;">
          <li>Subir un CSV de tu exchange (Coinbase, Kraken, Exodus y más)</li>
          <li>Añadir una dirección de billetera para rastrear fondos on-chain</li>
          <li>Ver el desglose de tu contabilidad por año</li>
        </ul>
        <p style="color:#aaa;font-size:13px;margin-top:24px;">¿Preguntas? Solo responde a este correo — Donnie lee todos y cada uno.</p>
        <p style="color:#555;font-size:12px;margin-top:16px;">almsTins · <a href="${appUrl}" style="color:#555;">${appUrl}</a></p>
      </div>
    `,
  }),
};

export const fr: SubscriptionWelcomeLocale = {
  lang: 'fr',
  render: ({ planLabel, dashboardUrl, appUrl }) => ({
    subject: `Bienvenue sur almsTins — vous êtes sur le plan ${planLabel} !`,
    text: [
      `Bonjour,`,
      ``,
      `Merci de vous être abonné à almsTins ! Votre plan ${planLabel} est maintenant actif.`,
      ``,
      `Commencez en vous rendant sur votre tableau de bord :`,
      dashboardUrl,
      ``,
      `Voici ce que vous pouvez faire dès maintenant :`,
      `  • Importer un CSV depuis votre exchange (Coinbase, Kraken, Exodus, et plus)`,
      `  • Ajouter une adresse de portefeuille pour suivre vos avoirs on-chain`,
      `  • Consulter la ventilation de votre comptabilité par année`,
      ``,
      `Si vous avez des questions, répondez à cet e-mail — Donnie les lit tous.`,
      ``,
      `— L'équipe almsTins`,
      appUrl,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a1a;color:#f0f0f0;border-radius:10px;padding:32px;">
        <h2 style="color:#FA8072;margin-top:0;">Bienvenue sur almsTins !</h2>
        <p style="color:#ccc;">Merci de vous être abonné. Votre plan <strong style="color:#FA8072;">${planLabel}</strong> est maintenant actif.</p>
        <a href="${dashboardUrl}" style="display:inline-block;margin:20px 0;background:#FA8072;color:#1a1a1a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Accéder à votre tableau de bord →</a>
        <p style="color:#aaa;font-size:14px;">Voici ce que vous pouvez faire dès maintenant :</p>
        <ul style="color:#ccc;font-size:14px;line-height:1.8;">
          <li>Importer un CSV depuis votre exchange (Coinbase, Kraken, Exodus, et plus)</li>
          <li>Ajouter une adresse de portefeuille pour suivre vos avoirs on-chain</li>
          <li>Consulter la ventilation de votre comptabilité par année</li>
        </ul>
        <p style="color:#aaa;font-size:13px;margin-top:24px;">Des questions ? Répondez simplement à cet e-mail — Donnie les lit tous.</p>
        <p style="color:#555;font-size:12px;margin-top:16px;">almsTins · <a href="${appUrl}" style="color:#555;">${appUrl}</a></p>
      </div>
    `,
  }),
};

const MAP: Record<Lang, SubscriptionWelcomeLocale> = { en, es, fr };

export function getSubscriptionWelcome(lang: Lang): SubscriptionWelcomeLocale {
  return MAP[lang] ?? en;
}
