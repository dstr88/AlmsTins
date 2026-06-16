// Aave health-factor / liquidation-risk alert email — EN · ES · FR.
//
// Email-i18n pattern: locale exposes render(args) -> { subject, text }; the
// cron resolves the recipient's stored language via auth_users.lang and calls
// render(). Bodies use template literals, so apostrophes are safe without the
// double-quote rule. Numbers/$ are pre-formatted en-US by the caller.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface HealthAlertEmailLocale {
  lang: Lang;
  render: (a: {
    label: string;        // wallet label (or truncated address)
    address: string;      // full wallet address
    chainLabel: string;   // e.g. "Ethereum"
    hfFormatted: string;  // e.g. "1.43"
    direction: string;    // 'below' | 'above'
    threshold: number;    // numeric threshold from alert_preferences
    appBase: string;      // e.g. "https://almstins.com"
  }) => RenderedEmail;
}

export const en: HealthAlertEmailLocale = {
  lang: 'en',
  render: ({ label, address, chainLabel, hfFormatted, direction, threshold, appBase }) => {
    const dirWord = direction === 'below' ? 'dropped below' : 'risen above';
    return {
      subject: `⚠️ Aave Health Factor Alert — ${label}`,
      text: [
        `Your Aave health factor on ${chainLabel} has ${dirWord} your alert threshold.`,
        ``,
        `  Health factor : ${hfFormatted}`,
        `  Your threshold: ${direction} ${threshold}`,
        `  Wallet        : ${label} (${address})`,
        ``,
        `Log in to review your positions and add collateral or repay debt if needed:`,
        `${appBase}/dashboard/vault`,
        ``,
        `— Almstins`,
        ``,
        `To change or disable this alert, visit Account → Alert email in the app.`,
      ].join('\n'),
    };
  },
};

export const es: HealthAlertEmailLocale = {
  lang: 'es',
  render: ({ label, address, chainLabel, hfFormatted, direction, threshold, appBase }) => {
    const dirWord = direction === 'below' ? 'ha bajado por debajo de' : 'ha subido por encima de';
    const dirLabel = direction === 'below' ? 'por debajo de' : 'por encima de';
    return {
      subject: `⚠️ Alerta de factor de salud de Aave — ${label}`,
      text: [
        `Tu factor de salud de Aave en ${chainLabel} ${dirWord} tu umbral de alerta.`,
        ``,
        `  Factor de salud : ${hfFormatted}`,
        `  Tu umbral       : ${dirLabel} ${threshold}`,
        `  Billetera       : ${label} (${address})`,
        ``,
        `Inicia sesión para revisar tus posiciones y añadir colateral o pagar deuda si es necesario:`,
        `${appBase}/dashboard/vault`,
        ``,
        `— Almstins`,
        ``,
        `Para cambiar o desactivar esta alerta, visita Cuenta → Correo de alertas en la app.`,
      ].join('\n'),
    };
  },
};

export const fr: HealthAlertEmailLocale = {
  lang: 'fr',
  render: ({ label, address, chainLabel, hfFormatted, direction, threshold, appBase }) => {
    const dirWord = direction === 'below' ? `est passé en dessous de` : `est passé au-dessus de`;
    const dirLabel = direction === 'below' ? `en dessous de` : `au-dessus de`;
    return {
      subject: `⚠️ Alerte facteur de santé Aave — ${label}`,
      text: [
        `Votre facteur de santé Aave sur ${chainLabel} ${dirWord} votre seuil d'alerte.`,
        ``,
        `  Facteur de santé : ${hfFormatted}`,
        `  Votre seuil      : ${dirLabel} ${threshold}`,
        `  Portefeuille     : ${label} (${address})`,
        ``,
        `Connectez-vous pour consulter vos positions et ajouter des garanties ou rembourser une dette si nécessaire :`,
        `${appBase}/dashboard/vault`,
        ``,
        `— Almstins`,
        ``,
        `Pour modifier ou désactiver cette alerte, rendez-vous dans Compte → E-mail d'alerte dans l'app.`,
      ].join('\n'),
    };
  },
};

const MAP: Record<Lang, HealthAlertEmailLocale> = { en, es, fr };

export function getHealthAlert(lang: Lang): HealthAlertEmailLocale {
  return MAP[lang] ?? en;
}
