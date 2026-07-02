// Bookkeeping dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): bookkeeping.astro reads getLang(Astro.request) and
// selects via getBookkeeping(lang). These are the strings the PAGE owns —
// tin labels, section totals, empty states, and toolbar copy.
//
// Child components (DrawerHost, ReconciliationTin — React islands) carry their
// own English text and are localized in separate passes.
//
// Crypto jargon stays English per design.claude.md: wallet, DeFi, FIFO, lot,
// cost basis, aToken, stablecoin, USDC / USDT / etc., ticker symbols.
// ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface BookkeepingLocale {
  lang: Lang;
  pageTitle: string;
  heroTitle: string;
  heroSubtitle: string;

  // Year bar
  yearBarLabel: string;

  // Year Summary PDF
  /** "Download {year} Year Summary PDF" */
  pdfDownloadTitle: (year: number) => string;
  pdfBtnLabel: string;
  pdfLockedTitle: string;
  pdfLockedLabel: string;
  pdfPremiumBadge: string;

  // Tax readiness bar
  readinessCalculating: string;
  readinessLink: string;

  // On-chain transaction-sync freshness strip
  txSyncedPrefix: string;
  txSyncedNever: string;
  syncStaleNote: string;
  syncNow: string;
  syncingLabel: string;
  syncErrLabel: string;

  // Needs Attention tin
  tinNeedsAttention: string;
  /** "{n} items" */
  countItems: (n: number) => string;
  untracedProceeds: string;
  /** "✓ No orphaned sales for {year}" */
  noOrphanedSales: (year: number) => string;
  noteUnrecognisedRound: string;
  noteUnrecognisedTransfer: string;
  noteNoPurchase: string;
  detailsCta: string;

  // Still in Wallet tin
  tinStillInWallet: string;
  /** "{n} positions" */
  countPositions: (n: number) => string;
  costBasisLabel: string;
  costBasisNote: string;
  noOpenPositions: string;
  /** "Since {date}" */
  sinceDateLabel: (date: string) => string;
  termLong: string;
  termShort: string;
  confirmedLabel: string;

  // DeFi Positions tin
  tinDefiPositions: string;
  defiToolbarNote: string;
  protocolCostBasis: string;
  protocolCostBasisNote: string;

  // Short-term G/L tin
  /** "{n} lots" */
  countLots: (n: number) => string;
  netShortTerm: string;
  taxedAsOrdinaryIncome: string;
  /** "No short-term disposals in {year}" */
  noShortTermDisposals: (year: number) => string;

  // Long-term G/L tin
  netLongTerm: string;
  preferentialRate: string;
  /** "No long-term disposals in {year}" */
  noLongTermDisposals: (year: number) => string;

  // International combined realized G/L tin
  tinRealizedGL: string;
  netRealized: string;
  /** "No disposals in {year}" */
  noDisposals: (year: number) => string;

  // Income tin
  tinIncome: string;
  totalOrdinaryIncome: string;
  /** "No income events in {year}" */
  noIncomeEvents: (year: number) => string;

  // Transaction costs (fees) tin
  tinTransactionCosts: string;
  totalTransactionCosts: string;
  /** "No transaction costs recorded in {year}" */
  noTransactionCosts: (year: number) => string;
  /** "Fees captured on {withFee} of {total} transactions" */
  feeCoverageNote: (withFee: number, total: number) => string;
  gasFeesHeading: string;
  feeTaxNote: string;

  // FMV (fair market value) provenance for income rows
  fmvExchange: string;
  fmvEstimated: string;
  fmvStablecoin: string;
  fmvUnpriced: string;
  /** e.g. "priced at 09:03 UTC" */
  fmvPricedAt: (time: string) => string;
  fmvNote: string;

  // Cost basis method label (for the CPA)
  costMethodLabel: string;
  costMethodNote: string;

  // Card rebates (non-taxable)
  cardRebatesLabel: string;
  cardRebatesNote: string;
  cardRebateTag: string;

  // NFT holdings
  tinNftHoldings: string;
  noNfts: string;
  nftCostNote: string;
}

