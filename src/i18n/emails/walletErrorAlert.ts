// Wallet-error alert email (user copy only) — EN · ES · FR.
//
// Sent when a WalletSummary tin fails to load its data and the user has an
// alert email set. The OWNER copy is always English and lives in report-error.ts
// — this locale covers only the user-facing copy.
//
// Bodies use template literals (backticks) so apostrophes are safe.

import type { Lang } from '@/lib/i18n/locale';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface WalletErrorAlertLocale {
  lang: Lang;
  render: (a: {
    refCode: string;
  }) => RenderedEmail;
}

export const en: WalletErrorAlertLocale = {
  lang: 'en',
  render: ({ refCode }) => ({
    subject: `Almstins — a wallet could not load`,
    text: [
      `One of your wallets could not load its latest balance. Your funds are safe —`,
      `this is a display error, not a wallet issue.`,
      ``,
      `Ref: ${refCode}`,
      ``,
      `If this keeps happening, reply to this email with the ref code above.`,
    ].join('\n'),
  }),
};

export const es: WalletErrorAlertLocale = {
  lang: 'es',
  render: ({ refCode }) => ({
    subject: `Almstins — una billetera no pudo cargarse`,
    text: [
      `Una de tus billeteras no pudo cargar su saldo más reciente. Tus fondos están seguros —`,
      `esto es un error de visualización, no un problema con tu billetera.`,
      ``,
      `Ref: ${refCode}`,
      ``,
      `Si esto sigue ocurriendo, responde este correo con el código de referencia indicado.`,
    ].join('\n'),
  }),
};

export const fr: WalletErrorAlertLocale = {
  lang: 'fr',
  render: ({ refCode }) => ({
    subject: `Almstins — un portefeuille n'a pas pu se charger`,
    text: [
      `L'un de vos portefeuilles n'a pas pu charger son solde le plus récent. Vos fonds sont en sécurité —`,
      `il s'agit d'une erreur d'affichage, pas d'un problème de portefeuille.`,
      ``,
      `Réf. : ${refCode}`,
      ``,
      `Si cela continue, répondez à cet e-mail en indiquant le code de référence ci-dessus.`,
    ].join('\n'),
  }),
};

const MAP: Record<Lang, WalletErrorAlertLocale> = { en, es, fr };

export function getWalletErrorAlert(lang: Lang): WalletErrorAlertLocale {
  return MAP[lang] ?? en;
}
