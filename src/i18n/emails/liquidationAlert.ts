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
      `Each liquidation has been added to your Almstins records, with the collateral seized and its value at the time.`,
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
      `Cada liquidación se añadió a tus registros de Almstins, con el colateral liquidado y su valor en ese momento.`,
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
      `Chaque liquidation a été ajoutée à vos registres Almstins, avec le collatéral saisi et sa valeur à ce moment-là.`,
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
