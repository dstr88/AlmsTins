/**
 * Where the Verify business page lives in each language. The pages that link to it (the Verify
 * page, /learn, /prices, /agentics/docs) read the address from here, and the business page builds
 * its own language switch from it (src/lib/verifyBusiness.ts), so a link cannot point at a page
 * that is not there.
 */
import type { Lang } from '@/lib/i18n/locale';

export const VERIFY_BUSINESS_HREF: Readonly<Record<Lang, string>> = {
  en: '/verify/business',
  es: '/verify/business/es',
  fr: '/verify/business/fr',
};

/** The business page in the visitor's language. */
export function verifyBusinessHref(lang: Lang): string {
  return VERIFY_BUSINESS_HREF[lang] ?? VERIFY_BUSINESS_HREF.en;
}
