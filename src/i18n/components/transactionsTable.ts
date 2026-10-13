// TransactionsTable (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TransactionsTableLocale {
  lang: Lang;

  // Section heading
  heading: string;

  // Loading / error / empty states
  loading: string;
  errorFailed: string;
  empty: string;

  // Chain filter options
  filterAllChains: string;

  // Date filter options
  filterAllTime: string;
  filterLast30: string;
  filterThisYear: string;

  // Refresh button
  refreshing: string;
  refreshBtn: string;

  // Column headers
  colDate: string;
  colChainToken: string;
  colFromTo: string;
  colValue: string;
  colFlags: string;
  colCategory: string;
  colNote: string;

  // Risk tag display labels (data enum values stay English)
  tagNew: string;
  tagLost: string;
  tagInternal: string;
  // tagAave kept in component as literal 'Aave' (chain/protocol name)

  // Flags empty placeholder
  flagsNone: string;

  // Category select options (value attrs stay English enum values)
  catEmpty: string;      // "–"
  catDeposit: string;
  catBorrow: string;
  catRepay: string;
  catYield: string;
  catFee: string;
  catInternalTransfer: string;
  catLost: string;
  catOther: string;

  // Note input placeholder
  notePlaceholder: string;
}

export const en: TransactionsTableLocale = {
  lang: 'en',

  heading: 'Transactions',

  loading: 'Loading transactions…',
  errorFailed: 'Failed to load transactions.',
  empty: 'No transactions yet.',

  filterAllChains: 'All chains',
  filterAllTime: 'All time',
  filterLast30: 'Last 30 days',
  filterThisYear: 'This year',

  refreshing: 'Refreshing…',
  refreshBtn: 'Refresh from chain',

  colDate: 'Date',
  colChainToken: 'Chain / Token',
  colFromTo: 'From → To',
  colValue: 'Value',
  colFlags: 'Flags',
  colCategory: 'Category',
  colNote: 'Note',

  tagNew: 'New',
  tagLost: 'Lost?',
  tagInternal: 'Internal',

  flagsNone: '—',

  catEmpty: '–',
  catDeposit: 'Deposit',
  catBorrow: 'Borrow',
  catRepay: 'Repay',
  catYield: 'Yield',
  catFee: 'Fee',
  catInternalTransfer: 'Internal',
  catLost: 'Lost',
  catOther: 'Other',

  notePlaceholder: 'Purpose / notes…',
};

export const es: TransactionsTableLocale = {
  lang: 'es',

  heading: "Transacciones",

  loading: "Cargando transacciones…",
  errorFailed: "Error al cargar las transacciones.",
  empty: "Aún no hay transacciones.",

  filterAllChains: "Todas las cadenas",
  filterAllTime: "Todo el tiempo",
  filterLast30: "Últimos 30 días",
  filterThisYear: "Este año",

  refreshing: "Actualizando…",
  refreshBtn: "Actualizar desde la cadena",

  colDate: "Fecha",
  colChainToken: "Cadena / Token",
  colFromTo: "De → A",
  colValue: "Valor",
  colFlags: "Marcadores",
  colCategory: "Categoría",
  colNote: "Nota",

  tagNew: "Nuevo",
  tagLost: "¿Perdido?",
  tagInternal: "Interno",

  flagsNone: "—",

  catEmpty: "–",
  catDeposit: "Depósito",
  catBorrow: "Préstamo",
  catRepay: "Pago",
  catYield: "Rendimiento",
  catFee: "Comisión",
  catInternalTransfer: "Interno",
  catLost: "Perdido",
  catOther: "Otro",

  notePlaceholder: "Propósito / notas…",
};

export const fr: TransactionsTableLocale = {
  lang: 'fr',

  heading: "Transactions",

  loading: "Chargement des transactions…",
  errorFailed: "Impossible de charger les transactions.",
  empty: "Aucune transaction pour l'instant.",

  filterAllChains: "Toutes les chaînes",
  filterAllTime: "Tout le temps",
  filterLast30: "30 derniers jours",
  filterThisYear: "Cette année",

  refreshing: "Actualisation…",
  refreshBtn: "Actualiser depuis la chaîne",

  colDate: "Date",
  colChainToken: "Chaîne / Token",
  colFromTo: "De → À",
  colValue: "Valeur",
  colFlags: "Signalements",
  colCategory: "Catégorie",
  colNote: "Note",

  tagNew: "Nouveau",
  tagLost: "Perdu ?",
  tagInternal: "Interne",

  flagsNone: "—",

  catEmpty: "–",
  catDeposit: "Dépôt",
  catBorrow: "Emprunt",
  catRepay: "Remboursement",
  catYield: "Rendement",
  catFee: "Frais",
  catInternalTransfer: "Interne",
  catLost: "Perdu",
  catOther: "Autre",

  notePlaceholder: "Objet / notes…",
};

const MAP: Record<Lang, TransactionsTableLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getTransactionsTable(lang: Lang): TransactionsTableLocale {
  return MAP[lang] ?? en;
}
