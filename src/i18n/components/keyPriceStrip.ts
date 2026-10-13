// KeyPriceStrip (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto tickers /
// symbol codes stay English. ES/FR first-pass.
//
// ⚠ ES/FR string VALUES use double quotes — apostrophes break single-quoted strings.

import type { Lang } from '@/lib/i18n/locale';

export interface KeyPriceStripLocale {
  lang: Lang;
  heading: string;
  sparklinePlaceholder: string;
  /** @param symbol — crypto ticker, always uppercase, never translated */
  priceActionHeading: (symbol: string) => string;
  expandedChartPlaceholder: string;
}

export const en: KeyPriceStripLocale = {
  lang: 'en',
  heading: 'Key prices',
  sparklinePlaceholder: 'chart',
  priceActionHeading: (symbol) => `${symbol} price action`,
  expandedChartPlaceholder: 'Expanded chart placeholder',
};

export const es: KeyPriceStripLocale = {
  lang: 'es',
  heading: 'Precios clave',
  sparklinePlaceholder: 'gráfico',
  priceActionHeading: (symbol) => `Movimiento de precio de ${symbol}`,
  expandedChartPlaceholder: 'Gráfico ampliado (marcador)',
};

export const fr: KeyPriceStripLocale = {
  lang: 'fr',
  heading: 'Prix clés',
  sparklinePlaceholder: 'graphique',
  priceActionHeading: (symbol) => `Évolution du prix de ${symbol}`,
  expandedChartPlaceholder: "Graphique étendu (espace réservé)",
};

const MAP: Record<Lang, KeyPriceStripLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getKeyPriceStrip(lang: Lang): KeyPriceStripLocale {
  return MAP[lang] ?? en;
}
