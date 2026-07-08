// Signup page strings — EN / ES / FR.
// Crypto terms (crypto, DeFi, wallet) stay English per the i18n guardrails.
// Signup collects email + password only — no name (matches the OAuth path,
// which discards the provider-supplied name; see src/lib/authAdapter.ts).

export interface SignupLocale {
  lang: 'en' | 'es' | 'fr';
  meta: { title: string };
  heading: string;
  valueReminder: string;
  subhead: string;
  errors: {
    email: string;
    email_domain: string;
    password: string;
    exists: string;
  };
  labels: {
    email: string;
    password: string;
  };
  placeholders: {
    email: string;
  };
  submit: string;
  haveAccount: string;
  signIn: string;
  terms: {
    /** Full label — may contain HTML for the links; rendered with set:html */
    label: string;
    error: string;
  };
}

export const en: SignupLocale = {
  lang: 'en',
  meta: { title: 'Create your account' },
  heading: 'Create your account',
  valueReminder: 'Track crypto, DeFi, and investments in one place — no wallet connection required.',
  subhead: 'All we need is your email and a password.',
  errors: {
    email: 'Enter a valid email address.',
    email_domain: "We're unable to create accounts with that email domain.",
    password: 'Password must be at least 10 characters.',
    exists: 'An account already exists for that email.',
  },
  labels: {
    email: 'Email address',
    password: 'Password',
  },
  placeholders: {
    email: 'you@company.com',
  },
  submit: 'Create account',
  haveAccount: 'Already have an account?',
  signIn: 'Sign in',
  terms: {
    label: 'I agree to the <a href="/terms" target="_blank">Terms of Service</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.',
    error: 'You must agree to the Terms of Service and Privacy Policy to create an account.',
  },
};

export const es: SignupLocale = {
  lang: 'es',
  meta: { title: 'Crea tu cuenta' },
  heading: 'Crea tu cuenta',
  valueReminder: 'Controla crypto, DeFi e inversiones en un solo lugar — sin necesidad de conectar una wallet.',
  subhead: 'Solo necesitamos tu correo electrónico y una contraseña.',
  errors: {
    email: 'Introduce una dirección de correo electrónico válida.',
    email_domain: 'No podemos crear cuentas con ese dominio de correo electrónico.',
    password: 'La contraseña debe tener al menos 10 caracteres.',
    exists: 'Ya existe una cuenta con ese correo electrónico.',
  },
  labels: {
    email: 'Dirección de correo electrónico',
    password: 'Contraseña',
  },
  placeholders: {
    email: 'tu@empresa.com',
  },
  submit: 'Crear cuenta',
  haveAccount: '¿Ya tienes una cuenta?',
  signIn: 'Inicia sesión',
  terms: {
    label: 'Acepto los <a href="/terms" target="_blank">Términos de Servicio</a> y la <a href="/privacy" target="_blank">Política de Privacidad</a>.',
    error: 'Debes aceptar los Términos de Servicio y la Política de Privacidad para crear una cuenta.',
  },
};

export const fr: SignupLocale = {
  lang: 'fr',
  meta: { title: 'Créez votre compte' },
  heading: 'Créez votre compte',
  valueReminder: 'Suivez vos cryptos, la DeFi et vos investissements au même endroit — aucune connexion de wallet requise.',
  subhead: 'Il nous suffit de votre adresse e-mail et d\'un mot de passe.',
  errors: {
    email: 'Saisissez une adresse e-mail valide.',
    email_domain: 'Nous ne pouvons pas créer de comptes avec ce domaine d\'e-mail.',
    password: 'Le mot de passe doit comporter au moins 10 caractères.',
    exists: 'Un compte existe déjà pour cette adresse e-mail.',
  },
  labels: {
    email: 'Adresse e-mail',
    password: 'Mot de passe',
  },
  placeholders: {
    email: 'vous@entreprise.com',
  },
  submit: 'Créer un compte',
  haveAccount: 'Vous avez déjà un compte ?',
  signIn: 'Connectez-vous',
  terms: {
    label: "J'accepte les <a href=\"/terms\" target=\"_blank\">Conditions d'utilisation</a> et la <a href=\"/privacy\" target=\"_blank\">Politique de confidentialite</a>.",
    error: "Vous devez accepter les Conditions d'utilisation et la Politique de confidentialite pour creer un compte.",
  },
};
