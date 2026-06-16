// Post-checkout success page — page-level strings (EN · ES · FR).
//
// Cookie-based i18n: success.astro reads getLang(Astro.request) and selects
// via getSuccess(lang). Jargon/tickers/Stripe/Almstins/domain values stay English.
// ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface SuccessLocale {
  lang: Lang;
  pageTitle: string;
  heading: string;
  /** Initial message shown before the API call resolves. */
  initialMessage: string;
  domainLabel: string;
  /** Placeholder text while the domain value is loading. */
  domainLoading: string;
  backHome: string;
  // JS runtime strings (injected via data attribute, read by inline script)
  jsUnavailable: string;
  jsNoSession: string;
  jsStillProcessing: string;
  /** Prefix for a server-supplied error note. "Note: {error}" */
  jsNotePrefix: (error: string) => string;
  jsFulfilled: string;
  jsInProgress: string;
  jsFetchError: string;
}

export const en: SuccessLocale = {
  lang: 'en',
  pageTitle: 'Payment Successful | Almstins',
  heading: 'Payment successful',
  initialMessage: 'Thanks! We are confirming your domain registration now.',
  domainLabel: 'Domain:',
  domainLoading: 'Loading…',
  backHome: 'Back to home',
  jsUnavailable: 'Unavailable',
  jsNoSession:
    'We could not find your checkout session. Contact support if needed.',
  jsStillProcessing:
    'We are still processing your order. Please check back soon.',
  jsNotePrefix: (error) => `Note: ${error}`,
  jsFulfilled: 'Your domain is registered.',
  jsInProgress: 'Your order is confirmed and in progress.',
  jsFetchError: 'We could not verify your order right now.',
};

export const es: SuccessLocale = {
  lang: 'es',
  pageTitle: 'Pago exitoso | Almstins',
  heading: 'Pago exitoso',
  initialMessage: '¡Gracias! Estamos confirmando el registro de tu dominio ahora.',
  domainLabel: 'Dominio:',
  domainLoading: 'Cargando…',
  backHome: 'Volver al inicio',
  jsUnavailable: 'No disponible',
  jsNoSession:
    'No pudimos encontrar tu sesión de pago. Contacta con soporte si es necesario.',
  jsStillProcessing:
    'Tu pedido aún se está procesando. Por favor, vuelve pronto.',
  jsNotePrefix: (error) => `Nota: ${error}`,
  jsFulfilled: 'Tu dominio está registrado.',
  jsInProgress: 'Tu pedido está confirmado y en progreso.',
  jsFetchError: 'No pudimos verificar tu pedido en este momento.',
};

export const fr: SuccessLocale = {
  lang: 'fr',
  pageTitle: 'Paiement réussi | Almstins',
  heading: 'Paiement réussi',
  initialMessage:
    'Merci ! Nous confirmons votre enregistrement de domaine maintenant.',
  domainLabel: 'Domaine :',
  domainLoading: 'Chargement…',
  backHome: "Retour à l'accueil",
  jsUnavailable: 'Indisponible',
  jsNoSession:
    'Nous n’avons pas pu trouver votre session de paiement. Contactez le support si nécessaire.',
  jsStillProcessing:
    'Votre commande est toujours en cours de traitement. Revenez bientôt.',
  jsNotePrefix: (error) => `Remarque : ${error}`,
  jsFulfilled: 'Votre domaine est enregistré.',
  jsInProgress: 'Votre commande est confirmée et en cours.',
  jsFetchError: 'Nous n’avons pas pu vérifier votre commande pour l’instant.',
};

const MAP: Record<Lang, SuccessLocale> = { en, es, fr };

/** Select the Success locale for a language, falling back to English. */
export function getSuccess(lang: Lang): SuccessLocale {
  return MAP[lang] ?? en;
}
