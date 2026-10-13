// Tax page — finance terminology (gains, cost basis, Schedule D, Form 8949…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Gains Summary page — page-level strings (EN · ES · FR).
//
// Cookie-based: yearEnd/gains.astro reads getLang(Astro.request) and selects
// via getGains(lang). These are the strings the PAGE owns — header, section
// cards, warnings, and CTA. Child components (CompletenessScore) carry their
// own text.
//
// DO NOT translate: US tax form names (Form 8949, Schedule D, Schedule 1,
// Form 1040), cost basis method acronyms (FIFO, HIFO, LIFO, Spec ID),
// NIIT acronym, pipeline-internal labels, tickers, $, %, or code.
// Financial concept words (gain, loss, proceeds, cost basis, realized/
// unrealized, short-term, long-term, disposal, carryforward, ordinary income,
// wash sale, harvest) ARE translatable — first-pass only.

import type { Lang } from '@/lib/i18n/locale';

export interface GainsLocale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  heroTitle: string;
  /** "Realized gains overview for {year}." */
  heroSub: (year: number) => string;
  heroSubDetail: string;
  heroSubLinkLabel: string;
  // Method toggle tooltips (title attributes)
  fifoTitle: string;
  hifoTitle: string;
  lifoTitle: string;
  specIdTitle: string;
  // Active method badge labels
  hifoActive: string;
  lifoActive: string;
  specIdActive: string;
  yearLabel: string;
  // Error
  loadError: (year: number) => string;
  // Unpriced transactions warning
  unpricedHeading: (count: number) => string;
  unpricedBody: string;
  unpricedWalletsLink: string;
  // Realized Capital Gains card
  capitalGainsHeading: string;
  /** "{method} cost basis · Schedule D" */
  capitalGainsSub: (method: string) => string;
  pipelineBadge: string;
  inMemoryBadge: string;
  // ST / LT / Net labels
  shortTermLabel: string;
  shortTermNote: string;
  shortTermSub: string;
  longTermLabel: string;
  longTermNote: string;
  longTermSub: string;
  netRealizedLabel: string;
  netRealizedSub: string;
  /** "{n} lot(s)" — singular/plural handled by caller */
  lotCount: (n: number) => string;
  // Cross-check warnings
  gainDivergeHeading: string;
  gainDivergeSub: (pipeline: string, displayed: string, diff: string) => string;
  incomeDivergeHeading: string;
  incomeDivergeSub: (pipeline: string, displayed: string, diff: string) => string;
  // Pipeline run bar
  pipelineStatus: (status: string) => string;
  inProgress: string;
  classified: (n: number) => string;
  unknown: (n: number) => string;
  rerunBtn: string;
  // First-run prompt
  firstRunHeading: string;
  firstRunSub: string;
  runPipelineBtn: string;
  // Stale pipeline warning
  stalePipelineHeading: string;
  stalePipelineBody: string;
  staleDays: (days: number) => string;
  staleHours: (hrs: number) => string;
  staleRecent: string;
  staleAfterPipeline: string;
  staleLastRun: string;
  staleLatestImport: string;
  rerunPipelineBtn: string;
  // Capital Loss Carryforward
  carryforwardHeading: string;
  carryforwardSub: (year: number) => string;
  availableToApply: string;
  carryColYear: string;
  carryColNetGain: string;
  carryColDeducted: string;
  carryColAbsorbed: string;
  carryColEnding: string;
  carryHowTo: (year: number) => string;
  // No carryforward note
  noCarryforward: (year: number) => string;
  // Gain / Loss by Asset table
  byAssetHeading: string;
  byAssetSub: string;
  colAsset: string;
  colStGain: string;
  colStLots: string;
  colLtGain: string;
  colLtLots: string;
  colNet: string;
  colTotal: string;
  /** "{asset} · {n} disposal(s)" */
  assetDisposals: (asset: string, n: number) => string;
  csvBtn: string;
  lotColSold: string;
  lotColQty: string;
  lotColAcquired: string;
  lotColHeld: string;
  lotColProceeds: string;
  lotColCostBasis: string;
  lotColGainLoss: string;
  lotColTerm: string;
  lotSubtotal: string;
  termLong: string;
  termShort: string;
  // Tax-loss harvesting
  harvestHeading: string;
  harvestSub: string;
  /** "{n} asset(s) underwater" */
  harvestCount: (n: number) => string;
  harvestColAsset: string;
  harvestColQty: string;
  harvestColCost: string;
  harvestColValue: string;
  harvestColLoss: string;
  harvestColTerm: string;
  harvestColDaysToLt: string;
  harvestLtCheck: string;
  termMixed: string;
  harvestNote: string;
  // Missing cost basis
  missingBasisHeading: string;
  missingBasisSub: string;
  /** "{n} issue(s)" */
  missingBasisCount: (n: number) => string;
  missingColAsset: string;
  missingColDisposed: string;
  missingColQty: string;
  missingColProceeds: string;
  missingColTerm: string;
  missingColProblem: string;
  missingColFix: string;
  termUnknown: string;
  issueNoMatchingBuy: string;
  issueBuyNoPrice: string;
  fixFindBookkeeping: string;
  fixEnterCost: string;
  missingImpact: string;
  // Estimated Tax Liability
  estimatorHeading: string;
  /** "Based on {year} IRS brackets · {METHOD} cost basis · estimate only" */
  estimatorSub: (year: number, method: string) => string;
  estimatorDisclaimer: string;
  labelFilingStatus: string;
  optSingle: string;
  optMfj: string;
  optMfs: string;
  optHoh: string;
  labelOtherIncome: string;
  labelState: string;
  estStFederal: string;
  estLtFederal: string;
  estCryptoIncome: string;
  estCryptoIncomeSub: string;
  estNiit: string;
  estNiitSub: string;
  estStateTax: string;
  estMarginalRate: string;
  estCapGainsRate: string;
  estTopMarginal: string;
  estTotal: string;
  estTotalSub: string;
  niitBanner: string;
  estimatorFootnote: (year: number) => string;
  // Summary cards
  ordinaryIncomeLabel: string;
  ordinaryIncomeSub: (count: number) => string;
  disposalProceedsLabel: string;
  /** "{n} disposal(s) · gross proceeds" */
  disposalsSub: (count: number) => string;
  forcedLiquidationsLabel: string;
  forcedLiquidationsSub: string;
  // Income breakdown tables
  incomeByTypeHeading: string;
  incomeByTypeSub: string;
  incomeByTypeFormRef: string;
  incomeColType: string;
  incomeColIrsLine: string;
  incomeColEvents: string;
  incomeColTotal: string;
  incomeByAssetHeading: string;
  incomeByAssetPipeline: string;
  incomeByAssetLifecycle: string;
  incomeByAssetFormRef: string;
  incomeColAsset: string;
  // Unpriced disposals warning
  unpricedDisposals: (count: number, year: number) => string;
  unpricedDisposalsSingular: (count: number, year: number) => string;
  unpricedDisposalsLink: string;
  // No taxable activity
  noTaxableEvents: (year: number) => string;
  noTaxableEventsSub: string;
  // Wash Sale Shadow Tracker
  washSaleHeading: string;
  washSaleShadowBadge: string;
  washSaleSubheading: string;
  washSaleWouldBe: string;
  washColAsset: string;
  washColSaleDate: string;
  washColLoss: string;
  washColTrigger: string;
  washColWouldDisallow: string;
  washFootnote: string;
  // DeFi Events
  defiHeading: string;
  defiSub: string;
  defiReviewLink: string;
  defiColType: string;
  defiColEvents: string;
  defiColTotal: string;
  defiColTax: string;
  defiLpDeposit: string;
  defiLpWithdrawal: string;
  defiRebaseIncome: string;
  defiWrappedSwap: string;
  defiFootnote: string;
  defiReviewQueueLink: string;
  // YoY chart
  yoyHeading: string;
  yoySubLabel: string;
  yoyAxisLabel: string;
  // Form 8949 CTA
  exportCtaHeading: string;
  exportCtaBody: string;
  exportCtaBtn: string;
  // Pipeline JS button labels (injected from define:vars)
  pipelineBtnRunning: string;
  pipelineBtnDone: string;
  pipelineBtnRerun: string;
  pipelineNetworkError: string;
}

