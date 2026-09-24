// Signup email-verification message — EN · ES · FR.
// Sent at signup, and re-sent (rate-limited) when an unverified password user tries to
// sign in; see src/lib/signupVerification.ts. The language is the one chosen on the signup
// page (the form's hidden lang field → the POST handler's `lang`), stored per user for the
// re-send. text/html take the verify URL (the /verify-email confirmation page). The last
// line matters: anyone can type anyone's address into the sign-up form, and confirming
// verifies THAT person's password. Opening the page alone confirms nothing.

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
  text: (url) => `Verify your email address: ${url}\n\nIf you did not create an Almstins account, ignore this email. Nothing is confirmed unless you press Confirm on that page.`,
  html: (url) => `<p>Verify your email address:</p><p><a href="${url}">${url}</a></p><p>If you did not create an Almstins account, ignore this email. Nothing is confirmed unless you press Confirm on that page.</p>`,
};

export const es: VerifyEmailLocale = {
  lang: 'es',
  subject: "Verifica tu correo electrónico",
  text: (url) => `Verifica tu correo electrónico: ${url}\n\nSi no creaste una cuenta en Almstins, ignora este correo. No se confirma nada a menos que pulses Confirmar en esa página.`,
  html: (url) => `<p>Verifica tu correo electrónico:</p><p><a href="${url}">${url}</a></p><p>Si no creaste una cuenta en Almstins, ignora este correo. No se confirma nada a menos que pulses Confirmar en esa página.</p>`,
};

export const fr: VerifyEmailLocale = {
  lang: 'fr',
  subject: "Vérifiez votre adresse e-mail",
  text: (url) => `Vérifiez votre adresse e-mail : ${url}\n\nSi vous n'avez pas créé de compte Almstins, ignorez cet e-mail. Rien n'est confirmé tant que vous n'appuyez pas sur Confirmer sur cette page.`,
  html: (url) => `<p>Vérifiez votre adresse e-mail :</p><p><a href="${url}">${url}</a></p><p>Si vous n'avez pas créé de compte Almstins, ignorez cet e-mail. Rien n'est confirmé tant que vous n'appuyez pas sur Confirmer sur cette page.</p>`,
};

const MAP: Record<Lang, VerifyEmailLocale> = { en, es, fr };

export function getVerifyEmail(lang: Lang): VerifyEmailLocale {
  return MAP[lang] ?? en;
}
