// AaveWalletCard (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// DeFi terms (Supply, Borrow, APY, Aave) kept in English for recognisability.
// ES/FR first-pass; apostrophes avoided — double quotes used throughout.

import type { Lang } from '@/lib/i18n/locale';

export interface AaveWalletCardLocale {
  lang: Lang;
  /** Interpolated: "Aave positions – {label}" */
  cardTitle: (walletLabel: string) => string;
  loading: string;
  errorUnable: string;
  errorFallback: string;
  errorPolygonUnavailable: string;
  empty: string;
  colSide: string;
  colAsset: string;
  colAmount: string;
  colApy: string;
  sideSupply: string;
  sideBorrow: string;
}

export const en: AaveWalletCardLocale = {
  lang: 'en',
  cardTitle: (walletLabel) => `Aave positions – ${walletLabel}`,
  loading: 'Loading Aave positions…',
  errorUnable: 'Unable to load Aave positions.',
  errorFallback: 'Failed to load Aave positions',
  errorPolygonUnavailable: 'Polygon Aave positions unavailable',
  empty: 'No active Aave positions on this wallet.',
  colSide: 'Side',
  colAsset: 'Asset',
  colAmount: 'Amount',
  colApy: 'APY',
  sideSupply: 'Supply',
  sideBorrow: 'Borrow',
};

export const es: AaveWalletCardLocale = {
  lang: 'es',
  cardTitle: (walletLabel) => `Posiciones Aave – ${walletLabel}`,
  loading: 'Cargando posiciones de Aave…',
  errorUnable: 'No se pudieron cargar las posiciones de Aave.',
  errorFallback: 'Error al cargar las posiciones de Aave',
  errorPolygonUnavailable: 'Posiciones Aave de Polygon no disponibles',
  empty: 'No hay posiciones activas de Aave en esta cartera.',
  colSide: 'Tipo',
  colAsset: 'Activo',
  colAmount: 'Cantidad',
  colApy: 'APY',
  sideSupply: 'Supply',
  sideBorrow: 'Borrow',
};

export const fr: AaveWalletCardLocale = {
  lang: 'fr',
  cardTitle: (walletLabel) => `Positions Aave – ${walletLabel}`,
  loading: 'Chargement des positions Aave…',
  errorUnable: 'Impossible de charger les positions Aave.',
  errorFallback: 'Echec du chargement des positions Aave',
  errorPolygonUnavailable: 'Positions Aave sur Polygon indisponibles',
  empty: 'Aucune position Aave active sur ce portefeuille.',
  colSide: 'Type',
  colAsset: 'Actif',
  colAmount: 'Montant',
  colApy: 'APY',
  sideSupply: 'Supply',
  sideBorrow: 'Borrow',
};

const MAP: Record<Lang, AaveWalletCardLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getAaveWalletCard(lang: Lang): AaveWalletCardLocale {
  return MAP[lang] ?? en;
}
