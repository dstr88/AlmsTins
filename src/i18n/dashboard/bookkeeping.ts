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

  // Record-completeness bar (the link is shown to the owner only)
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

  // Transfers to review tin
  tinTransfersToReview: string;
  transfersToReviewIntro: string;
  /** Keyed by the ledger's finding reason (tax/lotLedger.ts FINDING_REASONS); an unknown reason shows as its code. */
  transferReasons: Record<string, string>;

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
}

export const en: BookkeepingLocale = {
  lang: 'en',
  pageTitle: 'Bookkeeping | Almstins',
  heroTitle: 'Bookkeeping',
  heroSubtitle: 'Annual breakdown',

  yearBarLabel: 'Calendar Year',

  pdfDownloadTitle: (year) => `Download ${year} Year Summary PDF`,
  pdfBtnLabel: '↓ Year Summary PDF',
  pdfLockedTitle: 'Upgrade to Unlimited to download the Year Summary PDF',
  pdfLockedLabel: 'Year Summary PDF',
  pdfPremiumBadge: 'Unlimited',

  readinessCalculating: 'Checking record completeness…',
  readinessLink: 'Year Summary →',
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

  tinTransfersToReview: 'Transfers to review',
  transfersToReviewIntro: 'Coins that moved between your own wallets and accounts keep their original date and cost, and a move is not a sale. These are the moves Almstins could not be sure of.',
  transferReasons: {
    transfer_link_unconfirmed: 'Matched by amount and time, not by transaction',
    transfer_between_owners: 'Transfer between household members, review',
    transfer_fee_units: 'Coins lost to a fee (not booked)',
    transfer_amount_mismatch: 'More arrived than was sent',
    transfer_source_shortfall: 'Sent from a wallet with no record of all of it',
    unmatched_transfer: 'Sent, no arrival found (not booked as a sale)',
    manual_basis_on_transfer: 'A basis you entered was ignored: this is a transfer',
    unreadable_event_date: 'A row with an unreadable date is not counted',
    invalid_event: 'A row Almstins could not read is not counted',
  },

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
  defiToolbarNote: 'Aave collateral and protocol balances: unrealized, shown at cost basis',
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
};

export const es: BookkeepingLocale = {
  lang: 'es',
  pageTitle: 'Contabilidad | Almstins',
  heroTitle: 'Contabilidad',
  heroSubtitle: 'Desglose anual',

  yearBarLabel: 'Año calendario',

  pdfDownloadTitle: (year) => `Descargar resumen anual ${year} en PDF`,
  pdfBtnLabel: '↓ Resumen anual PDF',
  pdfLockedTitle: 'Actualiza a Unlimited para descargar el resumen anual en PDF',
  pdfLockedLabel: 'Resumen anual PDF',
  pdfPremiumBadge: 'Unlimited',

  readinessCalculating: 'Comprobando si los registros están completos…',
  readinessLink: 'Resumen anual →',
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

  tinTransfersToReview: 'Transferencias por revisar',
  transfersToReviewIntro: 'Las monedas que se mueven entre tus propias billeteras y cuentas conservan su fecha y costo originales, y un traslado no es una venta. Estos son los traslados de los que Almstins no pudo estar seguro.',
  transferReasons: {
    transfer_link_unconfirmed: 'Emparejada por monto y hora, no por transacción',
    transfer_between_owners: 'Transferencia entre miembros del hogar, revisar',
    transfer_fee_units: 'Monedas perdidas en una comisión (no registradas)',
    transfer_amount_mismatch: 'Llegó más de lo que se envió',
    transfer_source_shortfall: 'Enviada desde una billetera sin registro de todo el monto',
    unmatched_transfer: 'Enviada, sin llegada encontrada (no registrada como venta)',
    manual_basis_on_transfer: 'Se ignoró un costo que ingresaste: esto es una transferencia',
    unreadable_event_date: 'Una fila con fecha ilegible no se cuenta',
    invalid_event: 'Una fila que Almstins no pudo leer no se cuenta',
  },

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
  defiToolbarNote: 'Colateral Aave y saldos de protocolo: no realizados, mostrados a su cost basis',
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
};

export const fr: BookkeepingLocale = {
  lang: 'fr',
  pageTitle: 'Comptabilité | Almstins',
  heroTitle: 'Comptabilité',
  heroSubtitle: 'Bilan annuel',

  yearBarLabel: 'Année civile',

  pdfDownloadTitle: (year) => `Télécharger le récapitulatif annuel ${year} en PDF`,
  pdfBtnLabel: '↓ Récapitulatif annuel PDF',
  pdfLockedTitle: 'Passez à Unlimited pour télécharger le récapitulatif annuel en PDF',
  pdfLockedLabel: 'Récapitulatif annuel PDF',
  pdfPremiumBadge: 'Unlimited',

  readinessCalculating: 'Vérification de l\'exhaustivité des registres…',
  readinessLink: 'Récapitulatif annuel →',
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

  tinTransfersToReview: 'Transferts à vérifier',
  transfersToReviewIntro: 'Les cryptos déplacées entre vos propres portefeuilles et comptes gardent leur date et leur coût d\'origine, et un déplacement n\'est pas une vente. Voici les déplacements dont Almstins n\'a pas pu être sûr.',
  transferReasons: {
    transfer_link_unconfirmed: 'Associé par montant et heure, pas par transaction',
    transfer_between_owners: 'Transfert entre membres du foyer, à vérifier',
    transfer_fee_units: 'Cryptos perdues en frais (non enregistrées)',
    transfer_amount_mismatch: 'Il est arrivé plus que ce qui a été envoyé',
    transfer_source_shortfall: 'Envoyé depuis un portefeuille sans trace de tout le montant',
    unmatched_transfer: 'Envoyé, aucune arrivée trouvée (non enregistré comme vente)',
    manual_basis_on_transfer: 'Un coût que vous avez saisi a été ignoré : c\'est un transfert',
    unreadable_event_date: 'Une ligne dont la date est illisible n\'est pas comptée',
    invalid_event: 'Une ligne qu\'Almstins n\'a pas pu lire n\'est pas comptée',
  },

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
  defiToolbarNote: 'Garanties Aave et soldes de protocole : non réalisés, affichés au cost basis',
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
};

const MAP: Record<Lang, BookkeepingLocale> = { en, es, fr };

/** Select the Bookkeeping locale for a language, falling back to English. */
export function getBookkeeping(lang: Lang): BookkeepingLocale {
  return MAP[lang] ?? en;
}
