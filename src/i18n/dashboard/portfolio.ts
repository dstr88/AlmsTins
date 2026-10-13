// Portfolio dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): portfolio.astro reads getLang(Astro.request) and
// selects via getPortfolio(lang). These are the strings the PAGE owns —
// loading/error/empty states, hero labels, metric card labels, table headers,
// the reconciliation divider, and script-side dynamic strings (injected via
// define:vars JSON island). Child components (ReconciliationTransactions,
// ReconciliationSnapshot, PortfolioTour) carry their own text.
//
// Crypto jargon stays English per design.claude.md: wallet, DeFi, on-chain,
// cost basis, P&L, tickers, Aave. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface PortfolioLocale {
  lang: Lang;
  pageTitle: string;
  // Loading / error / empty states
  loadingLabel: string;
  errorTitle: string;
  errorSub: string;
  emptyTitle: string;
  emptySub: string;
  // Hero
  heroEyebrow: string;
  heroValueLabel: string;
  /** "vs. {amount} cost basis" — amount already formatted as $USD by the script */
  heroCostBasis: (amount: string) => string;
  /** "+ {amount} in assets with no live price" */
  heroUnpriced: (amount: string) => string;
  /** "Prices as of {time}" */
  heroUpdated: (time: string) => string;
  // Metric cards
  metricCostBasis: string;
  metricCurrentValue: string;
  metricUnrealizedPnl: string;
  metricTotalReturn: string;
  // Positions table
  positionsTitle: string;
  colAsset: string;
  colHoldings: string;
  colAvgCost: string;
  colCostBasis: string;
  colPriceNow: string;
  colMarketValue: string;
  colUnrealizedPnl: string;
  colReturn: string;
  // Table footer
  tableTotal: string;
  // Asset row sub-labels
  /** "Last acq. {date}" */
  lastAcquired: (date: string) => string;
  aaveCollateral: string;
  // No-price note
  noPriceNote: string;
  // Reconciliation section
  reconDivider: string;
}

export const en: PortfolioLocale = {
  lang: 'en',
  pageTitle: 'Portfolio Performance | Almstins',
  loadingLabel: 'Loading portfolio…',
  errorTitle: 'Failed to load portfolio data',
  errorSub: 'Please refresh and try again.',
  emptyTitle: 'No holdings found',
  emptySub: 'Import transactions to see your portfolio performance.',
  heroEyebrow: 'Portfolio Performance',
  heroValueLabel: 'Current Value',
  heroCostBasis: (amount) => `vs. ${amount} cost basis`,
  heroUnpriced: (amount) => `+ ${amount} in assets with no live price`,
  heroUpdated: (time) => `Prices as of ${time}`,
  metricCostBasis: 'Cost Basis',
  metricCurrentValue: 'Current Value',
  metricUnrealizedPnl: 'Unrealized P&L',
  metricTotalReturn: 'Total Return',
  positionsTitle: 'Positions',
  colAsset: 'Asset',
  colHoldings: 'Holdings',
  colAvgCost: 'Avg Cost',
  colCostBasis: 'Cost Basis',
  colPriceNow: 'Price Now',
  colMarketValue: 'Market Value',
  colUnrealizedPnl: 'Unrealized P&L',
  colReturn: 'Return',
  tableTotal: 'Total',
  lastAcquired: (date) => `Last acq. ${date}`,
  aaveCollateral: 'Aave Collateral',
  noPriceNote:
    '* Price unavailable — these assets have no current market price in our feed.',
  reconDivider: 'Reconciliation',
};

export const es: PortfolioLocale = {
  lang: 'es',
  pageTitle: 'Rendimiento del portafolio | Almstins',
  loadingLabel: 'Cargando portafolio…',
  errorTitle: 'Error al cargar los datos del portafolio',
  errorSub: 'Por favor, actualiza la página e inténtalo de nuevo.',
  emptyTitle: 'No se encontraron activos',
  emptySub: 'Importa transacciones para ver el rendimiento de tu portafolio.',
  heroEyebrow: 'Rendimiento del portafolio',
  heroValueLabel: 'Valor actual',
  heroCostBasis: (amount) => `vs. ${amount} en cost basis`,
  heroUnpriced: (amount) => `+ ${amount} en activos sin precio en tiempo real`,
  heroUpdated: (time) => `Precios a las ${time}`,
  metricCostBasis: 'Cost Basis',
  metricCurrentValue: 'Valor actual',
  metricUnrealizedPnl: 'P&L no realizado',
  metricTotalReturn: 'Rendimiento total',
  positionsTitle: 'Posiciones',
  colAsset: 'Activo',
  colHoldings: 'Cantidad',
  colAvgCost: 'Coste medio',
  colCostBasis: 'Cost Basis',
  colPriceNow: 'Precio actual',
  colMarketValue: 'Valor de mercado',
  colUnrealizedPnl: 'P&L no realizado',
  colReturn: 'Rendimiento',
  tableTotal: 'Total',
  lastAcquired: (date) => `Última adq. ${date}`,
  aaveCollateral: 'Aave Collateral',
  noPriceNote:
    '* Precio no disponible — estos activos no tienen precio de mercado actual en nuestra fuente.',
  reconDivider: 'Conciliación',
};

export const fr: PortfolioLocale = {
  lang: 'fr',
  pageTitle: 'Performance du portefeuille | Almstins',
  loadingLabel: 'Chargement du portefeuille…',
  errorTitle: 'Impossible de charger les données du portefeuille',
  errorSub: 'Veuillez actualiser la page et réessayer.',
  emptyTitle: 'Aucune position trouvée',
  emptySub: 'Importez des transactions pour voir les performances de votre portefeuille.',
  heroEyebrow: 'Performance du portefeuille',
  heroValueLabel: 'Valeur actuelle',
  heroCostBasis: (amount) => `vs. ${amount} de cost basis`,
  heroUnpriced: (amount) => `+ ${amount} en actifs sans prix en direct`,
  heroUpdated: (time) => `Prix au ${time}`,
  metricCostBasis: 'Cost Basis',
  metricCurrentValue: 'Valeur actuelle',
  metricUnrealizedPnl: 'P&L non réalisé',
  metricTotalReturn: 'Rendement total',
  positionsTitle: 'Positions',
  colAsset: 'Actif',
  colHoldings: 'Quantité',
  colAvgCost: 'Coût moyen',
  colCostBasis: 'Cost Basis',
  colPriceNow: 'Prix actuel',
  colMarketValue: 'Valeur marchande',
  colUnrealizedPnl: 'P&L non réalisé',
  colReturn: 'Rendement',
  tableTotal: 'Total',
  lastAcquired: (date) => `Dernière acq. ${date}`,
  aaveCollateral: 'Aave Collateral',
  noPriceNote:
    "* Prix indisponible — ces actifs n'ont pas de prix de marché actuel dans notre flux.",
  reconDivider: 'Réconciliation',
};

const MAP: Record<Lang, PortfolioLocale> = { en, es, fr };

/** Select the Portfolio locale for a language, falling back to English. */
export function getPortfolio(lang: Lang): PortfolioLocale {
  return MAP[lang] ?? en;
}
