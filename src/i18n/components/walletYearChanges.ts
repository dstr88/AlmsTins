// WalletYearChangesModal (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletYearChangesLocale {
  lang: Lang;

  // Modal subtitle
  changesTitle: (year: number) => string;

  // Close button aria-label
  closeBtn: string;

  // Loading state
  loading: string;

  // Tab labels
  tabHoldingsDelta: string;
  tabNetChange: string;
  tabTransactions: string;

  // Holdings Delta tab
  dateRange: (startDate: string, endDate: string) => string;
  emptyHoldings: (year: number) => string;

  // Column headers — Holdings Delta
  colAsset: string;
  colStart: string;
  colEnd: string;
  colChange: string;
  colEndValue: string;

  // Net Change tab
  emptyNetChange: (year: number) => string;

  // Column headers — Net Change
  colNetChange: string;

  // Transactions tab
  emptyTransactions: (year: number) => string;

  // Column headers — Transactions
  colDate: string;
  colType: string;
  colAmount: string;
  colUsdValue: string;
}

export const en: WalletYearChangesLocale = {
  lang: 'en',

  changesTitle: (year) => `${year} Changes`,
  closeBtn: 'Close',
  loading: 'Loading wallet changes…',

  tabHoldingsDelta: 'Holdings Delta',
  tabNetChange: 'Net Change',
  tabTransactions: 'Transactions',

  dateRange: (startDate, endDate) => `Start: ${startDate} — End: ${endDate}`,
  emptyHoldings: (year) => `No holdings in this wallet during ${year}.`,

  colAsset: 'Asset',
  colStart: 'Start',
  colEnd: 'End',
  colChange: 'Change',
  colEndValue: 'End Value',

  emptyNetChange: (year) => `No changes in holdings during ${year}.`,

  colNetChange: 'Net Change',

  emptyTransactions: (year) => `No transactions in ${year}.`,

  colDate: 'Date',
  colType: 'Type',
  colAmount: 'Amount',
  colUsdValue: 'USD Value',
};

export const es: WalletYearChangesLocale = {
  lang: 'es',

  changesTitle: (year) => `Cambios de ${year}`,
  closeBtn: "Cerrar",
  loading: "Cargando cambios de la cartera…",

  tabHoldingsDelta: "Delta de tenencias",
  tabNetChange: "Cambio neto",
  tabTransactions: "Transacciones",

  dateRange: (startDate, endDate) => `Inicio: ${startDate} — Fin: ${endDate}`,
  emptyHoldings: (year) => `No hay tenencias en esta cartera durante ${year}.`,

  colAsset: "Activo",
  colStart: "Inicio",
  colEnd: "Fin",
  colChange: "Cambio",
  colEndValue: "Valor final",

  emptyNetChange: (year) => `No hubo cambios en las tenencias durante ${year}.`,

  colNetChange: "Cambio neto",

  emptyTransactions: (year) => `No hay transacciones en ${year}.`,

  colDate: "Fecha",
  colType: "Tipo",
  colAmount: "Cantidad",
  colUsdValue: "Valor USD",
};

export const fr: WalletYearChangesLocale = {
  lang: 'fr',

  changesTitle: (year) => `Changements ${year}`,
  closeBtn: "Fermer",
  loading: "Chargement des changements du portefeuille…",

  tabHoldingsDelta: "Delta des avoirs",
  tabNetChange: "Variation nette",
  tabTransactions: "Transactions",

  dateRange: (startDate, endDate) => `Début : ${startDate} — Fin : ${endDate}`,
  emptyHoldings: (year) => `Aucun avoir dans ce portefeuille en ${year}.`,

  colAsset: "Actif",
  colStart: "Début",
  colEnd: "Fin",
  colChange: "Variation",
  colEndValue: "Valeur finale",

  emptyNetChange: (year) => `Aucune variation des avoirs en ${year}.`,

  colNetChange: "Variation nette",

  emptyTransactions: (year) => `Aucune transaction en ${year}.`,

  colDate: "Date",
  colType: "Type",
  colAmount: "Montant",
  colUsdValue: "Valeur USD",
};

const MAP: Record<Lang, WalletYearChangesLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletYearChanges(lang: Lang): WalletYearChangesLocale {
  return MAP[lang] ?? en;
}
