// Welcome / founder card — the only translatable string is the role line
// ("Founder • Builder • Crypto Analytics"). Name, social-platform labels, and
// links are proper nouns kept as-is. "Builder" and "Crypto" stay English per the
// brand voice + crypto-jargon guardrail in design.claude.md.
//
// Rendered by src/components/Welcome.astro (compact in the footer). The component
// takes a `lang` prop and selects via getWelcome(lang); it inherits the page's
// language from the Footer, so there are no per-locale routes.

import type { Lang } from '@/lib/i18n/locale';

export interface WelcomeLocale {
  lang: Lang;
  role: string;
}

export const en: WelcomeLocale = { lang: 'en', role: 'Founder • Builder • Crypto Analytics' };
export const es: WelcomeLocale = { lang: 'es', role: 'Fundador • Builder • Analítica Cripto' };
export const fr: WelcomeLocale = { lang: 'fr', role: 'Fondateur • Builder • Analytique Crypto' };

const MAP: Record<Lang, WelcomeLocale> = { en, es, fr };

/** Select the Welcome locale for a language, falling back to English. */
export function getWelcome(lang: Lang): WelcomeLocale {
  return MAP[lang] ?? en;
}
