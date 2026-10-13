// Email-confirmation page strings (/verify-email) — EN / ES / FR.
// The page the sign-up verification link opens. Opening it confirms nothing: the visitor
// presses Confirm, which POSTs to /api/verify-email (see that route for why).

import type { Lang } from '@/lib/i18n/locale';

export interface VerifyEmailPageLocale {
  lang: Lang;
  title: string;
  heading: string;
  body: string;
  button: string;
  warning: string;
  incomplete: string;
  signIn: string;
}

export const en: VerifyEmailPageLocale = {
  lang: 'en',
  title: 'Confirm your email | Almstins',
  heading: 'Confirm your email address',
  body: 'Press Confirm to verify this address and finish creating your Almstins account.',
  button: 'Confirm',
  warning: "Didn't create an Almstins account? Close this page. Nothing happens unless you press Confirm.",
  incomplete: 'This verification link is incomplete. Open the link from your email again.',
  signIn: 'Back to sign in',
};

export const es: VerifyEmailPageLocale = {
  lang: 'es',
  title: 'Confirma tu correo | Almstins',
  heading: 'Confirma tu correo electrónico',
  body: 'Pulsa Confirmar para verificar esta dirección y terminar de crear tu cuenta de Almstins.',
  button: 'Confirmar',
  warning: '¿No creaste una cuenta en Almstins? Cierra esta página. No pasa nada a menos que pulses Confirmar.',
  incomplete: 'Este enlace de verificación está incompleto. Abre de nuevo el enlace de tu correo.',
  signIn: 'Volver a iniciar sesión',
};

export const fr: VerifyEmailPageLocale = {
  lang: 'fr',
  title: 'Confirmez votre e-mail | Almstins',
  heading: 'Confirmez votre adresse e-mail',
  body: 'Appuyez sur Confirmer pour vérifier cette adresse et terminer la création de votre compte Almstins.',
  button: 'Confirmer',
  warning: "Vous n'avez pas créé de compte Almstins ? Fermez cette page. Rien ne se passe tant que vous n'appuyez pas sur Confirmer.",
  incomplete: 'Ce lien de vérification est incomplet. Ouvrez à nouveau le lien reçu par e-mail.',
  signIn: 'Retour à la connexion',
};

const MAP: Record<Lang, VerifyEmailPageLocale> = { en, es, fr };

export function getVerifyEmailPage(lang: Lang): VerifyEmailPageLocale {
  return MAP[lang] ?? en;
}
