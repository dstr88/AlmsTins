// Promo-code redemption page — page-level strings (EN · ES · FR).
//
// Cookie-based: redeem.astro reads getLang(Astro.request) and selects
// via getRedeem(lang). Promo codes themselves (LAUNCH2026, etc.) are never
// translated — they're identifiers. Plan names (data.plan) come from the API
// and stay English. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface RedeemLocale {
  lang: Lang;
  pageTitle: string;
  cardTitle: string;
  cardSub: string;
  placeholder: string;
  submitBtn: string;
  /** Button label while the request is in flight. */
  applying: string;
  /** "Go to dashboard →" link inside the success result. */
  dashboardLink: string;
  /** "Your access never expires." */
  neverExpires: string;
  /** "Your access runs through <strong>{date}</strong>." — {date} already formatted */
  accessThrough: (date: string) => string;
  /** "{plan} plan unlocked!" — {plan} is the English plan name from the API */
  planUnlocked: (plan: string) => string;
  /** Generic fallback for API errors without a message. */
  genericError: string;
  /** Network / fetch failure. */
  networkError: string;
}

export const en: RedeemLocale = {
  lang: 'en',
  pageTitle: 'Redeem Promo Code | Almstins',
  cardTitle: 'Redeem a Promo Code',
  cardSub: 'Enter your code below to unlock your plan upgrade instantly. No credit card required.',
  placeholder: 'e.g. LAUNCH2026',
  submitBtn: 'Apply Code',
  applying: 'Applying…',
  dashboardLink: 'Go to dashboard →',
  neverExpires: 'Your access never expires.',
  accessThrough: (date) => `Your access runs through <strong>${date}</strong>.`,
  planUnlocked: (plan) => `${plan} plan unlocked!`,
  genericError: 'Something went wrong. Please try again.',
  networkError: 'Network error. Please check your connection and try again.',
};

export const es: RedeemLocale = {
  lang: 'es',
  pageTitle: 'Canjear código promocional | Almstins',
  cardTitle: 'Canjear un código promocional',
  cardSub: 'Introduce tu código a continuación para activar tu mejora de plan al instante. Sin tarjeta de crédito.',
  placeholder: 'p.ej. LAUNCH2026',
  submitBtn: 'Aplicar código',
  applying: 'Aplicando…',
  dashboardLink: 'Ir al panel →',
  neverExpires: 'Tu acceso nunca caduca.',
  accessThrough: (date) => `Tu acceso es válido hasta el <strong>${date}</strong>.`,
  planUnlocked: (plan) => `¡Plan ${plan} activado!`,
  genericError: 'Algo salió mal. Por favor, inténtalo de nuevo.',
  networkError: 'Error de red. Comprueba tu conexión e inténtalo de nuevo.',
};

export const fr: RedeemLocale = {
  lang: 'fr',
  pageTitle: 'Utiliser un code promo | Almstins',
  cardTitle: 'Utiliser un code promo',
  cardSub: "Saisissez votre code ci-dessous pour activer immédiatement votre mise à niveau. Aucune carte bancaire requise.",
  placeholder: 'ex. LAUNCH2026',
  submitBtn: 'Appliquer le code',
  applying: 'Application…',
  dashboardLink: 'Accéder au tableau de bord →',
  neverExpires: "Votre accès n'expire jamais.",
  accessThrough: (date) => `Votre accès est valable jusqu'au <strong>${date}</strong>.`,
  planUnlocked: (plan) => `Plan ${plan} activé !`,
  genericError: "Une erreur s'est produite. Veuillez réessayer.",
  networkError: 'Erreur réseau. Vérifiez votre connexion et réessayez.',
};

const MAP: Record<Lang, RedeemLocale> = { en, es, fr };

/** Select the Redeem locale for a language, falling back to English. */
export function getRedeem(lang: Lang): RedeemLocale {
  return MAP[lang] ?? en;
}
