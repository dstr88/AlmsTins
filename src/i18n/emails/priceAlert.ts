// Price-alert email (cron) — EN · ES · FR.
//
// Email-i18n pattern: the locale exposes render(args) -> { subject, text }; the
// sender resolves the recipient's stored language (auth_users.lang via getUserLang
// or an au.lang column on the cron SELECT) and calls render(). Bodies use template
// literals (backticks), so apostrophes are safe without the double-quote rule.
// $ amounts stay formatted en-US (consistent dollar format) — done by the caller.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface PriceAlertEmailLocale {
  lang: Lang;
  render: (a: {
    symbol: string;
    fmtPrice: string;
    fmtThreshold: string;
    direction: string; // 'above' | 'below'
    appBase: string;
  }) => RenderedEmail;
}

export const en: PriceAlertEmailLocale = {
  lang: 'en',
  render: ({ symbol, fmtPrice, fmtThreshold, direction, appBase }) => {
    const dirWord = direction === 'above' ? 'risen above' : 'dropped below';
    const dirLabel = direction === 'above' ? 'above' : 'below';
    return {
      subject: `💰 Price Alert — ${symbol} has ${dirWord} ${fmtThreshold}`,
      text: [
        `Your ${symbol} price alert has been triggered.`,
        ``,
        `  Asset          : ${symbol}`,
        `  Current price  : ${fmtPrice}`,
        `  Your threshold : ${dirLabel} ${fmtThreshold}`,
        ``,
        `Log in to review your portfolio or adjust your alerts:`,
        `${appBase}/dashboard/alerts`,
        ``,
        `— Almstins`,
        ``,
        `To change or disable this alert, visit the Alerts page in the app.`,
      ].join('\n'),
    };
  },
};

export const es: PriceAlertEmailLocale = {
  lang: 'es',
  render: ({ symbol, fmtPrice, fmtThreshold, direction, appBase }) => {
    const dirWord = direction === 'above' ? 'ha subido por encima de' : 'ha bajado por debajo de';
    const dirLabel = direction === 'above' ? 'por encima de' : 'por debajo de';
    return {
      subject: `💰 Alerta de precio — ${symbol} ${dirWord} ${fmtThreshold}`,
      text: [
        `Se ha activado tu alerta de precio de ${symbol}.`,
        ``,
        `  Activo         : ${symbol}`,
        `  Precio actual  : ${fmtPrice}`,
        `  Tu umbral      : ${dirLabel} ${fmtThreshold}`,
        ``,
        `Inicia sesión para revisar tu portafolio o ajustar tus alertas:`,
        `${appBase}/dashboard/alerts`,
        ``,
        `— Almstins`,
        ``,
        `Para cambiar o desactivar esta alerta, visita la página de Alertas en la app.`,
      ].join('\n'),
    };
  },
};

export const fr: PriceAlertEmailLocale = {
  lang: 'fr',
  render: ({ symbol, fmtPrice, fmtThreshold, direction, appBase }) => {
    const dirWord = direction === 'above' ? 'est passé au-dessus de' : 'est passé en dessous de';
    const dirLabel = direction === 'above' ? 'au-dessus de' : 'en dessous de';
    return {
      subject: `💰 Alerte de prix — ${symbol} ${dirWord} ${fmtThreshold}`,
      text: [
        `Votre alerte de prix ${symbol} a été déclenchée.`,
        ``,
        `  Actif          : ${symbol}`,
        `  Prix actuel    : ${fmtPrice}`,
        `  Votre seuil    : ${dirLabel} ${fmtThreshold}`,
        ``,
        `Connectez-vous pour consulter votre portefeuille ou ajuster vos alertes :`,
        `${appBase}/dashboard/alerts`,
        ``,
        `— Almstins`,
        ``,
        `Pour modifier ou désactiver cette alerte, visitez la page Alertes dans l'app.`,
      ].join('\n'),
    };
  },
};

const MAP: Record<Lang, PriceAlertEmailLocale> = { en, es, fr };

export function getPriceAlertEmail(lang: Lang): PriceAlertEmailLocale {
  return MAP[lang] ?? en;
}
