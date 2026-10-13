// TinColumn (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / "Tins"/"Tin" stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TinColumnLocale {
  lang: Lang;
  /** Returns the debt card heading: "<tinName> — Debt" */
  debtTitle: (tinName: string) => string;
}

export const en: TinColumnLocale = {
  lang: 'en',
  debtTitle: (tinName) => `${tinName} — Debt`,
};

export const es: TinColumnLocale = {
  lang: 'es',
  debtTitle: (tinName) => `${tinName} — Deuda`,
};

export const fr: TinColumnLocale = {
  lang: 'fr',
  debtTitle: (tinName) => `${tinName} — Dette`,
};

const MAP: Record<Lang, TinColumnLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getTinColumn(lang: Lang): TinColumnLocale {
  return MAP[lang] ?? en;
}
