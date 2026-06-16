// TotalsTin (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TotalsTinLocale {
  lang: Lang;
  heading: string;
  loading: string;
  errorFallback: string;
  totalAssets: string;
  totalFreeAssets: string;
  totalDebt: string;
  viewBreakdownBy: string;
  breakdownModeAriaLabel: string;
  optionWallet: string;
  optionChain: string;
  noData: string;
  colLabel: string;
  colAssets: string;
  colFree: string;
  colDebt: string;
  colNet: string;
}

export const en: TotalsTinLocale = {
  lang: 'en',
  heading: 'Totals Tin',
  loading: 'Loading totals…',
  errorFallback: 'Unable to load totals right now.',
  totalAssets: 'Total Assets',
  totalFreeAssets: 'Total Free Assets',
  totalDebt: 'Total Debt',
  viewBreakdownBy: 'View breakdown by',
  breakdownModeAriaLabel: 'Totals breakdown mode',
  optionWallet: 'Wallet',
  optionChain: 'Chain',
  noData: 'No data yet.',
  colLabel: 'Label',
  colAssets: 'Assets',
  colFree: 'Free',
  colDebt: 'Debt',
  colNet: 'Net',
};

export const es: TotalsTinLocale = {
  lang: 'es',
  heading: 'Resumen de Totales',
  loading: 'Cargando totales…',
  errorFallback: 'No se pueden cargar los totales en este momento.',
  totalAssets: 'Total de activos',
  totalFreeAssets: 'Activos libres totales',
  totalDebt: 'Deuda total',
  viewBreakdownBy: 'Ver desglose por',
  breakdownModeAriaLabel: 'Modo de desglose de totales',
  optionWallet: 'Billetera',
  optionChain: 'Cadena',
  noData: 'Sin datos aún.',
  colLabel: 'Etiqueta',
  colAssets: 'Activos',
  colFree: 'Libres',
  colDebt: 'Deuda',
  colNet: 'Neto',
};

export const fr: TotalsTinLocale = {
  lang: 'fr',
  heading: 'Totaux',
  loading: 'Chargement des totaux…',
  errorFallback: 'Impossible de charger les totaux pour le moment.',
  totalAssets: 'Total des actifs',
  totalFreeAssets: 'Actifs libres totaux',
  totalDebt: 'Dette totale',
  viewBreakdownBy: 'Voir la répartition par',
  breakdownModeAriaLabel: 'Mode de répartition des totaux',
  optionWallet: 'Portefeuille',
  optionChain: 'Chaîne',
  noData: 'Aucune donnée pour le moment.',
  colLabel: 'Libellé',
  colAssets: 'Actifs',
  colFree: 'Libres',
  colDebt: 'Dette',
  colNet: 'Net',
};

const MAP: Record<Lang, TotalsTinLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getTotalsTin(lang: Lang): TotalsTinLocale {
  return MAP[lang] ?? en;
}
