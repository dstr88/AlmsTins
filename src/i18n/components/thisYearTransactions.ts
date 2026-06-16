// ThisYearTransactions (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface ThisYearTransactionsLocale {
  lang: Lang;

  // Loading / error / empty states
  loading: string;
  errorMessage: string;
  emptyMessage: string;

  // Summary row labels
  labelTransactions: string;
  labelContracts: string;
  labelGasSpent: string;
  labelMostRecent: string;

  // Interpolated summary sentence
  summaryText: (txCount: number, contractCount: number, gasUsd: string) => string;

  // Quarter row — transaction count
  quarterTransactions: (count: number) => string;
}

export const en: ThisYearTransactionsLocale = {
  lang: 'en',

  loading: 'Loading transactions…',
  errorMessage: 'Unable to load transactions.',
  emptyMessage: 'No transactions found.',

  labelTransactions: 'Transactions',
  labelContracts: 'Contracts',
  labelGasSpent: 'Gas spent',
  labelMostRecent: 'Most recent',

  summaryText: (txCount, contractCount, gasUsd) =>
    `${txCount} transactions, ${contractCount} unique contracts, gas $${gasUsd}.`,

  quarterTransactions: (count) => `${count} transactions`,
};

export const es: ThisYearTransactionsLocale = {
  lang: 'es',

  loading: "Cargando transacciones…",
  errorMessage: "No se pudieron cargar las transacciones.",
  emptyMessage: "No se encontraron transacciones.",

  labelTransactions: "Transacciones",
  labelContracts: "Contratos",
  labelGasSpent: "Gas gastado",
  labelMostRecent: "Más reciente",

  summaryText: (txCount, contractCount, gasUsd) =>
    `${txCount} transacciones, ${contractCount} contratos únicos, gas $${gasUsd}.`,

  quarterTransactions: (count) => `${count} transacciones`,
};

export const fr: ThisYearTransactionsLocale = {
  lang: 'fr',

  loading: "Chargement des transactions…",
  errorMessage: "Impossible de charger les transactions.",
  emptyMessage: "Aucune transaction trouvée.",

  labelTransactions: "Transactions",
  labelContracts: "Contrats",
  labelGasSpent: "Gas dépensé",
  labelMostRecent: "Plus récente",

  summaryText: (txCount, contractCount, gasUsd) =>
    `${txCount} transactions, ${contractCount} contrats uniques, gas $${gasUsd}.`,

  quarterTransactions: (count) => `${count} transactions`,
};

const MAP: Record<Lang, ThisYearTransactionsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getThisYearTransactions(lang: Lang): ThisYearTransactionsLocale {
  return MAP[lang] ?? en;
}
