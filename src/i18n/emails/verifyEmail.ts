// Signup email-verification message — EN · ES · FR.
// Sent at signup; the language is the one chosen on the signup page (the form's
// hidden lang field → the POST handler's `lang`). text/html take the verify URL.

import type { Lang } from '@/lib/i18n/locale';

export interface VerifyEmailLocale {
  lang: Lang;
  subject: string;
  text: (url: string) => string;
  html: (url: string) => string;
}

export const en: VerifyEmailLocale = {
  lang: 'en',
  subject: 'Verify your email address',
  text: (url) => `Verify your email address: ${url}`,
  html: (url) => `<p>Verify your email address:</p><p><a href="${url}">${url}</a></p>`,
};

export const es: VerifyEmailLocale = {
  lang: 'es',
  subject: "Verifica tu correo electrónico",
  text: (url) => `Verifica tu correo electrónico: ${url}`,
  html: (url) => `<p>Verifica tu correo electrónico:</p><p><a href="${url}">${url}</a></p>`,
};

export const fr: VerifyEmailLocale = {
  lang: 'fr',
  subject: "Vérifiez votre adresse e-mail",
  text: (url) => `Vérifiez votre adresse e-mail : ${url}`,
  html: (url) => `<p>Vérifiez votre adresse e-mail :</p><p><a href="${url}">${url}</a></p>`,
};

const MAP: Record<Lang, VerifyEmailLocale> = { en, es, fr };

export function getVerifyEmail(lang: Lang): VerifyEmailLocale {
  return MAP[lang] ?? en;
}