export const en: BookkeepingLocale = {
  lang: 'en',
  pageTitle: 'Bookkeeping | Almstins',
  heroTitle: 'Bookkeeping',
  heroSubtitle: 'Annual breakdown',

  yearBarLabel: 'Calendar Year',

  pdfDownloadTitle: (year) => `Download ${year} Year Summary PDF`,
  pdfBtnLabel: '↓ Year Summary PDF',
  pdfLockedTitle: 'Upgrade to Premium to download Year Summary PDF',
  pdfLockedLabel: 'Year Summary PDF',
  pdfPremiumBadge: 'Premium',

  readinessCalculating: 'Calculating tax readiness…',
  readinessLink: 'Tax Readiness →',
  txSyncedPrefix: 'On-chain transactions synced',
  txSyncedNever: 'On-chain transactions never synced',
  syncStaleNote: 'May be out of date — sync to pull the latest.',
  syncNow: 'Sync now',
  syncingLabel: 'Syncing… (up to a minute)',
  syncErrLabel: 'Sync failed — please try again.',

  tinNeedsAttention: 'Needs Attention',
  countItems: (n) => `${n} items`,
  untracedProceeds: 'Untraced proceeds:',
  noOrphanedSales: (year) => `✓ No orphaned sales for ${year}`,
  noteUnrecognisedRound: 'Unrecognised · round amount',
  noteUnrecognisedTransfer: 'Unrecognised transfer',
  noteNoPurchase: 'No purchase found',
  detailsCta: 'Details →',

  tinStillInWallet: 'Still in Wallet',
  countPositions: (n) => `${n} positions`,
  costBasisLabel: 'Cost Basis',
  costBasisNote: 'what you paid · not market value',
  noOpenPositions: 'No open positions',
  sinceDateLabel: (date) => `Since ${date}`,
  termLong: 'Long',
  termShort: 'Short',
  confirmedLabel: 'Confirmed',

  tinDefiPositions: 'DeFi Positions',
  defiToolbarNote: 'Aave collateral & protocol balances — unrealized, no tax until withdrawn & sold',
  protocolCostBasis: 'Protocol cost basis:',
  protocolCostBasisNote: 'not included in wallet total above',

  countLots: (n) => `${n} lots`,
  netShortTerm: 'Net short-term:',
  taxedAsOrdinaryIncome: 'taxed as ordinary income',
  noShortTermDisposals: (year) => `No short-term disposals in ${year}`,

  netLongTerm: 'Net long-term:',
  preferentialRate: 'preferential rate',
  noLongTermDisposals: (year) => `No long-term disposals in ${year}`,

  tinRealizedGL: 'Realized G/L',
  netRealized: 'Net realized:',
  noDisposals: (year) => `No disposals in ${year}`,

  tinIncome: 'Income — Interest, Staking & Rewards',
  totalOrdinaryIncome: 'Total ordinary income:',
  noIncomeEvents: (year) => `No income events in ${year}`,

  tinTransactionCosts: 'Transaction Costs — Trading & Network Fees',
  totalTransactionCosts: 'Total exchange fees (USD):',
  noTransactionCosts: (year) => `No transaction costs recorded in ${year}`,
  feeCoverageNote: (withFee, total) => `Fees captured on ${withFee} of ${total} transactions this year`,
  gasFeesHeading: 'On-chain gas (native units — not USD-priced)',
  feeTaxNote: 'Trading fees add to cost basis on a buy and reduce proceeds on a sale.',

  fmvExchange: 'Exchange record',
  fmvEstimated: 'Estimated (CoinGecko)',
  fmvStablecoin: 'Stablecoin $1',
  fmvUnpriced: 'Unpriced',
  fmvPricedAt: (time) => `priced at ${time}`,
  fmvNote: 'FMV source — how each income value was determined (IRS: fair market value at time of receipt).',

  costMethodLabel: 'Cost basis method',
  costMethodNote: 'applied to all realized gains and losses above',

  cardRebatesLabel: 'Card rebates — non-taxable',
  cardRebatesNote: '$0 taxable',
  cardRebateTag: 'rebate',

  tinNftHoldings: 'NFT Holdings',
  noNfts: 'No NFTs detected in connected wallets.',
  nftCostNote: 'Cost basis for NFTs is not auto-tracked — enter it manually where a taxable event applies.',
};

