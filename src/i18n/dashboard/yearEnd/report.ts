// Tax page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Year Summary Report page — page-level strings (EN · ES · FR).
//
// Cookie-based: yearEnd/report.astro reads getLang(Astro.request) and selects
// via getReport(lang). These are the strings the PAGE owns — headings, table
// column labels, section notes, empty state, and download button labels.
//
// DO NOT translate: US tax form names (Form 8949, Schedule D, Schedule 1,
// Form 1040, 1099), tickers, product/company names, $, %, or code. Financial
// CONCEPT words (gains, losses, cost basis, proceeds, short-term, long-term,
// ordinary income, interest paid) ARE translatable — first-pass only.

import type { Lang } from '@/lib/i18n/locale';

export interface ReportLocale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  /** "Year Summary — YYYY" */
  pageHeading: (year: number) => string;
  /** "Realized gains and losses for YYYY. For filing purposes, consult a qualified accountant." */
  pageSubtitle: (year: number) => string;
  /** "⚠ N need review" */
  reviewNeedReview: (n: number) => string;
  reviewClear: string;
  btnDownloadHtml: string;
  btnDownloadCsv: string;
  // Summary cards
  cardShortTermLabel: string;
  cardShortTermNote: string;
  cardLongTermLabel: string;
  cardLongTermNote: string;
  cardOrdinaryIncomeLabel: string;
  cardOrdinaryIncomeNote: string;
  cardNetCapitalLabel: string;
  cardNetCapitalNote: string;
  // Short-Term section
  stSectionHeading: string;
  stSectionNote: string;
  stTotalLabel: string;
  // Long-Term section
  ltSectionHeading: string;
  ltSectionNote: string;
  ltTotalLabel: string;
  // Shared table headers
  thAsset: string;
  thDateAcquired: string;
  thDateSold: string;
  thQty: string;
  thProceeds: string;
  thCostBasis: string;
  thGainLoss: string;
  thNote: string;
  // Ordinary Income section
  ordinaryIncomeHeading: string;
  ordinaryIncomeFormNote: string;
  thSource: string;
  thType: string;
  thEvents: string;
  thAmount: string;
  incomeTypeRewards: string;
  incomeTypeAirdrop: string;
  totalOrdinaryIncome: string;
  // Card Rebates section
  cardRebatesHeading: string;
  cardRebatesNote: string;
  cardRebatesDesc: string;
  thEstValue: string;
  cardRebateTypeLabel: string;
  cardRebateTotalLabel: string;
  // Loans section
  loanActivityHeading: string;
  loanActivityDesc: string;
  thDate: string;
  thEvent: string;
  thUsdValue: string;
  thTaxTreatment: string;
  loanLiquidationWarning: string;
  loanNotTaxable: string;
  // Empty state
  emptyHeading: (year: number) => string;
  emptyDesc: string;
  emptyBtn: string;
  // Interest Paid section
  /** "Interest Paid — YYYY" */
  interestPaidHeading: (year: number) => string;
  interestPaidNote: string;
  thProtocolExchange: string;
  thTotalPaid: string;
  interestTotalLabel: string;
}

