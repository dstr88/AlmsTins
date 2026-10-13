// TinAssetsCard (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TinAssetsCardLocale {
  lang: Lang;
  assetsSuffix: string;
  assetsTitle: string;
  loadingTokens: string;
  errorTokens: string;
  noTokens: string;
  hideFullList: string;
  viewAllTokens: (count: number) => string;
}

export const en: TinAssetsCardLocale = {
  lang: 'en',
  assetsSuffix: ' – Assets',
  assetsTitle: 'Assets',
  loadingTokens: 'Loading tokens…',
  errorTokens: 'Unable to load tokens.',
  noTokens: 'No tokens found.',
  hideFullList: 'Hide full list',
  viewAllTokens: (count) => `View all ${count} tokens`,
};

export const es: TinAssetsCardLocale = {
  lang: 'es',
  assetsSuffix: ' – Activos',
  assetsTitle: 'Activos',
  loadingTokens: 'Cargando tokens…',
  errorTokens: 'No se pudieron cargar los tokens.',
  noTokens: 'No se encontraron tokens.',
  hideFullList: 'Ocultar lista completa',
  viewAllTokens: (count) => `Ver los ${count} tokens`,
};

export const fr: TinAssetsCardLocale = {
  lang: 'fr',
  assetsSuffix: ' – Actifs',
  assetsTitle: 'Actifs',
  loadingTokens: 'Chargement des tokens…',
  errorTokens: 'Impossible de charger les tokens.',
  noTokens: 'Aucun token trouvé.',
  hideFullList: 'Masquer la liste complète',
  viewAllTokens: (count) => `Voir les ${count} tokens`,
};

const MAP: Record<Lang, TinAssetsCardLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getTinAssetsCard(lang: Lang): TinAssetsCardLocale {
  return MAP[lang] ?? en;
}