export const en: GainsLocale = {
  lang: 'en',
  pageTitle: 'Gains Summary | Almstins',
  backLink: '← Tax Center',
  heroTitle: 'Gains Summary',
  heroSub: (year) => `Realized gains overview for ${year}.`,
  heroSubDetail: 'Detailed gain/loss per lot is in the',
  heroSubLinkLabel: 'CSV export',
  fifoTitle: 'First In, First Out — IRS default',
  hifoTitle: 'Highest In, First Out — minimizes taxable gain',
  lifoTitle: 'Last In, First Out — preferred in down markets',
  specIdTitle: 'Specific Identification — manually choose which lot to sell',
  hifoActive: 'HIFO active — selling highest-cost lots first',
  lifoActive: 'LIFO active — selling most-recently-acquired lots first',
  specIdActive: 'Spec ID active — using your pinned lot assignments',
  yearLabel: 'Year',
  loadError: (year) => `Unable to load tax data for ${year}. Try refreshing the page.`,
  unpricedHeading: (count) =>
    `${count} on-chain transaction${count !== 1 ? 's are' : ' is'} missing historical USD prices.`,
  unpricedBody:
    'Cost basis and proceeds may be incomplete. Historical pricing runs automatically after each sync — check back shortly or trigger a re-sync from the',
  unpricedWalletsLink: 'wallets page',
  capitalGainsHeading: 'Realized Capital Gains',
  capitalGainsSub: (method) => `${method} cost basis · Schedule D`,
  pipelineBadge: 'Pipeline data',
  inMemoryBadge: 'In-memory FIFO',
  shortTermLabel: 'Short-term',
  shortTermNote: '(held ≤ 1 yr)',
  shortTermSub: 'taxed as ordinary income',
  longTermLabel: 'Long-term',
  longTermNote: '(held > 1 yr)',
  longTermSub: '0% / 15% / 20% rate',
  netRealizedLabel: 'Net realized',
  netRealizedSub: 'ST + LT combined',
  lotCount: (n) => `${n} lot${n !== 1 ? 's' : ''}`,
  gainDivergeHeading: 'Pipeline gain/loss diverges from displayed calculation',
  gainDivergeSub: (pipeline, displayed, diff) =>
    `The stored tax_disposals net gain is ${pipeline} but the displayed total is ${displayed} (diff ${diff}). Re-run the classification pipeline to regenerate the stored lots.`,
  incomeDivergeHeading: 'Pipeline income total diverges from displayed calculation',
  incomeDivergeSub: (pipeline, displayed, diff) =>
    `The classification pipeline shows ${pipeline} but the displayed total is ${displayed} (diff ${diff}). Re-run the classification pipeline to resolve.`,
  pipelineStatus: (status) => `Pipeline ${status}`,
  inProgress: 'in progress',
  classified: (n) => `${n.toLocaleString()} classified`,
  unknown: (n) => `${n} unknown`,
  rerunBtn: 'Re-run',
  firstRunHeading: 'Run the classification pipeline',
  firstRunSub:
    'Classify your transactions for IRS-accurate FIFO lot matching, income detection, and Schedule D output.',
  runPipelineBtn: 'Run Pipeline',
  stalePipelineHeading: 'Pipeline data may be out of date',
  stalePipelineBody: 'New transactions were imported',
  staleDays: (days) => ` ${days} days`,
  staleHours: (hrs) => ` ${hrs} hour${hrs !== 1 ? 's' : ''}`,
  staleRecent: ' recently',
  staleAfterPipeline: 'after the last pipeline run. The gains shown may not reflect your latest data.',
  staleLastRun: 'Last run:',
  staleLatestImport: '· Latest import:',
  rerunPipelineBtn: 'Re-run Pipeline',
  carryforwardHeading: 'Capital Loss Carryforward',
  carryforwardSub: (year) => `Unused losses from prior years that can offset your ${year} gains`,
  availableToApply: 'available to apply',
  carryColYear: 'Year',
  carryColNetGain: 'Net Gain / Loss',
  carryColDeducted: 'Deducted vs Income',
  carryColAbsorbed: 'Absorbed by Gain',
  carryColEnding: 'Ending Balance',
  carryHowTo: (year) =>
    `How to use it: Apply this carryforward against your ${year} net gain before calculating tax. Up to $3,000 per year can also offset ordinary income if your net is still negative after applying it. Your tax software or CPA will enter this on Schedule D.`,
  noCarryforward: (year) =>
    `You had loss years in the past but the full balance has been used up — no carryforward available for ${year}.`,
  byAssetHeading: 'Gain / Loss by Asset',
  byAssetSub: 'Click any row to see individual lots · sorted by impact',
  colAsset: 'Asset',
  colStGain: 'ST Gain / Loss',
  colStLots: 'ST Lots',
  colLtGain: 'LT Gain / Loss',
  colLtLots: 'LT Lots',
  colNet: 'Net',
  colTotal: 'Total',
  assetDisposals: (asset, n) => `${asset} · ${n} disposal${n !== 1 ? 's' : ''}`,
  csvBtn: '↓ CSV',
  lotColSold: 'Sold',
  lotColQty: 'Qty',
  lotColAcquired: 'Acquired',
  lotColHeld: 'Held',
  lotColProceeds: 'Proceeds',
  lotColCostBasis: 'Cost Basis',
  lotColGainLoss: 'Gain / Loss',
  lotColTerm: 'Term',
  lotSubtotal: 'Subtotal',
  termLong: 'LT',
  termShort: 'ST',
  harvestHeading: 'Tax-Loss Harvesting Opportunities',
  harvestSub: 'Open lots currently below cost basis · selling locks in a deductible loss',
  harvestCount: (n) => `${n} asset${n !== 1 ? 's' : ''} underwater`,
  harvestColAsset: 'Asset',
  harvestColQty: 'Qty Held',
  harvestColCost: 'Cost Basis',
  harvestColValue: 'Current Value',
  harvestColLoss: 'Unrealized Loss',
  harvestColTerm: 'Term',
  harvestColDaysToLt: 'Days to LT',
  harvestLtCheck: '✓ LT',
  termMixed: 'Mixed',
  harvestNote:
    'Note: Prices are live spot rates. Selling and immediately rebuying may trigger wash-sale–like treatment depending on IRS guidance for your situation. Consult a tax professional before harvesting.',
  missingBasisHeading: 'Missing Cost Basis',
  missingBasisSub: 'These disposals have incomplete records — your gain/loss totals above may be wrong',
  missingBasisCount: (n) => `${n} issue${n !== 1 ? 's' : ''}`,
  missingColAsset: 'Asset',
  missingColDisposed: 'Disposed',
  missingColQty: 'Qty',
  missingColProceeds: 'Proceeds',
  missingColTerm: 'Term',
  missingColProblem: 'Problem',
  missingColFix: 'Fix',
  termUnknown: 'Unknown',
  issueNoMatchingBuy: 'No matching buy',
  issueBuyNoPrice: 'Buy has no price',
  fixFindBookkeeping: 'Find in Bookkeeping →',
  fixEnterCost: 'Enter cost manually →',
  missingImpact:
    'Impact: "No matching buy" means the IRS may treat the full proceeds as gain. "Buy has no price" means cost basis is assumed $0, overstating your taxable gain. Resolve these in Bookkeeping before relying on these totals.',
  estimatorHeading: 'Estimated Tax Liability',
  estimatorSub: (year, method) => `Based on ${year} IRS brackets · ${method} cost basis · estimate only`,
  estimatorDisclaimer: 'Not financial advice',
  labelFilingStatus: 'Filing Status',
  optSingle: 'Single',
  optMfj: 'Married Filing Jointly',
  optMfs: 'Married Filing Separately',
  optHoh: 'Head of Household',
  labelOtherIncome: 'Other Taxable Income (wages, salary, etc.)',
  labelState: 'State',
  estStFederal: 'ST Federal',
  estLtFederal: 'LT Federal',
  estCryptoIncome: 'Crypto Income',
  estCryptoIncomeSub: 'staking / interest',
  estNiit: 'NIIT (3.8%)',
  estNiitSub: 'net investment income',
  estStateTax: 'State Tax Est.',
  estMarginalRate: 'marginal rate',
  estCapGainsRate: 'capital gains rate',
  estTopMarginal: 'top marginal rate',
  estTotal: 'Total Estimate',
  estTotalSub: 'federal + state',
  niitBanner:
    '⚠ Net Investment Income Tax applies. Your total income exceeds the NIIT threshold. An additional 3.8% applies to your crypto gains and income on top of ordinary rates. This is included in the total estimate above.',
  estimatorFootnote: (year) =>
    `Rough estimate using ${year} IRS marginal brackets + state top marginal rate (flat applied to all crypto income and gains). Does not account for deductions, AMT, capital loss carryforward, local taxes, or state-specific preferential rates (e.g. MA short-term gains at 8.5%, WA 7% LT gains above $262K threshold). Short-term gains are stacked on top of your other income. If you don't have employer withholding covering this amount, you may owe quarterly estimated payments — ask your CPA. Not financial advice.`,
  ordinaryIncomeLabel: 'Ordinary Income',
  ordinaryIncomeSub: (count) =>
    `${count} interest event${count !== 1 ? 's' : ''} · Schedule 1 / Form 1040`,
  disposalProceedsLabel: 'Disposal Proceeds',
  disposalsSub: (count) => `${count} disposal${count !== 1 ? 's' : ''} · gross proceeds`,
  forcedLiquidationsLabel: 'Forced Liquidations',
  forcedLiquidationsSub: 'Aave liquidations — treated as taxable sales',
  incomeByTypeHeading: 'Ordinary Income by Type',
  incomeByTypeSub: 'Each income type maps to a different IRS form line',
  incomeByTypeFormRef: 'Schedule 1 · Form 1040',
  incomeColType: 'Type',
  incomeColIrsLine: 'IRS Line',
  incomeColEvents: 'Events',
  incomeColTotal: 'Total Income',
  incomeByAssetHeading: 'Ordinary Income by Asset',
  incomeByAssetPipeline: 'Source: classification pipeline',
  incomeByAssetLifecycle: 'Source: lifecycle events (run pipeline for full breakdown)',
  incomeByAssetFormRef: 'Schedule 1 · Form 1040',
  incomeColAsset: 'Asset',
  unpricedDisposals: (count, year) =>
    `${count} disposals in ${year} are missing USD prices — the proceeds total above is understated. Open the`,
  unpricedDisposalsSingular: (count, year) =>
    `${count} disposal in ${year} is missing USD prices — the proceeds total above is understated. Open the`,
  unpricedDisposalsLink: 'transactions page',
  noTaxableEvents: (year) => `No taxable events found for ${year}.`,
  noTaxableEventsSub: 'If this seems wrong, check that your wallets and exchange imports are up to date.',
  washSaleHeading: 'Wash Sale Shadow Tracker',
  washSaleShadowBadge: 'Shadow Mode',
  washSaleSubheading:
    'Crypto is currently exempt from wash sale rules (IRS treats it as property, not a security). This analysis shows losses that would be disallowed under proposed legislation extending wash sale rules to crypto. No tax is owed — this is for planning only.',
  washSaleWouldBe: 'would-be disallowed',
  washColAsset: 'Asset',
  washColSaleDate: 'Sale Date',
  washColLoss: 'Loss',
  washColTrigger: 'Triggered By (Re-buy)',
  washColWouldDisallow: 'Would Disallow',
  washFootnote:
    'A wash sale occurs when you sell at a loss and buy the same asset within 30 days before or after. Under current law, crypto is exempt. Congress has proposed extending wash sale rules to digital assets in several bills — this tracker helps you understand your exposure if that happens.',
  defiHeading: 'DeFi Events Flagged for Review',
  defiSub: 'These transactions have no clear IRS guidance — review each one with your tax advisor.',
  defiReviewLink: 'Review queue →',
  defiColType: 'Event Type',
  defiColEvents: 'Events',
  defiColTotal: 'Total USD',
  defiColTax: 'Tax Consideration',
  defiLpDeposit: 'May be taxable swap at time of deposit',
  defiLpWithdrawal: 'May include taxable gain/loss and/or impermanent loss',
  defiRebaseIncome: 'Likely ordinary income at FMV — Schedule 1 Line 8z',
  defiWrappedSwap: 'Property exchange — may realise capital gain/loss',
  defiFootnote: 'DeFi events are flagged automatically by the classification pipeline. Open the',
  defiReviewQueueLink: 'review queue',
  yoyHeading: 'Year-over-Year Realized Gains',
  yoySubLabel: 'ST + LT net · FIFO',
  yoyAxisLabel: 'Net Realized Gain / (Loss)',
  exportCtaHeading: 'Ready to export?',
  exportCtaBody:
    'Download the line-by-line CSV with short-term vs long-term classification per lot from the transactions page.',
  exportCtaBtn: 'Open Transactions →',
  pipelineBtnRunning: '⏳ Running…',
  pipelineBtnDone: '✓ Done — reloading…',
  pipelineBtnRerun: 'Re-run Pipeline',
  pipelineNetworkError: 'Network error — could not reach the server. Please try again.',
};