export const en: ReportLocale = {
  lang: 'en',
  pageTitle: 'Year Summary | Almstins',
  backLink: '← Tax Center',
  pageHeading: (year) => `Year Summary — ${year}`,
  pageSubtitle: (year) =>
    `Realized gains and losses for ${year}. For filing purposes, consult a qualified accountant.`,
  reviewNeedReview: (n) => `⚠ ${n} need review`,
  reviewClear: '✅ Review queue clear',
  btnDownloadHtml: '⬇ Download HTML',
  btnDownloadCsv: '⬇ Download CSV',
  // Summary cards
  cardShortTermLabel: 'Short-Term Gain/Loss',
  cardShortTermNote: 'Held < 1 year',
  cardLongTermLabel: 'Long-Term Gain/Loss',
  cardLongTermNote: 'Held ≥ 1 year',
  cardOrdinaryIncomeLabel: 'Ordinary Income',
  cardOrdinaryIncomeNote: 'Staking + airdrops',
  cardNetCapitalLabel: 'Net Capital Gain/Loss',
  cardNetCapitalNote: 'Short + long term',
  // Short-Term section
  stSectionHeading: 'Short-Term Capital Gains / Losses',
  stSectionNote: '(held < 1 year — taxed as ordinary income)',
  stTotalLabel: 'Short-Term Total',
  // Long-Term section
  ltSectionHeading: 'Long-Term Capital Gains / Losses',
  ltSectionNote: '(held ≥ 1 year — preferential tax rate)',
  ltTotalLabel: 'Long-Term Total',
  // Shared table headers
  thAsset: 'Asset',
  thDateAcquired: 'Date Acquired',
  thDateSold: 'Date Sold',
  thQty: 'Qty',
  thProceeds: 'Proceeds',
  thCostBasis: 'Cost Basis',
  thGainLoss: 'Gain / Loss',
  thNote: 'Note',
  // Ordinary Income section
  ordinaryIncomeHeading: 'Ordinary Income',
  ordinaryIncomeFormNote: '(Schedule 1 / Form 1040)',
  thSource: 'Source',
  thType: 'Type',
  thEvents: 'Events',
  thAmount: 'Amount',
  incomeTypeRewards: 'Rewards / Staking / Interest',
  incomeTypeAirdrop: 'Airdrop',
  totalOrdinaryIncome: 'Total Ordinary Income',
  // Card Rebates section
  cardRebatesHeading: 'Card Rebates',
  cardRebatesNote: '(non-taxable — treated as purchase discount)',
  cardRebatesDesc:
    'These "Card Rebate" rewards are not reported as income. The IRS treats credit/debit card rebates as a reduction in purchase price, not taxable compensation.',
  thEstValue: 'Est. Value',
  cardRebateTypeLabel: 'Card Rebate',
  cardRebateTotalLabel: 'Total (not reported as income)',
  // Loans section
  loanActivityHeading: 'Loan Activity',
  loanActivityDesc:
    'Non-taxable loan events. If collateral was liquidated, it appears in capital gains above.',
  thDate: 'Date',
  thEvent: 'Event',
  thUsdValue: 'USD Value',
  thTaxTreatment: 'Tax Treatment',
  loanLiquidationWarning: '⚠ Taxable forced sale — see capital gains',
  loanNotTaxable: 'Not taxable',
  // Empty state
  emptyHeading: (year) => `No classified tax events for ${year}`,
  emptyDesc:
    'Run the classifier first, or check that your wallets and exchange CSV files are imported.',
  emptyBtn: 'Run Tax Classifier',
  // Interest Paid section
  interestPaidHeading: (year) => `Interest Paid — ${year}`,
  interestPaidNote: '(potentially deductible — consult your tax advisor)',
  thProtocolExchange: 'Protocol / Exchange',
  thTotalPaid: 'Total Paid',
  interestTotalLabel: 'Total',
};

