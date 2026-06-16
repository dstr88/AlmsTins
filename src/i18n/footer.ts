// Footer — visible labels + locale-aware legal links (EN · ES · FR).
//
// Rendered by src/components/Footer.astro, which receives a `lang` prop from the
// layout (LoginLayout forwards its own `lang`; the dashboard Layout defaults to
// 'en'). The about / security links point at the matching-language route so a
// visitor stays in their language. The privacy / terms modal CONTENT lives in
// privacyPolicy.ts / termsOfService.ts; here we only localize the trigger labels
// and the dialog aria-labels.
//
// Note: the FAQ and Welcome components embedded in the footer are not yet
// localized — separate Phase 1 surfaces.

import type { Lang } from '@/lib/i18n/locale';

export interface FooterLocale {
  lang: Lang;
  licenseHeading: string;
  licenseLine: string;
  aboutLabel: string;
  aboutHref: string;
  securityLabel: string;
  securityHref: string;
  privacyLabel: string;
  termsLabel: string;
  privacyAria: string;
  termsAria: string;
}

export const en: FooterLocale = {
  lang: 'en',
  licenseHeading: 'MIT License',
  licenseLine: 'Open-source under the MIT License.',
  aboutLabel: 'about',
  aboutHref: '/about',
  securityLabel: 'security & privacy',
  securityHref: '/security-and-privacy',
  privacyLabel: 'privacy-policy',
  termsLabel: 'terms of service',
  privacyAria: 'Privacy Policy',
  termsAria: 'Terms of Service',
};

export const es: FooterLocale = {
  lang: 'es',
  licenseHeading: 'MIT License',
  licenseLine: 'Código abierto bajo la MIT License.',
  aboutLabel: 'acerca de',
  aboutHref: '/about/es',
  securityLabel: 'seguridad y privacidad',
  securityHref: '/security-and-privacy/es',
  privacyLabel: 'política de privacidad',
  termsLabel: 'términos del servicio',
  privacyAria: 'Política de Privacidad',
  termsAria: 'Términos del Servicio',
};

export const fr: FooterLocale = {
  lang: 'fr',
  licenseHeading: 'MIT License',
  licenseLine: 'Open source sous licence MIT.',
  aboutLabel: 'à propos',
  aboutHref: '/about/fr',
  securityLabel: 'sécurité et confidentialité',
  securityHref: '/security-and-privacy/fr',
  privacyLabel: 'politique de confidentialité',
  termsLabel: 'conditions d’utilisation',
  privacyAria: 'Politique de Confidentialité',
  termsAria: 'Conditions d’Utilisation',
};

const MAP: Record<Lang, FooterLocale> = { en, es, fr };

/** Select the Footer locale for a language, falling back to English. */
export function getFooter(lang: Lang): FooterLocale {
  return MAP[lang] ?? en;
}
