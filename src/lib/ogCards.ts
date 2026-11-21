/**
 * Link-preview cards (og:image and twitter:image), each 1200x630. Each is rendered from an SVG in
 * scripts/og/ by scripts/render-og.mjs and served from public/. A page that passes one of these to
 * LoginLayout (or sets it in its own head) also gets the image's size and alt tags; every other
 * page keeps the site-wide /og-default.png. The /receivables card is set on that page itself.
 */
import type { Lang } from '@/lib/i18n/locale';

/** The /agentics landing: "Agentics. Check the address before your agent pays it". */
export const OG_AGENTICS_CARD = 'https://almstins.com/og-agentics.png';

/** The Verify landing in each language: "Verify. Prove your receiving addresses...". */
export const OG_VERIFY_CARD: Readonly<Record<Lang, string>> = {
  en: 'https://almstins.com/og-verify.png',
  es: 'https://almstins.com/og-verify-es.png',
  fr: 'https://almstins.com/og-verify-fr.png',
};