export const es: ReportLocale = {
  lang: 'es',
  pageTitle: 'Resumen Anual | Almstins',
  backLink: '← Centro Fiscal',
  pageHeading: (year) => `Resumen Anual — ${year}`,
  pageSubtitle: (year) =>
    `Ganancias y pérdidas realizadas de ${year}. Para fines de declaración, consulta a un contador calificado.`,
  reviewNeedReview: (n) => `⚠ ${n} requieren revisión`,
  reviewClear: '✅ Cola de revisión vacía',
  btnDownloadHtml: '⬇ Descargar HTML',
  btnDownloadCsv: '⬇ Descargar CSV',
  // Summary cards
  cardShortTermLabel: 'Ganancia/Pérdida a Corto Plazo',
  cardShortTermNote: 'Mantenido < 1 año',
  cardLongTermLabel: 'Ganancia/Pérdida a Largo Plazo',
  cardLongTermNote: 'Mantenido ≥ 1 año',
  cardOrdinaryIncomeLabel: 'Ingreso Ordinario',
  cardOrdinaryIncomeNote: 'Staking + airdrops',
  cardNetCapitalLabel: 'Ganancia/Pérdida Neta de Capital',
  cardNetCapitalNote: 'Corto + largo plazo',
  // Short-Term section
  stSectionHeading: 'Ganancias / Pérdidas de Capital a Corto Plazo',
  stSectionNote: '(mantenido < 1 año — gravado como ingreso ordinario)',
  stTotalLabel: 'Total a Corto Plazo',
  // Long-Term section
  ltSectionHeading: 'Ganancias / Pérdidas de Capital a Largo Plazo',
  ltSectionNote: '(mantenido ≥ 1 año — tasa impositiva preferencial)',
  ltTotalLabel: 'Total a Largo Plazo',
  // Shared table headers
  thAsset: 'Activo',
  thDateAcquired: 'Fecha de Adquisición',
  thDateSold: 'Fecha de Venta',
  thQty: 'Cantidad',
  thProceeds: 'Ingresos',
  thCostBasis: 'Base de Costo',
  thGainLoss: 'Ganancia / Pérdida',
  thNote: 'Nota',
  // Ordinary Income section
  ordinaryIncomeHeading: 'Ingreso Ordinario',
  ordinaryIncomeFormNote: '(Schedule 1 / Form 1040)',
  thSource: 'Fuente',
  thType: 'Tipo',
  thEvents: 'Eventos',
  thAmount: 'Importe',
  incomeTypeRewards: 'Recompensas / Staking / Interés',
  incomeTypeAirdrop: 'Airdrop',
  totalOrdinaryIncome: 'Total de Ingreso Ordinario',
  // Card Rebates section
  cardRebatesHeading: 'Reembolsos de Tarjeta',
  cardRebatesNote: '(no gravable — tratado como descuento en la compra)',
  cardRebatesDesc:
    'Estas recompensas de "Reembolso de Tarjeta" no se declaran como ingresos. El IRS trata los reembolsos de tarjetas de crédito/débito como una reducción del precio de compra, no como compensación gravable.',
  thEstValue: 'Valor Estimado',
  cardRebateTypeLabel: 'Reembolso de Tarjeta',
  cardRebateTotalLabel: 'Total (no declarado como ingreso)',
  // Loans section
  loanActivityHeading: 'Actividad de Préstamos',
  loanActivityDesc:
    'Eventos de préstamo no gravables. Si el colateral fue liquidado, aparece en las ganancias de capital anteriores.',
  thDate: 'Fecha',
  thEvent: 'Evento',
  thUsdValue: 'Valor en USD',
  thTaxTreatment: 'Tratamiento Fiscal',
  loanLiquidationWarning: '⚠ Venta forzada gravable — ver ganancias de capital',
  loanNotTaxable: 'No gravable',
  // Empty state
  emptyHeading: (year) => `Sin eventos fiscales clasificados para ${year}`,
  emptyDesc:
    'Ejecuta primero el clasificador, o verifica que tus wallets y archivos CSV de exchanges estén importados.',
  emptyBtn: 'Ejecutar Clasificador Fiscal',
  // Interest Paid section
  interestPaidHeading: (year) => `Intereses Pagados — ${year}`,
  interestPaidNote: '(potencialmente deducible — consulta a tu asesor fiscal)',
  thProtocolExchange: 'Protocolo / Exchange',
  thTotalPaid: 'Total Pagado',
  interestTotalLabel: 'Total',
};

