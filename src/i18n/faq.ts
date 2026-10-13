// FAQ — footer help component, localized item set (EN · ES · FR).
//
// Rendered by src/components/faq.astro (data-driven: one button + one modal per
// item). The component takes a `lang` prop and selects via getFaq(lang); it
// inherits the page's language from the Footer, so there are no per-locale routes.
//
// Each language's items live in ./faq/{en,es,fr}.ts (large translated answer HTML).
// `a` is developer-controlled HTML rendered with set:html; `q` is auto-escaped text.
// Crypto jargon (wallet, token, staking, airdrop, blockchain…) and proper nouns
// (Coinbase, Kraken, Aave, Stripe…) stay English per design.claude.md. ES/FR are
// first-pass and should be reviewed by a fluent speaker before being authoritative.

import type { Lang } from '@/lib/i18n/locale';
import { items as enItems } from './faq/en';
import { items as esItems } from './faq/es';
import { items as frItems } from './faq/fr';

export interface FaqItem {
  /** DOM id, shared across languages (data-modal target + modal id). */
  id: string;
  /** Question — used as the grid button label and the modal heading. */
  q: string;
  /** Answer body — HTML, rendered with set:html inside .modal-content. */
  a: string;
}

export interface FaqLocale {
  lang: Lang;
  items: FaqItem[];
}

export const en: FaqLocale = { lang: 'en', items: enItems };
export const es: FaqLocale = { lang: 'es', items: esItems };
export const fr: FaqLocale = { lang: 'fr', items: frItems };

const MAP: Record<Lang, FaqLocale> = { en, es, fr };

/** Select the FAQ locale for a language, falling back to English. */
export function getFaq(lang: Lang): FaqLocale {
  return MAP[lang] ?? en;
}
