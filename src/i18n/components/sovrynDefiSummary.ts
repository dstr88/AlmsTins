// SovrynDefiSummary (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Crypto jargon (Sovryn, AMM, LP, DeFi, Bitcoin…) and tickers stay English.
// ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface SovrynDefiSummaryLocale {
  lang: Lang;
  loading: string;
  error: string;
  lendingPositions: string;
  ammLiquidity: string;
  detectedContracts: string;
  noPositions: string;
  subgraphUnavailable: string;
  /** Returns "N position" or "N positions" (or locale equivalent). */
  positionCount: (n: number) => string;
}

export const en: SovrynDefiSummaryLocale = {
  lang: 'en',
  loading: 'Scanning Sovryn…',
  error: 'Unable to load Sovryn data.',
  lendingPositions: 'Lending positions',
  ammLiquidity: 'AMM liquidity',
  detectedContracts: 'Detected contracts',
  noPositions: 'No active Sovryn positions found.',
  subgraphUnavailable: 'Sovryn subgraph unavailable — on-chain scan used.',
  positionCount: (n) => `${n} position${n !== 1 ? 's' : ''}`,
};

export const es: SovrynDefiSummaryLocale = {
  lang: 'es',
  loading: 'Escaneando Sovryn…',
  error: 'No se pudieron cargar los datos de Sovryn.',
  lendingPositions: 'Posiciones de préstamo',
  ammLiquidity: 'Liquidez AMM',
  detectedContracts: 'Contratos detectados',
  noPositions: 'No se encontraron posiciones activas en Sovryn.',
  subgraphUnavailable: 'Subgrafo de Sovryn no disponible — se usó el escaneo en cadena.',
  positionCount: (n) => `${n} posición${n !== 1 ? 'es' : ''}`,
};

export const fr: SovrynDefiSummaryLocale = {
  lang: 'fr',
  loading: 'Analyse de Sovryn en cours…',
  error: 'Impossible de charger les données Sovryn.',
  lendingPositions: 'Positions de prêt',
  ammLiquidity: 'Liquidité AMM',
  detectedContracts: 'Contrats détectés',
  noPositions: 'Aucune position Sovryn active trouvée.',
  subgraphUnavailable: 'Sous-graphe Sovryn indisponible — analyse on-chain utilisée.',
  positionCount: (n) => `${n} position${n !== 1 ? 's' : ''}`,
};

const MAP: Record<Lang, SovrynDefiSummaryLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getSovrynDefiSummary(lang: Lang): SovrynDefiSummaryLocale {
  return MAP[lang] ?? en;
}