export const fr: ReportLocale = {
  lang: 'fr',
  pageTitle: 'Récapitulatif Annuel | Almstins',
  backLink: '← Centre Fiscal',
  pageHeading: (year) => `Récapitulatif Annuel — ${year}`,
  pageSubtitle: (year) =>
    `Plus-values et moins-values réalisées pour ${year}. À des fins de déclaration, consultez un comptable qualifié.`,
  reviewNeedReview: (n) => `⚠ ${n} à réviser`,
  reviewClear: '✅ File de révision vide',
  btnDownloadHtml: '⬇ Télécharger HTML',
  btnDownloadCsv: '⬇ Télécharger CSV',
  // Summary cards
  cardShortTermLabel: 'Plus/Moins-value à Court Terme',
  cardShortTermNote: 'Détenu < 1 an',
  cardLongTermLabel: 'Plus/Moins-value à Long Terme',
  cardLongTermNote: 'Détenu ≥ 1 an',
  cardOrdinaryIncomeLabel: 'Revenus Ordinaires',
  cardOrdinaryIncomeNote: 'Staking + airdrops',
  cardNetCapitalLabel: 'Plus/Moins-value Nette en Capital',
  cardNetCapitalNote: 'Court + long terme',
  // Short-Term section
  stSectionHeading: 'Plus-values / Moins-values à Court Terme',
  stSectionNote: '(détenu < 1 an — imposé comme revenu ordinaire)',
  stTotalLabel: 'Total Court Terme',
  // Long-Term section
  ltSectionHeading: 'Plus-values / Moins-values à Long Terme',
  ltSectionNote: "(détenu ≥ 1 an — taux d'imposition préférentiel)",
  ltTotalLabel: 'Total Long Terme',
  // Shared table headers
  thAsset: 'Actif',
  thDateAcquired: "Date d'Acquisition",
  thDateSold: 'Date de Vente',
  thQty: 'Quantité',
  thProceeds: 'Produit de Cession',
  thCostBasis: 'Coût de Base',
  thGainLoss: 'Plus / Moins-value',
  thNote: 'Note',
  // Ordinary Income section
  ordinaryIncomeHeading: 'Revenus Ordinaires',
  ordinaryIncomeFormNote: '(Schedule 1 / Form 1040)',
  thSource: 'Source',
  thType: 'Type',
  thEvents: 'Événements',
  thAmount: 'Montant',
  incomeTypeRewards: 'Récompenses / Staking / Intérêts',
  incomeTypeAirdrop: 'Airdrop',
  totalOrdinaryIncome: 'Total des Revenus Ordinaires',
  // Card Rebates section
  cardRebatesHeading: 'Remises sur Carte',
  cardRebatesNote: '(non imposable — traité comme remise sur achat)',
  cardRebatesDesc:
    "Ces récompenses de \"Remise sur Carte\" ne sont pas déclarées comme revenus. L'IRS traite les remises sur cartes de crédit/débit comme une réduction du prix d'achat, et non comme une rémunération imposable.",
  thEstValue: 'Valeur Est.',
  cardRebateTypeLabel: 'Remise sur Carte',
  cardRebateTotalLabel: 'Total (non déclaré comme revenu)',
  // Loans section
  loanActivityHeading: 'Activité de Prêts',
  loanActivityDesc:
    "Événements de prêt non imposables. Si le collatéral a été liquidé, il figure dans les plus-values ci-dessus.",
  thDate: 'Date',
  thEvent: 'Événement',
  thUsdValue: 'Valeur USD',
  thTaxTreatment: 'Traitement Fiscal',
  loanLiquidationWarning: '⚠ Vente forcée imposable — voir les plus-values',
  loanNotTaxable: 'Non imposable',
  // Empty state
  emptyHeading: (year) => `Aucun événement fiscal classifié pour ${year}`,
  emptyDesc:
    "Exécutez d'abord le classificateur, ou vérifiez que vos wallets et fichiers CSV d'exchanges sont importés.",
  emptyBtn: 'Lancer le Classificateur Fiscal',
  // Interest Paid section
  interestPaidHeading: (year) => `Intérêts Payés — ${year}`,
  interestPaidNote: '(potentiellement déductibles — consultez votre conseiller fiscal)',
  thProtocolExchange: 'Protocole / Exchange',
  thTotalPaid: 'Total Payé',
  interestTotalLabel: 'Total',
};

const MAP: Record<Lang, ReportLocale> = { en, es, fr };

/** Select the Report locale for a language, falling back to English. */
export function getReport(lang: Lang): ReportLocale {
  return MAP[lang] ?? en;
}
