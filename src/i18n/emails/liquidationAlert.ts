// Aave liquidation alert email — EN · ES · FR.
//
// Sent when syncAaveLiquidations detects new liquidation events for a tenant.
// Bodies use template literals (backticks), so apostrophes are safe.
// Tickers, chain/protocol names, tx hashes, $ amounts, and URLs are never translated.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface LiquidationAlertLocale {
  lang: Lang;
  render: (a: {
    address: string;
    imported: number;
    appBase: string;
  }) => RenderedEmail;
}

export const en: LiquidationAlertLocale = {
  lang: 'en',
  render: ({ address, imported, appBase }) => ({
    subject: `⚠ Aave Liquidation Detected`,
    text: [
      `Your Aave position was partially or fully liquidated.`,
      ``,
      `Wallet: ${address}`,
      `New liquidation event(s) logged: ${imported}`,
      ``,
      `These have been added to your Almstins bookkeeping records as taxable disposals.`,
      ``,
      `Review your records:`,
      `${appBase}/dashboard/research`,
    ].join('\n'),
  }),
};

export const es: LiquidationAlertLocale = {
  lang: 'es',
  render: ({ address, imported, appBase }) => ({
    subject: `⚠ Liquidación de Aave detectada`,
    text: [
      `Tu posición en Aave fue liquidada parcial o totalmente.`,
      ``,
      `Billetera: ${address}`,
      `Nuevo(s) evento(s) de liquidación registrados: ${imported}`,
      ``,
      `Estos han sido añadidos a tus registros contables de Almstins como disposiciones sujetas a impuestos.`,
      ``,
      `Revisa tus registros:`,
      `${appBase}/dashboard/research`,
    ].join('\n'),
  }),
};

export const fr: LiquidationAlertLocale = {
  lang: 'fr',
  render: ({ address, imported, appBase }) => ({
    subject: `⚠ Liquidation Aave détectée`,
    text: [
      `Votre position Aave a été liquidée partiellement ou totalement.`,
      ``,
      `Portefeuille : ${address}`,
      `Nouvel(s) événement(s) de liquidation enregistré(s) : ${imported}`,
      ``,
      `Ces événements ont été ajoutés à vos registres comptables Almstins en tant que cessions imposables.`,
      ``,
      `Consultez vos registres :`,
      `${appBase}/dashboard/research`,
    ].join('\n'),
  }),
};

const MAP: Record<Lang, LiquidationAlertLocale> = { en, es, fr };

export function getLiquidationAlert(lang: Lang): LiquidationAlertLocale {
  return MAP[lang] ?? en;
}