export const es: BookkeepingLocale = {
  lang: 'es',
  pageTitle: 'Contabilidad | Almstins',
  heroTitle: 'Contabilidad',
  heroSubtitle: 'Desglose anual',

  yearBarLabel: 'Año calendario',

  pdfDownloadTitle: (year) => `Descargar resumen anual ${year} en PDF`,
  pdfBtnLabel: '↓ Resumen anual PDF',
  pdfLockedTitle: 'Actualiza a Premium para descargar el resumen anual en PDF',
  pdfLockedLabel: 'Resumen anual PDF',
  pdfPremiumBadge: 'Premium',

  readinessCalculating: 'Calculando preparación fiscal…',
  readinessLink: 'Preparación fiscal →',
  txSyncedPrefix: "Transacciones on-chain sincronizadas",
  txSyncedNever: "Transacciones on-chain nunca sincronizadas",
  syncStaleNote: "Puede estar desactualizado — sincroniza para obtener lo último.",
  syncNow: "Sincronizar ahora",
  syncingLabel: "Sincronizando… (hasta un minuto)",
  syncErrLabel: "Error al sincronizar — inténtalo de nuevo.",

  tinNeedsAttention: 'Requiere atención',
  countItems: (n) => `${n} elementos`,
  untracedProceeds: 'Ingresos sin rastrear:',
  noOrphanedSales: (year) => `✓ Sin ventas sin origen en ${year}`,
  noteUnrecognisedRound: 'No reconocido · monto redondo',
  noteUnrecognisedTransfer: 'Transferencia no reconocida',
  noteNoPurchase: 'Sin compra encontrada',
  detailsCta: 'Detalles →',

  tinStillInWallet: 'Aún en wallet',
  countPositions: (n) => `${n} posiciones`,
  costBasisLabel: 'Cost Basis',
  costBasisNote: 'lo que pagaste · no el valor de mercado',
  noOpenPositions: 'Sin posiciones abiertas',
  sinceDateLabel: (date) => `Desde ${date}`,
  termLong: 'Largo',
  termShort: 'Corto',
  confirmedLabel: 'Confirmado',

  tinDefiPositions: 'Posiciones DeFi',
  defiToolbarNote: 'Colateral Aave y saldos de protocolo — no realizados, sin impuesto hasta retirar y vender',
  protocolCostBasis: 'Cost basis del protocolo:',
  protocolCostBasisNote: 'no incluido en el total de la wallet anterior',

  countLots: (n) => `${n} lotes`,
  netShortTerm: 'Neto corto plazo:',
  taxedAsOrdinaryIncome: 'tributa como renta ordinaria',
  noShortTermDisposals: (year) => `Sin disposiciones a corto plazo en ${year}`,

  netLongTerm: 'Neto largo plazo:',
  preferentialRate: 'tasa preferencial',
  noLongTermDisposals: (year) => `Sin disposiciones a largo plazo en ${year}`,

  tinRealizedGL: 'G/P realizadas',
  netRealized: 'Neto realizado:',
  noDisposals: (year) => `Sin disposiciones en ${year}`,

  tinIncome: 'Ingresos — intereses, staking y recompensas',
  totalOrdinaryIncome: 'Total de ingresos ordinarios:',
  noIncomeEvents: (year) => `Sin eventos de ingresos en ${year}`,

  tinTransactionCosts: 'Costos de transacción — comisiones de trading y de red',
  totalTransactionCosts: 'Total de comisiones de exchange (USD):',
  noTransactionCosts: (year) => `Sin costos de transacción registrados en ${year}`,
  feeCoverageNote: (withFee, total) => `Comisiones registradas en ${withFee} de ${total} transacciones este año`,
  gasFeesHeading: 'Gas on-chain (unidades nativas — sin precio en USD)',
  feeTaxNote: 'Las comisiones de trading se suman al costo base en una compra y reducen los ingresos en una venta.',

  fmvExchange: 'Registro del exchange',
  fmvEstimated: 'Estimado (CoinGecko)',
  fmvStablecoin: 'Stablecoin $1',
  fmvUnpriced: 'Sin precio',
  fmvPricedAt: (time) => `valorado a las ${time}`,
  fmvNote: 'Fuente del FMV — cómo se determinó cada valor de ingreso (IRS: valor de mercado justo al momento de recepción).',

  costMethodLabel: 'Método de costo base',
  costMethodNote: 'aplicado a todas las ganancias y pérdidas realizadas anteriores',

  cardRebatesLabel: 'Reembolsos de tarjeta — no gravables',
  cardRebatesNote: '$0 gravable',
  cardRebateTag: 'reembolso',

  tinNftHoldings: 'Tenencias de NFT',
  noNfts: 'No se detectaron NFT en las billeteras conectadas.',
  nftCostNote: 'El costo base de los NFT no se rastrea automáticamente — ingrésalo manualmente cuando aplique un evento gravable.',
};

