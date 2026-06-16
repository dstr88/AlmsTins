// Tin0AllTransactions component — EN · ES · FR.
//
// Covers: section header, filter labels, lifecycle panel labels, direction
// icon alt text, detail labels, placeholder text, status messages, and
// interpolated strings for relative dates and the Aave deposit label.
//
// NOT translated: option value="" attributes (API enum values), crypto
// tickers / chain names (Bitcoin, Ethereum, AVAX, etc.), className, data
// attributes, source values from the DB, or anything that is a prop/API value.

import type { Lang } from '@/lib/i18n/locale';

export interface Tin0AllTransactionsLocale {
  // Header
  headerTitle: string;
  exportCsv: string;

  // Source filter
  filterSourceLabel: string;
  filterSourceAriaLabel: string;
  filterAllSources: string;

  // Lifecycle panel
  lifecycleAvgCost: string;
  lifecycleQty: string;
  lifecycleLastBuy: string;
  lifecycleNoEvents: string;
  lifecycleLinked: string;

  // Unwrap N/A tooltip
  unwrapTooltip: string;
  unwrapLabel: string;

  // Direction icon alt text
  altSold: string;
  altBought: string;

  // Latest-row detail labels
  detailToken: string;
  detailUsd: string;
  detailFee: string;

  // Notes
  notesPlaceholder: string;
  savedLabel: string;

  // Error state
  internalError: string;

  // Interpolated: relative date — receives diffDays (integer)
  daysAgo: (days: number) => string;

  // Interpolated: Aave deposit label — receives symbol string
  aaveDeposit: (symbol: string) => string;

  // Date locale string for toLocaleString / toLocaleDateString
  dateLocale: string;
}

export const en: Tin0AllTransactionsLocale = {
  headerTitle: 'All Transactions',
  exportCsv: 'Export CSV',

  filterSourceLabel: 'Source',
  filterSourceAriaLabel: 'Filter by source',
  filterAllSources: 'All sources',

  lifecycleAvgCost: 'Avg cost',
  lifecycleQty: 'Qty',
  lifecycleLastBuy: 'Last buy',
  lifecycleNoEvents: 'No lifecycle events found.',
  lifecycleLinked: 'linked',

  unwrapTooltip: 'Token unwrapped, no funds exchanged.',
  unwrapLabel: 'N/A?',

  altSold: 'Sold',
  altBought: 'Bought',

  detailToken: 'Token:',
  detailUsd: 'USD:',
  detailFee: 'Fee:',

  notesPlaceholder: 'Notes...',
  savedLabel: 'Saved',

  internalError: 'Internal error.',

  daysAgo: (days) => `${days} days ago`,
  aaveDeposit: (symbol) => `Deposited ${symbol} into Aave (collateral — non-taxable)`,

  dateLocale: 'en-US',
};

export const es: Tin0AllTransactionsLocale = {
  headerTitle: 'Todas las transacciones',
  exportCsv: 'Exportar CSV',

  filterSourceLabel: 'Fuente',
  filterSourceAriaLabel: 'Filtrar por fuente',
  filterAllSources: 'Todas las fuentes',

  lifecycleAvgCost: 'Costo prom.',
  lifecycleQty: 'Cant.',
  lifecycleLastBuy: 'Ultima compra',
  lifecycleNoEvents: 'No se encontraron eventos del ciclo de vida.',
  lifecycleLinked: 'vinculado',

  unwrapTooltip: 'Token desenvuelto, no se intercambiaron fondos.',
  unwrapLabel: 'N/A?',

  altSold: 'Vendido',
  altBought: 'Comprado',

  detailToken: 'Token:',
  detailUsd: 'USD:',
  detailFee: 'Comision:',

  notesPlaceholder: 'Notas...',
  savedLabel: 'Guardado',

  internalError: 'Error interno.',

  daysAgo: (days) => `hace ${days} dias`,
  aaveDeposit: (symbol) => `${symbol} depositado en Aave (garantia — no gravable)`,

  dateLocale: 'es-ES',
};

export const fr: Tin0AllTransactionsLocale = {
  headerTitle: 'Toutes les transactions',
  exportCsv: 'Exporter CSV',

  filterSourceLabel: 'Source',
  filterSourceAriaLabel: 'Filtrer par source',
  filterAllSources: 'Toutes les sources',

  lifecycleAvgCost: 'Cout moy.',
  lifecycleQty: 'Qte',
  lifecycleLastBuy: 'Dernier achat',
  lifecycleNoEvents: 'Aucun evenement de cycle de vie trouve.',
  lifecycleLinked: 'lie',

  unwrapTooltip: 'Token converti, aucun fonds echange.',
  unwrapLabel: 'N/A?',

  altSold: 'Vendu',
  altBought: 'Achete',

  detailToken: 'Token :',
  detailUsd: 'USD :',
  detailFee: 'Frais :',

  notesPlaceholder: 'Notes...',
  savedLabel: 'Enregistre',

  internalError: 'Erreur interne.',

  daysAgo: (days) => `il y a ${days} jours`,
  aaveDeposit: (symbol) => `${symbol} depose dans Aave (garantie — non imposable)`,

  dateLocale: 'fr-FR',
};

const MAP: Record<Lang, Tin0AllTransactionsLocale> = { en, es, fr };

export function getTin0AllTransactions(lang: Lang): Tin0AllTransactionsLocale {
  return MAP[lang] ?? en;
}
