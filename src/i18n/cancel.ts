// Cancel (checkout-cancelled) page — page-level strings (EN · ES · FR).
//
// Cookie-based: cancel.astro reads getLang(Astro.request) and selects
// via getCancel(lang). ES/FR are first-pass.
//
// Crypto jargon stays English per design.claude.md.

import type { Lang } from '@/lib/i18n/locale';

export interface CancelLocale {
  lang: Lang;
  pageTitle: string;
  heading: string;
  body: string;
  backHome: string;
}

export const en: CancelLocale = {
  lang: 'en',
  pageTitle: 'Payment Canceled | Almstins',
  heading: 'Checkout canceled',
  body: 'Your payment was not completed. You can try again anytime.',
  backHome: 'Back to home',
};

export const es: CancelLocale = {
  lang: 'es',
  pageTitle: 'Pago cancelado | Almstins',
  heading: 'Pago cancelado',
  body: 'Tu pago no se completó. Puedes intentarlo de nuevo cuando quieras.',
  backHome: 'Volver al inicio',
};

export const fr: CancelLocale = {
  lang: 'fr',
  pageTitle: 'Paiement annulé | Almstins',
  heading: 'Paiement annulé',
  body: "Votre paiement n'a pas été finalisé. Vous pouvez réessayer à tout moment.",
  backHome: "Retour à l'accueil",
};

const MAP: Record<Lang, CancelLocale> = { en, es, fr };

/** Select the Cancel locale for a language, falling back to English. */
export function getCancel(lang: Lang): CancelLocale {
  return MAP[lang] ?? en;
}