export const fr: BookkeepingLocale = {
  lang: 'fr',
  pageTitle: 'Comptabilité | Almstins',
  heroTitle: 'Comptabilité',
  heroSubtitle: 'Bilan annuel',

  yearBarLabel: 'Année civile',

  pdfDownloadTitle: (year) => `Télécharger le résumé annuel ${year} en PDF`,
  pdfBtnLabel: '↓ Résumé annuel PDF',
  pdfLockedTitle: 'Passez à Premium pour télécharger le résumé annuel en PDF',
  pdfLockedLabel: 'Résumé annuel PDF',
  pdfPremiumBadge: 'Premium',

  readinessCalculating: 'Calcul de la préparation fiscale…',
  readinessLink: 'Préparation fiscale →',
  txSyncedPrefix: "Transactions on-chain synchronisées",
  txSyncedNever: "Transactions on-chain jamais synchronisées",
  syncStaleNote: "Peut être obsolète — synchronisez pour les dernières.",
  syncNow: "Synchroniser",
  syncingLabel: "Synchronisation… (jusqu'à une minute)",
  syncErrLabel: "Échec de la synchronisation — veuillez réessayer.",

  tinNeedsAttention: 'Nécessite attention',
  countItems: (n) => `${n} éléments`,
  untracedProceeds: 'Produits non tracés :',
  noOrphanedSales: (year) => `✓ Aucune vente orpheline pour ${year}`,
  noteUnrecognisedRound: 'Non reconnu · montant rond',
  noteUnrecognisedTransfer: 'Transfert non reconnu',
  noteNoPurchase: 'Aucun achat trouvé',
  detailsCta: 'Détails →',

  tinStillInWallet: 'Toujours en wallet',
  countPositions: (n) => `${n} positions`,
  costBasisLabel: 'Cost Basis',
  costBasisNote: 'ce que vous avez payé · pas la valeur marchande',
  noOpenPositions: 'Aucune position ouverte',
  sinceDateLabel: (date) => `Depuis le ${date}`,
  termLong: 'Long',
  termShort: 'Court',
  confirmedLabel: 'Confirmé',

  tinDefiPositions: 'Positions DeFi',
  defiToolbarNote: 'Garanties Aave et soldes de protocole — non réalisés, pas de taxe avant retrait et vente',
  protocolCostBasis: 'Cost basis du protocole :',
  protocolCostBasisNote: 'non inclus dans le total du wallet ci-dessus',

  countLots: (n) => `${n} lots`,
  netShortTerm: 'Net court terme :',
  taxedAsOrdinaryIncome: 'imposé comme revenu ordinaire',
  noShortTermDisposals: (year) => `Aucune cession à court terme en ${year}`,

  netLongTerm: 'Net long terme :',
  preferentialRate: 'taux préférentiel',
  noLongTermDisposals: (year) => `Aucune cession à long terme en ${year}`,

  tinRealizedGL: 'G/P réalisées',
  netRealized: 'Net réalisé :',
  noDisposals: (year) => `Aucune cession en ${year}`,

  tinIncome: 'Revenus — intérêts, staking et récompenses',
  totalOrdinaryIncome: 'Total des revenus ordinaires :',
  noIncomeEvents: (year) => `Aucun événement de revenu en ${year}`,

  tinTransactionCosts: 'Frais de transaction — frais de trading et de réseau',
  totalTransactionCosts: 'Total des frais d\'exchange (USD) :',
  noTransactionCosts: (year) => `Aucun frais de transaction enregistré en ${year}`,
  feeCoverageNote: (withFee, total) => `Frais enregistrés sur ${withFee} des ${total} transactions cette année`,
  gasFeesHeading: 'Gas on-chain (unités natives — non converti en USD)',
  feeTaxNote: 'Les frais de trading s\'ajoutent au coût de base lors d\'un achat et réduisent le produit lors d\'une vente.',

  fmvExchange: 'Relevé de la plateforme',
  fmvEstimated: 'Estimé (CoinGecko)',
  fmvStablecoin: 'Stablecoin 1 $',
  fmvUnpriced: 'Non valorisé',
  fmvPricedAt: (time) => `valorisé à ${time}`,
  fmvNote: 'Source de la FMV — comment chaque valeur de revenu a été déterminée (IRS : juste valeur marchande au moment de la réception).',

  costMethodLabel: 'Méthode de coût de base',
  costMethodNote: 'appliquée à toutes les plus/moins-values réalisées ci-dessus',

  cardRebatesLabel: 'Remises de carte — non imposables',
  cardRebatesNote: '0 $ imposable',
  cardRebateTag: 'remise',

  tinNftHoldings: 'Avoirs NFT',
  noNfts: 'Aucun NFT détecté dans les portefeuilles connectés.',
  nftCostNote: 'Le coût de base des NFT n\'est pas suivi automatiquement — saisissez-le manuellement lorsqu\'un événement imposable s\'applique.',
};

const MAP: Record<Lang, BookkeepingLocale> = { en, es, fr };

/** Select the Bookkeeping locale for a language, falling back to English. */
export function getBookkeeping(lang: Lang): BookkeepingLocale {
  return MAP[lang] ?? en;
}