export const es: GainsLocale = {
  lang: 'es',
  pageTitle: "Resumen de Ganancias | Almstins",
  backLink: "← Centro Fiscal",
  heroTitle: "Resumen de Ganancias",
  heroSub: (year) => `Resumen de ganancias realizadas para ${year}.`,
  heroSubDetail: "El detalle de ganancias/pérdidas por lote está en la",
  heroSubLinkLabel: "exportación CSV",
  fifoTitle: "Primero en entrar, primero en salir — predeterminado del IRS",
  hifoTitle: "Mayor coste, primero en salir — minimiza la ganancia imponible",
  lifoTitle: "Último en entrar, primero en salir — preferido en mercados bajistas",
  specIdTitle: "Identificación específica — elige manualmente qué lote vender",
  hifoActive: "HIFO activo — vendiendo primero los lotes de mayor coste",
  lifoActive: "LIFO activo — vendiendo primero los lotes adquiridos más recientemente",
  specIdActive: "Spec ID activo — usando tus asignaciones de lotes fijadas",
  yearLabel: "Año",
  loadError: (year) => `No se pudieron cargar los datos fiscales para ${year}. Intenta refrescar la página.`,
  unpricedHeading: (count) =>
    `${count} transacción${count !== 1 ? "es" : ""} on-chain ${count !== 1 ? "carecen" : "carece"} de precios históricos en USD.`,
  unpricedBody:
    "La base de costo y los ingresos pueden estar incompletos. Los precios históricos se actualizan automáticamente tras cada sincronización — vuelve pronto o activa una resincronización desde la",
  unpricedWalletsLink: "página de wallets",
  capitalGainsHeading: "Ganancias de Capital Realizadas",
  capitalGainsSub: (method) => `Base de costo ${method} · Schedule D`,
  pipelineBadge: "Datos del pipeline",
  inMemoryBadge: "FIFO en memoria",
  shortTermLabel: "Corto plazo",
  shortTermNote: "(mantenido ≤ 1 año)",
  shortTermSub: "tributado como ingreso ordinario",
  longTermLabel: "Largo plazo",
  longTermNote: "(mantenido > 1 año)",
  longTermSub: "tasa 0% / 15% / 20%",
  netRealizedLabel: "Ganancia neta realizada",
  netRealizedSub: "CT + LP combinados",
  lotCount: (n) => `${n} lote${n !== 1 ? "s" : ""}`,
  gainDivergeHeading: "La ganancia/pérdida del pipeline difiere del cálculo mostrado",
  gainDivergeSub: (pipeline, displayed, diff) =>
    `La ganancia neta almacenada en tax_disposals es ${pipeline} pero el total mostrado es ${displayed} (diferencia ${diff}). Vuelve a ejecutar el pipeline de clasificación para regenerar los lotes almacenados.`,
  incomeDivergeHeading: "El total de ingresos del pipeline difiere del cálculo mostrado",
  incomeDivergeSub: (pipeline, displayed, diff) =>
    `El pipeline de clasificación muestra ${pipeline} pero el total mostrado es ${displayed} (diferencia ${diff}). Vuelve a ejecutar el pipeline de clasificación para resolverlo.`,
  pipelineStatus: (status) => `Pipeline ${status}`,
  inProgress: "en curso",
  classified: (n) => `${n.toLocaleString("es-ES")} clasificadas`,
  unknown: (n) => `${n} desconocidas`,
  rerunBtn: "Volver a ejecutar",
  firstRunHeading: "Ejecutar el pipeline de clasificación",
  firstRunSub:
    "Clasifica tus transacciones para una asignación de lotes FIFO precisa según el IRS, detección de ingresos y salida para Schedule D.",
  runPipelineBtn: "Ejecutar Pipeline",
  stalePipelineHeading: "Los datos del pipeline pueden estar desactualizados",
  stalePipelineBody: "Se importaron nuevas transacciones",
  staleDays: (days) => ` hace ${days} días`,
  staleHours: (hrs) => ` hace ${hrs} hora${hrs !== 1 ? "s" : ""}`,
  staleRecent: " recientemente",
  staleAfterPipeline:
    "tras la última ejecución del pipeline. Las ganancias mostradas pueden no reflejar tus datos más recientes.",
  staleLastRun: "Última ejecución:",
  staleLatestImport: "· Última importación:",
  rerunPipelineBtn: "Volver a ejecutar Pipeline",
  carryforwardHeading: "Arrastre de Pérdidas de Capital",
  carryforwardSub: (year) => `Pérdidas no utilizadas de años anteriores que pueden compensar tus ganancias de ${year}`,
  availableToApply: "disponibles para aplicar",
  carryColYear: "Año",
  carryColNetGain: "Ganancia / Pérdida Neta",
  carryColDeducted: "Deducido sobre Ingresos",
  carryColAbsorbed: "Absorbido por Ganancia",
  carryColEnding: "Saldo Final",
  carryHowTo: (year) =>
    `Cómo utilizarlo: Aplica este arrastre contra tu ganancia neta de ${year} antes de calcular el impuesto. Hasta $3,000 por año también pueden compensar ingresos ordinarios si el neto sigue siendo negativo después de aplicarlo. Tu software fiscal o CPA lo introducirá en Schedule D.`,
  noCarryforward: (year) =>
    `Tuviste años con pérdidas en el pasado, pero el saldo completo se ha agotado — no hay arrastre disponible para ${year}.`,
  byAssetHeading: "Ganancia / Pérdida por Activo",
  byAssetSub: "Haz clic en cualquier fila para ver los lotes individuales · ordenados por impacto",
  colAsset: "Activo",
  colStGain: "Ganancia/Pérdida CT",
  colStLots: "Lotes CT",
  colLtGain: "Ganancia/Pérdida LP",
  colLtLots: "Lotes LP",
  colNet: "Neto",
  colTotal: "Total",
  assetDisposals: (asset, n) => `${asset} · ${n} disposición${n !== 1 ? "es" : ""}`,
  csvBtn: "↓ CSV",
  lotColSold: "Vendido",
  lotColQty: "Cant.",
  lotColAcquired: "Adquirido",
  lotColHeld: "Mantenido",
  lotColProceeds: "Ingresos",
  lotColCostBasis: "Base de Costo",
  lotColGainLoss: "Ganancia / Pérdida",
  lotColTerm: "Plazo",
  lotSubtotal: "Subtotal",
  termLong: "LP",
  termShort: "CT",
  harvestHeading: "Oportunidades de Compensación de Pérdidas Fiscales",
  harvestSub: "Lotes abiertos actualmente por debajo de la base de costo · vender fija una pérdida deducible",
  harvestCount: (n) => `${n} activo${n !== 1 ? "s" : ""} bajo el agua`,
  harvestColAsset: "Activo",
  harvestColQty: "Cant. Mantenida",
  harvestColCost: "Base de Costo",
  harvestColValue: "Valor Actual",
  harvestColLoss: "Pérdida No Realizada",
  harvestColTerm: "Plazo",
  harvestColDaysToLt: "Días para LP",
  harvestLtCheck: "✓ LP",
  termMixed: "Mixto",
  harvestNote:
    "Nota: Los precios son tasas spot en tiempo real. Vender y recomprar inmediatamente puede generar un tratamiento similar al de ventas ficticias según las directrices del IRS para tu situación. Consulta a un profesional fiscal antes de cosechar pérdidas.",
  missingBasisHeading: "Base de Costo Faltante",
  missingBasisSub: "Estas disposiciones tienen registros incompletos — los totales de ganancias/pérdidas anteriores pueden ser incorrectos",
  missingBasisCount: (n) => `${n} problema${n !== 1 ? "s" : ""}`,
  missingColAsset: "Activo",
  missingColDisposed: "Dispuesto",
  missingColQty: "Cant.",
  missingColProceeds: "Ingresos",
  missingColTerm: "Plazo",
  missingColProblem: "Problema",
  missingColFix: "Solución",
  termUnknown: "Desconocido",
  issueNoMatchingBuy: "Sin compra coincidente",
  issueBuyNoPrice: "Compra sin precio",
  fixFindBookkeeping: "Buscar en Contabilidad →",
  fixEnterCost: "Introducir costo manualmente →",
  missingImpact:
    "Impacto: \"Sin compra coincidente\" significa que el IRS puede tratar el total de los ingresos como ganancia. \"Compra sin precio\" significa que la base de costo se asume en $0, sobrestimando tu ganancia imponible. Resuelve estos problemas en Contabilidad antes de confiar en estos totales.",
  estimatorHeading: "Estimación de Pasivo Fiscal",
  estimatorSub: (year, method) => `Basado en los tramos del IRS de ${year} · base de costo ${method} · solo estimación`,
  estimatorDisclaimer: "No es asesoramiento financiero",
  labelFilingStatus: "Estado Civil para Efectos Fiscales",
  optSingle: "Soltero/a",
  optMfj: "Casado/a declarando conjuntamente",
  optMfs: "Casado/a declarando por separado",
  optHoh: "Cabeza de familia",
  labelOtherIncome: "Otros Ingresos Imponibles (salarios, sueldo, etc.)",
  labelState: "Estado",
  estStFederal: "Federal CT",
  estLtFederal: "Federal LP",
  estCryptoIncome: "Ingresos Cripto",
  estCryptoIncomeSub: "staking / intereses",
  estNiit: "NIIT (3,8%)",
  estNiitSub: "ingreso neto por inversión",
  estStateTax: "Est. Impuesto Estatal",
  estMarginalRate: "tasa marginal",
  estCapGainsRate: "tasa de ganancias de capital",
  estTopMarginal: "tasa marginal máxima",
  estTotal: "Estimación Total",
  estTotalSub: "federal + estatal",
  niitBanner:
    "⚠ Se aplica el Impuesto sobre la Renta Neta por Inversión. Tu ingreso total supera el umbral del NIIT. Se aplica un 3,8% adicional sobre tus ganancias e ingresos cripto además de las tasas ordinarias. Esto está incluido en la estimación total anterior.",
  estimatorFootnote: (year) =>
    `Estimación aproximada usando los tramos marginales del IRS de ${year} + tasa marginal máxima estatal (aplicada uniformemente a todos los ingresos y ganancias cripto). No tiene en cuenta deducciones, AMT, arrastre de pérdidas de capital, impuestos locales ni tasas preferenciales específicas de cada estado. Las ganancias a corto plazo se suman a tus otros ingresos. Si tu retención de empleador no cubre este monto, es posible que debas pagos estimados trimestrales — consulta a tu CPA. No es asesoramiento financiero.`,
  ordinaryIncomeLabel: "Ingresos Ordinarios",
  ordinaryIncomeSub: (count) =>
    `${count} evento${count !== 1 ? "s" : ""} de intereses · Schedule 1 / Form 1040`,
  disposalProceedsLabel: "Ingresos por Disposición",
  disposalsSub: (count) => `${count} disposición${count !== 1 ? "es" : ""} · ingresos brutos`,
  forcedLiquidationsLabel: "Liquidaciones Forzadas",
  forcedLiquidationsSub: "Liquidaciones de Aave — tratadas como ventas imponibles",
  incomeByTypeHeading: "Ingresos Ordinarios por Tipo",
  incomeByTypeSub: "Cada tipo de ingreso corresponde a una línea diferente del formulario del IRS",
  incomeByTypeFormRef: "Schedule 1 · Form 1040",
  incomeColType: "Tipo",
  incomeColIrsLine: "Línea IRS",
  incomeColEvents: "Eventos",
  incomeColTotal: "Ingresos Totales",
  incomeByAssetHeading: "Ingresos Ordinarios por Activo",
  incomeByAssetPipeline: "Fuente: pipeline de clasificación",
  incomeByAssetLifecycle: "Fuente: eventos del ciclo de vida (ejecuta el pipeline para el desglose completo)",
  incomeByAssetFormRef: "Schedule 1 · Form 1040",
  incomeColAsset: "Activo",
  unpricedDisposals: (count, year) =>
    `${count} disposiciones en ${year} tienen precios en USD faltantes — el total de ingresos anterior está subestimado. Abre la`,
  unpricedDisposalsSingular: (count, year) =>
    `${count} disposición en ${year} tiene precio en USD faltante — el total de ingresos anterior está subestimado. Abre la`,
  unpricedDisposalsLink: "página de transacciones",
  noTaxableEvents: (year) => `No se encontraron eventos imponibles para ${year}.`,
  noTaxableEventsSub: "Si esto parece incorrecto, verifica que tus wallets e importaciones de exchanges estén actualizadas.",
  washSaleHeading: "Rastreador de Ventas Ficticias (Shadow)",
  washSaleShadowBadge: "Modo Shadow",
  washSaleSubheading:
    "Actualmente las criptomonedas están exentas de las reglas de ventas ficticias (el IRS las trata como propiedad, no como un valor). Este análisis muestra las pérdidas que serían inadmisibles bajo la legislación propuesta que extiende las reglas de ventas ficticias a las criptomonedas. No se adeuda impuesto — esto es solo para planificación.",
  washSaleWouldBe: "serían inadmisibles",
  washColAsset: "Activo",
  washColSaleDate: "Fecha de Venta",
  washColLoss: "Pérdida",
  washColTrigger: "Activado Por (Recompra)",
  washColWouldDisallow: "Inadmitirían",
  washFootnote:
    "Una venta ficticia ocurre cuando vendes con pérdida y recompras el mismo activo dentro de los 30 días anteriores o posteriores. Según la ley actual, las criptomonedas están exentas. El Congreso ha propuesto extender las reglas de ventas ficticias a los activos digitales en varios proyectos de ley — este rastreador te ayuda a entender tu exposición si eso ocurre.",
  defiHeading: "Eventos DeFi Marcados para Revisión",
  defiSub: "Estas transacciones no tienen orientación clara del IRS — revisa cada una con tu asesor fiscal.",
  defiReviewLink: "Cola de revisión →",
  defiColType: "Tipo de Evento",
  defiColEvents: "Eventos",
  defiColTotal: "Total USD",
  defiColTax: "Consideración Fiscal",
  defiLpDeposit: "Puede ser un intercambio imponible en el momento del depósito",
  defiLpWithdrawal: "Puede incluir ganancia/pérdida imponible y/o pérdida impermanente",
  defiRebaseIncome: "Probable ingreso ordinario al valor justo de mercado — Schedule 1 Line 8z",
  defiWrappedSwap: "Intercambio de propiedad — puede generar ganancia/pérdida de capital",
  defiFootnote: "Los eventos DeFi son marcados automáticamente por el pipeline de clasificación. Abre la",
  defiReviewQueueLink: "cola de revisión",
  yoyHeading: "Ganancias Realizadas Año tras Año",
  yoySubLabel: "CT + LP neto · FIFO",
  yoyAxisLabel: "Ganancia / (Pérdida) Neta Realizada",
  exportCtaHeading: "¿Listo para exportar?",
  exportCtaBody:
    "Descarga el CSV línea por línea con clasificación de corto y largo plazo por lote desde la página de transacciones.",
  exportCtaBtn: "Abrir Transacciones →",
  pipelineBtnRunning: "⏳ Ejecutando…",
  pipelineBtnDone: "✓ Listo — recargando…",
  pipelineBtnRerun: "Volver a ejecutar Pipeline",
  pipelineNetworkError: "Error de red — no se pudo conectar al servidor. Por favor, inténtalo de nuevo.",
};

