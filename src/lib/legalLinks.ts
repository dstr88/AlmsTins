/**
 * The public legal pages, in each language. Each renders the same source as its footer pop-up, so
 * there is one User Agreement (src/i18n/termsOfService.ts) and one Privacy Policy
 * (src/i18n/privacyPolicy.ts). All six are public through isPublicPath in src/middleware/auth.ts.
 */
import type { Lang } from '@/lib/i18n/locale';

export type LegalDoc = 'terms' | 'privacy';

export const LEGAL_HREF: Readonly<Record<LegalDoc, Readonly<Record<Lang, string>>>> = {
  terms: { en: '/terms', es: '/terms/es', fr: '/terms/fr' },
  privacy: { en: '/privacy', es: '/privacy/es', fr: '/privacy/fr' },
};

export const TERMS_HREF = LEGAL_HREF.terms.en;
export const PRIVACY_HREF = LEGAL_HREF.privacy.en;

/** The home page in each language, for the legal pages' link back to the site. */
export const HOME_HREF: Readonly<Record<Lang, string>> = { en: '/', es: '/es', fr: '/fr' };

/** A legal page in the visitor's language. */
export function legalHref(doc: LegalDoc, lang: Lang): string {
  return LEGAL_HREF[doc][lang] ?? LEGAL_HREF[doc].en;
}
