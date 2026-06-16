// NetWorthOverviewCard (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface NetWorthOverviewCardLocale {
  lang: Lang;
  toggleBreakdown: string;
  total: string;
  chainBreakdown: string;
  breakdownPlaceholder: string;
  realizedPlaceholder: string;
}

export const en: NetWorthOverviewCardLocale = {
  lang: 'en',
  toggleBreakdown: 'Toggle token breakdown',
  total: 'Total',
  chainBreakdown: 'Chain breakdown',
  breakdownPlaceholder: 'Breakdown will appear here.',
  realizedPlaceholder: 'Realized gains history (placeholder)',
};

export const es: NetWorthOverviewCardLocale = {
  lang: 'es',
  toggleBreakdown: 'Alternar desglose de tokens',
  total: 'Total',
  chainBreakdown: 'Desglose por cadena',
  breakdownPlaceholder: 'El desglose aparecerá aquí.',
  realizedPlaceholder: 'Historial de ganancias realizadas (marcador)',
};

export const fr: NetWorthOverviewCardLocale = {
  lang: 'fr',
  toggleBreakdown: 'Afficher/masquer la répartition des tokens',
  total: 'Total',
  chainBreakdown: 'Répartition par chaîne',
  breakdownPlaceholder: 'La répartition apparaîtra ici.',
  realizedPlaceholder: 'Historique des gains réalisés (espace réservé)',
};

const MAP: Record<Lang, NetWorthOverviewCardLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getNetWorthOverviewCard(lang: Lang): NetWorthOverviewCardLocale {
  return MAP[lang] ?? en;
}