export const fr: GainsLocale = {
  lang: 'fr',
  pageTitle: "Récapitulatif des Plus-values | Almstins",
  backLink: "← Centre Fiscal",
  heroTitle: "Récapitulatif des Plus-values",
  heroSub: (year) => `Aperçu des plus-values réalisées pour ${year}.`,
  heroSubDetail: "Le détail des gains/pertes par lot se trouve dans",
  heroSubLinkLabel: "l'export CSV",
  fifoTitle: "Premier entré, premier sorti — valeur par défaut IRS",
  hifoTitle: "Coût le plus élevé, premier sorti — minimise la plus-value imposable",
  lifoTitle: "Dernier entré, premier sorti — privilégié sur les marchés baissiers",
  specIdTitle: "Identification spécifique — choisissez manuellement quel lot vendre",
  hifoActive: "HIFO actif — vente des lots au coût le plus élevé en premier",
  lifoActive: "LIFO actif — vente des lots acquis le plus récemment en premier",
  specIdActive: "Spec ID actif — utilisation de vos affectations de lots épinglées",
  yearLabel: "Année",
  loadError: (year) => `Impossible de charger les données fiscales pour ${year}. Essayez de rafraîchir la page.`,
  unpricedHeading: (count) =>
    `${count} transaction${count !== 1 ? "s" : ""} on-chain ${count !== 1 ? "manquent" : "manque"} de prix historiques en USD.`,
  unpricedBody:
    "La base de coût et les produits peuvent être incomplets. Les prix historiques sont mis à jour automatiquement après chaque synchronisation — revenez bientôt ou déclenchez une re-synchronisation depuis la",
  unpricedWalletsLink: "page des wallets",
  capitalGainsHeading: "Plus-values Réalisées",
  capitalGainsSub: (method) => `Base de coût ${method} · Schedule D`,
  pipelineBadge: "Données du pipeline",
  inMemoryBadge: "FIFO en mémoire",
  shortTermLabel: "Court terme",
  shortTermNote: "(détenu ≤ 1 an)",
  shortTermSub: "imposé comme revenu ordinaire",
  longTermLabel: "Long terme",
  longTermNote: "(détenu > 1 an)",
  longTermSub: "taux 0% / 15% / 20%",
  netRealizedLabel: "Gain net réalisé",
  netRealizedSub: "CT + LT combinés",
  lotCount: (n) => `${n} lot${n !== 1 ? "s" : ""}`,
  gainDivergeHeading: "Le gain/perte du pipeline diverge du calcul affiché",
  gainDivergeSub: (pipeline, displayed, diff) =>
    `Le gain net stocké dans tax_disposals est ${pipeline} mais le total affiché est ${displayed} (différence ${diff}). Relancez le pipeline de classification pour régénérer les lots stockés.`,
  incomeDivergeHeading: "Le total des revenus du pipeline diverge du calcul affiché",
  incomeDivergeSub: (pipeline, displayed, diff) =>
    `Le pipeline de classification indique ${pipeline} mais le total affiché est ${displayed} (différence ${diff}). Relancez le pipeline de classification pour résoudre cela.`,
  pipelineStatus: (status) => `Pipeline ${status}`,
  inProgress: "en cours",
  classified: (n) => `${n.toLocaleString("fr-FR")} classifiées`,
  unknown: (n) => `${n} inconnues`,
  rerunBtn: "Relancer",
  firstRunHeading: "Exécuter le pipeline de classification",
  firstRunSub:
    "Classifiez vos transactions pour une correspondance de lots FIFO précise selon l'IRS, la détection des revenus et la sortie pour Schedule D.",
  runPipelineBtn: "Exécuter le Pipeline",
  stalePipelineHeading: "Les données du pipeline sont peut-être périmées",
  stalePipelineBody: "De nouvelles transactions ont été importées",
  staleDays: (days) => ` il y a ${days} jours`,
  staleHours: (hrs) => ` il y a ${hrs} heure${hrs !== 1 ? "s" : ""}`,
  staleRecent: " récemment",
  staleAfterPipeline:
    "après la dernière exécution du pipeline. Les gains affichés peuvent ne pas refléter vos données les plus récentes.",
  staleLastRun: "Dernière exécution :",
  staleLatestImport: "· Dernière importation :",
  rerunPipelineBtn: "Relancer le Pipeline",
  carryforwardHeading: "Report de Pertes en Capital",
  carryforwardSub: (year) => `Pertes inutilisées des années précédentes pouvant compenser vos gains de ${year}`,
  availableToApply: "disponibles à appliquer",
  carryColYear: "Année",
  carryColNetGain: "Gain / Perte Net(te)",
  carryColDeducted: "Déduit sur Revenus",
  carryColAbsorbed: "Absorbé par le Gain",
  carryColEnding: "Solde Final",
  carryHowTo: (year) =>
    `Comment l'utiliser : Appliquez ce report contre votre gain net de ${year} avant de calculer l'impôt. Jusqu'à 3 000 $ par an peuvent également compenser les revenus ordinaires si votre net reste négatif après application. Votre logiciel fiscal ou CPA le saisira dans le Schedule D.`,
  noCarryforward: (year) =>
    `Vous avez eu des années de pertes dans le passé, mais le solde total a été utilisé — aucun report disponible pour ${year}.`,
  byAssetHeading: "Gain / Perte par Actif",
  byAssetSub: "Cliquez sur n'importe quelle ligne pour voir les lots individuels · triés par impact",
  colAsset: "Actif",
  colStGain: "Gain/Perte CT",
  colStLots: "Lots CT",
  colLtGain: "Gain/Perte LT",
  colLtLots: "Lots LT",
  colNet: "Net",
  colTotal: "Total",
  assetDisposals: (asset, n) => `${asset} · ${n} cession${n !== 1 ? "s" : ""}`,
  csvBtn: "↓ CSV",
  lotColSold: "Vendu",
  lotColQty: "Qté",
  lotColAcquired: "Acquis",
  lotColHeld: "Détenu",
  lotColProceeds: "Produits",
  lotColCostBasis: "Base de Coût",
  lotColGainLoss: "Gain / Perte",
  lotColTerm: "Terme",
  lotSubtotal: "Sous-total",
  termLong: "LT",
  termShort: "CT",
  harvestHeading: "Opportunités de Déduction des Pertes Fiscales",
  harvestSub: "Lots ouverts actuellement en dessous de la base de coût · vendre fixe une perte déductible",
  harvestCount: (n) => `${n} actif${n !== 1 ? "s" : ""} en perte`,
  harvestColAsset: "Actif",
  harvestColQty: "Qté Détenue",
  harvestColCost: "Base de Coût",
  harvestColValue: "Valeur Actuelle",
  harvestColLoss: "Perte Non Réalisée",
  harvestColTerm: "Terme",
  harvestColDaysToLt: "Jours pour LT",
  harvestLtCheck: "✓ LT",
  termMixed: "Mixte",
  harvestNote:
    "Note : Les prix sont des taux spot en direct. Vendre et racheter immédiatement peut entraîner un traitement similaire aux ventes à perte selon les directives de l'IRS pour votre situation. Consultez un professionnel fiscal avant de procéder.",
  missingBasisHeading: "Base de Coût Manquante",
  missingBasisSub: "Ces cessions ont des enregistrements incomplets — les totaux de gains/pertes ci-dessus peuvent être erronés",
  missingBasisCount: (n) => `${n} problème${n !== 1 ? "s" : ""}`,
  missingColAsset: "Actif",
  missingColDisposed: "Cédé",
  missingColQty: "Qté",
  missingColProceeds: "Produits",
  missingColTerm: "Terme",
  missingColProblem: "Problème",
  missingColFix: "Correction",
  termUnknown: "Inconnu",
  issueNoMatchingBuy: "Aucun achat correspondant",
  issueBuyNoPrice: "Achat sans prix",
  fixFindBookkeeping: "Trouver dans la Comptabilité →",
  fixEnterCost: "Saisir le coût manuellement →",
  missingImpact:
    "Impact : « Aucun achat correspondant » signifie que l'IRS peut traiter l'intégralité des produits comme un gain. « Achat sans prix » signifie que la base de coût est supposée à $0, surestimant votre gain imposable. Résolvez ces problèmes dans la Comptabilité avant de vous fier à ces totaux.",
  estimatorHeading: "Estimation du Passif Fiscal",
  estimatorSub: (year, method) => `Basé sur les tranches IRS de ${year} · base de coût ${method} · estimation uniquement`,
  estimatorDisclaimer: "Pas un conseil financier",
  labelFilingStatus: "Situation Fiscale",
  optSingle: "Célibataire",
  optMfj: "Marié(e) déclarant conjointement",
  optMfs: "Marié(e) déclarant séparément",
  optHoh: "Chef de famille",
  labelOtherIncome: "Autres Revenus Imposables (salaires, traitement, etc.)",
  labelState: "État",
  estStFederal: "Fédéral CT",
  estLtFederal: "Fédéral LT",
  estCryptoIncome: "Revenus Crypto",
  estCryptoIncomeSub: "staking / intérêts",
  estNiit: "NIIT (3,8%)",
  estNiitSub: "revenu net d'investissement",
  estStateTax: "Est. Impôt État",
  estMarginalRate: "taux marginal",
  estCapGainsRate: "taux de plus-values",
  estTopMarginal: "taux marginal maximum",
  estTotal: "Estimation Totale",
  estTotalSub: "fédéral + état",
  niitBanner:
    "⚠ L'impôt sur le revenu net d'investissement s'applique. Votre revenu total dépasse le seuil du NIIT. Un taux supplémentaire de 3,8% s'applique à vos gains et revenus crypto en plus des taux ordinaires. Cela est inclus dans l'estimation totale ci-dessus.",
  estimatorFootnote: (year) =>
    `Estimation approximative utilisant les tranches marginales IRS de ${year} + taux marginal maximum de l'état (appliqué uniformément à tous les revenus et gains crypto). Ne tient pas compte des déductions, de l'AMT, du report de pertes en capital, des impôts locaux ni des taux préférentiels spécifiques à chaque état. Les gains à court terme s'accumulent sur vos autres revenus. Si votre retenue à la source ne couvre pas ce montant, vous pourriez devoir des paiements estimatifs trimestriels — consultez votre CPA. Pas un conseil financier.`,
  ordinaryIncomeLabel: "Revenus Ordinaires",
  ordinaryIncomeSub: (count) =>
    `${count} événement${count !== 1 ? "s" : ""} d'intérêts · Schedule 1 / Form 1040`,
  disposalProceedsLabel: "Produits de Cession",
  disposalsSub: (count) => `${count} cession${count !== 1 ? "s" : ""} · produits bruts`,
  forcedLiquidationsLabel: "Liquidations Forcées",
  forcedLiquidationsSub: "Liquidations Aave — traitées comme des ventes imposables",
  incomeByTypeHeading: "Revenus Ordinaires par Type",
  incomeByTypeSub: "Chaque type de revenu correspond à une ligne différente du formulaire IRS",
  incomeByTypeFormRef: "Schedule 1 · Form 1040",
  incomeColType: "Type",
  incomeColIrsLine: "Ligne IRS",
  incomeColEvents: "Événements",
  incomeColTotal: "Revenus Totaux",
  incomeByAssetHeading: "Revenus Ordinaires par Actif",
  incomeByAssetPipeline: "Source : pipeline de classification",
  incomeByAssetLifecycle: "Source : événements du cycle de vie (exécutez le pipeline pour le détail complet)",
  incomeByAssetFormRef: "Schedule 1 · Form 1040",
  incomeColAsset: "Actif",
  unpricedDisposals: (count, year) =>
    `${count} cessions en ${year} ont des prix USD manquants — le total des produits ci-dessus est sous-estimé. Ouvrez la`,
  unpricedDisposalsSingular: (count, year) =>
    `${count} cession en ${year} a un prix USD manquant — le total des produits ci-dessus est sous-estimé. Ouvrez la`,
  unpricedDisposalsLink: "page des transactions",
  noTaxableEvents: (year) => `Aucun événement imposable trouvé pour ${year}.`,
  noTaxableEventsSub: "Si cela vous semble incorrect, vérifiez que vos wallets et importations d'exchanges sont à jour.",
  washSaleHeading: "Suivi des Ventes à Perte (Shadow)",
  washSaleShadowBadge: "Mode Shadow",
  washSaleSubheading:
    "Les cryptomonnaies sont actuellement exemptes des règles de vente à perte (l'IRS les traite comme des biens, pas des valeurs mobilières). Cette analyse montre les pertes qui seraient inadmissibles selon la législation proposée étendant ces règles aux cryptomonnaies. Aucun impôt n'est dû — ceci est uniquement à des fins de planification.",
  washSaleWouldBe: "seraient inadmissibles",
  washColAsset: "Actif",
  washColSaleDate: "Date de Vente",
  washColLoss: "Perte",
  washColTrigger: "Déclenché Par (Rachat)",
  washColWouldDisallow: "Inadmissibles",
  washFootnote:
    "Une vente à perte se produit lorsque vous vendez à perte et rachetez le même actif dans les 30 jours avant ou après. Selon la loi actuelle, les cryptomonnaies sont exemptes. Le Congrès a proposé d'étendre les règles de vente à perte aux actifs numériques dans plusieurs projets de loi — ce suivi vous aide à comprendre votre exposition si cela se produit.",
  defiHeading: "Événements DeFi Signalés pour Révision",
  defiSub: "Ces transactions n'ont pas de directives claires de l'IRS — vérifiez chacune avec votre conseiller fiscal.",
  defiReviewLink: "File de révision →",
  defiColType: "Type d'Événement",
  defiColEvents: "Événements",
  defiColTotal: "Total USD",
  defiColTax: "Considération Fiscale",
  defiLpDeposit: "Peut être un échange imposable au moment du dépôt",
  defiLpWithdrawal: "Peut inclure une plus/moins-value imposable et/ou une perte impermanente",
  defiRebaseIncome: "Probablement revenu ordinaire à la JVM — Schedule 1 Line 8z",
  defiWrappedSwap: "Échange de biens — peut réaliser une plus/moins-value en capital",
  defiFootnote: "Les événements DeFi sont signalés automatiquement par le pipeline de classification. Ouvrez la",
  defiReviewQueueLink: "file de révision",
  yoyHeading: "Plus-values Réalisées d'Année en Année",
  yoySubLabel: "CT + LT net · FIFO",
  yoyAxisLabel: "Gain / (Perte) Net(te) Réalisé(e)",
  exportCtaHeading: "Prêt à exporter ?",
  exportCtaBody:
    "Téléchargez le CSV ligne par ligne avec la classification court/long terme par lot depuis la page des transactions.",
  exportCtaBtn: "Ouvrir les Transactions →",
  pipelineBtnRunning: "⏳ Exécution en cours…",
  pipelineBtnDone: "✓ Terminé — rechargement…",
  pipelineBtnRerun: "Relancer le Pipeline",
  pipelineNetworkError: "Erreur réseau — impossible de joindre le serveur. Veuillez réessayer.",
};

const MAP: Record<Lang, GainsLocale> = { en, es, fr };

/** Select the Gains Summary locale for a language, falling back to English. */
export function getGains(lang: Lang): GainsLocale {
  return MAP[lang] ?? en;
}
