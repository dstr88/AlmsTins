// PriceWatchlist (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency / price formatting stays as-is (en-US). Crypto jargon / tickers /
// chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface PriceWatchlistLocale {
  lang: Lang;

  // Card heading
  heading: string;

  // Source attribution
  source: string;

  // Expand/collapse toggle aria-label
  collapseWatchlist: string;
  expandWatchlist: string;

  // Add-token form
  inputPlaceholder: string;
  addBtn: string;

  // Loading / error states
  loadingPrices: string;
  errorLoadingPrices: string;

  // Per-token sub-label and no-data
  aaveReference: string;
  noDataYet: string;

  // Move up/down aria-labels (interpolated — takes the ticker symbol)
  moveUp: (symbol: string) => string;
  moveDown: (symbol: string) => string;

  // Remove aria-label (interpolated)
  remove: (symbol: string) => string;

  // Toast notifications (interpolated)
  toastAdded: (symbol: string) => string;
  toastRemoved: (symbol: string) => string;
}

export const en: PriceWatchlistLocale = {
  lang: 'en',

  heading: 'Price watchlist',
  source: 'Source: Aave',

  collapseWatchlist: 'Collapse watchlist',
  expandWatchlist: 'Expand watchlist',

  inputPlaceholder: 'Add token (e.g. LINK, SOL)',
  addBtn: 'Add',

  loadingPrices: 'Loading prices…',
  errorLoadingPrices: 'Unable to load prices right now.',

  aaveReference: 'Aave reference',
  noDataYet: 'No data yet',

  moveUp: (symbol) => `Move ${symbol} up`,
  moveDown: (symbol) => `Move ${symbol} down`,
  remove: (symbol) => `Remove ${symbol}`,

  toastAdded: (symbol) => `Added ${symbol} to watchlist.`,
  toastRemoved: (symbol) => `Removed ${symbol} from watchlist.`,
};

export const es: PriceWatchlistLocale = {
  lang: 'es',

  heading: "Lista de precios",
  source: "Fuente: Aave",

  collapseWatchlist: "Contraer lista",
  expandWatchlist: "Expandir lista",

  inputPlaceholder: "Agregar token (p. ej. LINK, SOL)",
  addBtn: "Agregar",

  loadingPrices: "Cargando precios…",
  errorLoadingPrices: "No se pueden cargar los precios en este momento.",

  aaveReference: "Referencia Aave",
  noDataYet: "Sin datos aún",

  moveUp: (symbol) => `Mover ${symbol} hacia arriba`,
  moveDown: (symbol) => `Mover ${symbol} hacia abajo`,
  remove: (symbol) => `Eliminar ${symbol}`,

  toastAdded: (symbol) => `${symbol} agregado a la lista.`,
  toastRemoved: (symbol) => `${symbol} eliminado de la lista.`,
};

export const fr: PriceWatchlistLocale = {
  lang: 'fr',

  heading: "Liste de prix",
  source: "Source : Aave",

  collapseWatchlist: "Réduire la liste",
  expandWatchlist: "Développer la liste",

  inputPlaceholder: "Ajouter un token (ex. LINK, SOL)",
  addBtn: "Ajouter",

  loadingPrices: "Chargement des prix…",
  errorLoadingPrices: "Impossible de charger les prix pour l'instant.",

  aaveReference: "Référence Aave",
  noDataYet: "Pas encore de données",

  moveUp: (symbol) => `Monter ${symbol}`,
  moveDown: (symbol) => `Descendre ${symbol}`,
  remove: (symbol) => `Supprimer ${symbol}`,

  toastAdded: (symbol) => `${symbol} ajouté à la liste.`,
  toastRemoved: (symbol) => `${symbol} supprimé de la liste.`,
};

const MAP: Record<Lang, PriceWatchlistLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getPriceWatchlist(lang: Lang): PriceWatchlistLocale {
  return MAP[lang] ?? en;
}
