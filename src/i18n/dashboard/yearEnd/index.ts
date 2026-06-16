// Tax page — finance terminology (Form 8949, Schedule D, cost basis, gains…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Tax Center hub page — page-level strings (EN · ES · FR).
//
// Cookie-based: yearEnd/index.astro reads getLang(Astro.request) and selects
// via getYearEnd(lang). These are the strings the PAGE owns — section labels,
// card titles, card descriptions, doc tile labels, year pills, and the
// disclaimer. Child components (CompletenessScore) carry their own text.
//
// DO NOT translate: US tax form names (Form 8949, Schedule D, 1099, 1099-DA,
// 1099-B), tickers, product/company names, $, %, or code. Financial CONCEPT
// words (gains, losses, cost basis, holding period, short-term, long-term) ARE
// translatable — first-pass only.

import type { Lang } from '@/lib/i18n/locale';

export interface YearEndLocale {
  lang: Lang;
  pageTitle: string;
  hubTitle: string;
  hubSub: string;
  // Quick-access section
  docSectionLabel: string;
  docGainsSummary: string;
  docYearSummary: string;
  // Data completeness
  completenessLabel: string;
  // Analysis & Planning
  analysisSectionLabel: string;
  gainsSummaryTitle: string;
  gainsSummaryDesc: string;
  yearReportTitle: string;
  yearReportDesc: string;
  reviewQueueTitle: string;
  reviewQueueDesc: string;
  // US Summaries
  usSummariesLabel: string;
  usSummariesNote: string;
  capitalGainsSummaryTitle: string;
  capitalGainsSummaryDesc: string;
  capitalGainsLossesTitle: string;
  capitalGainsLossesDesc: string;
  lotManagerTitle: string;
  lotManagerDesc: string;
  // 1099 Reconciliation
  reconciliationLabel: string;
  recon1099Title: string;
  recon1099Desc: string;
  // Export
  exportLabel: string;
  yearSummaryPdfTitle: string;
  yearSummaryPdfDesc: string;
  fifoCsvTitle: string;
  fifoCsvDesc: string;
  // Prior tax years
  priorYearsLabel: string;
  /** "YYYY Report" year pill label */
  yearPillLabel: (year: number) => string;
  yearPillNote: string;
  // Disclaimer
  disclaimerStrong: string;
  disclaimerText: string;
}

export const en: YearEndLocale = {
  lang: 'en',
  pageTitle: 'Tax Center | Almstins',
  hubTitle: 'Tax Center',
  hubSub:
    'All your crypto tax tools in one place. Not a tax preparation service — always consult a CPA before filing.',
  docSectionLabel: 'TurboTax Documents',
  docGainsSummary: 'Gains Summary',
  docYearSummary: 'Year Summary',
  completenessLabel: 'Data Completeness',
  analysisSectionLabel: 'Analysis & Planning',
  gainsSummaryTitle: 'Gains Summary',
  gainsSummaryDesc:
    'Short-term vs long-term gains, per-asset breakdown, tax-loss harvesting opportunities, missing cost basis alerts, estimated liability, loss carryforward, and year-over-year chart.',
  yearReportTitle: 'Year Summary Report',
  yearReportDesc:
    'Full disposal history with capital gains, ordinary income, loan events, and interest paid. Download as HTML or Form 8949–style CSV.',
  reviewQueueTitle: 'Review Queue',
  reviewQueueDesc:
    "Transactions the classifier couldn't categorize automatically. Resolve them here before they affect your report totals.",
  usSummariesLabel: 'US Summaries',
  usSummariesNote: '(informational — not filing documents)',
  capitalGainsSummaryTitle: 'Capital Gains Summary',
  capitalGainsSummaryDesc:
    'Per-lot realized gains and losses, formatted to mirror IRS Form 8949 for reference, sorted by short-term and long-term. Print or CSV. Informational — not a filing document.',
  capitalGainsLossesTitle: 'Capital Gains & Losses Summary',
  capitalGainsLossesDesc:
    'Totals laid out in the US Schedule D line-by-line format for reference. Flows from the same realized-gains math. Informational — not a filing document.',
  lotManagerTitle: 'Lot Manager — Specific ID',
  lotManagerDesc:
    'Manually pin each disposal to a specific cost-basis lot. When Spec ID method is active, these pins override FIFO/HIFO/LIFO — the lowest-tax outcome in any scenario.',
  reconciliationLabel: 'Reconciliation',
  recon1099Title: '1099 Reconciliation',
  recon1099Desc:
    'Upload a 1099-DA or 1099-B CSV from your exchange and compare it against Almstins\' computed gains. Quickly spot discrepancies early.',
  exportLabel: 'Export',
  yearSummaryPdfTitle: 'Year Summary PDF',
  yearSummaryPdfDesc:
    'Landscape PDF with cover page, summary totals, short-term disposals, long-term disposals, income events, and open lots. Premium plan required.',
  fifoCsvTitle: 'FIFO CSV Export',
  fifoCsvDesc:
    'Download the line-by-line gain/loss CSV from the transactions page. Includes short-term vs long-term classification per lot — the format your CPA or tax software needs.',
  priorYearsLabel: 'Prior Tax Years',
  yearPillLabel: (year) => `${year} Report`,
  yearPillNote: 'Opens the Year Summary Report filtered to that tax year.',
  disclaimerStrong: 'Disclaimer:',
  disclaimerText:
    'Almstins is a record-keeping and analysis tool, not a tax preparation service. The information here is based on the transaction data you have provided and may be incomplete if imports are missing or wallets are unsynced. Nothing on this page constitutes tax, legal, or financial advice. Consult a qualified CPA or tax professional before filing.',
};

export const es: YearEndLocale = {
  lang: 'es',
  pageTitle: 'Centro Fiscal | Almstins',
  hubTitle: 'Centro Fiscal',
  hubSub:
    'Todas tus herramientas fiscales de criptomonedas en un solo lugar. No es un servicio de preparación de impuestos — consulta siempre a un CPA antes de presentar tu declaración.',
  docSectionLabel: 'Documentos TurboTax',
  docGainsSummary: 'Resumen de Ganancias',
  docYearSummary: 'Resumen Anual',
  completenessLabel: 'Completitud de Datos',
  analysisSectionLabel: 'Análisis y Planificación',
  gainsSummaryTitle: 'Resumen de Ganancias',
  gainsSummaryDesc:
    'Ganancias a corto y largo plazo, desglose por activo, oportunidades de compensación de pérdidas fiscales, alertas de base de costo faltante, pasivo estimado, arrastre de pérdidas y gráfico interanual.',
  yearReportTitle: 'Informe Anual',
  yearReportDesc:
    'Historial completo de disposiciones con ganancias de capital, ingresos ordinarios, eventos de préstamo e intereses pagados. Descarga en formato HTML o CSV estilo Form 8949.',
  reviewQueueTitle: 'Cola de Revisión',
  reviewQueueDesc:
    'Transacciones que el clasificador no pudo categorizar automáticamente. Resuélvelas aquí antes de que afecten los totales de tu informe.',
  usSummariesLabel: 'Resúmenes de EE. UU.',
  usSummariesNote: '(informativo — no son documentos de presentación)',
  capitalGainsSummaryTitle: 'Resumen de Ganancias de Capital',
  capitalGainsSummaryDesc:
    'Ganancias y pérdidas realizadas por lote, formateadas según el IRS Form 8949 para referencia, ordenadas por corto y largo plazo. Imprime o descarga en CSV. Informativo — no es un documento de presentación.',
  capitalGainsLossesTitle: 'Resumen de Ganancias y Pérdidas de Capital',
  capitalGainsLossesDesc:
    'Totales presentados en el formato línea por línea del Schedule D de EE. UU. para referencia. Deriva de los mismos cálculos de ganancias realizadas. Informativo — no es un documento de presentación.',
  lotManagerTitle: 'Gestor de Lotes — Identificación Específica',
  lotManagerDesc:
    'Asigna manualmente cada disposición a un lote de base de costo específico. Cuando el método Spec ID está activo, estas asignaciones reemplazan a FIFO/HIFO/LIFO — el resultado de menor carga fiscal en cualquier escenario.',
  reconciliationLabel: 'Conciliación',
  recon1099Title: 'Conciliación 1099',
  recon1099Desc:
    'Sube un CSV 1099-DA o 1099-B de tu exchange y compáralo con las ganancias calculadas por Almstins. Detecta discrepancias fácilmente y con anticipación.',
  exportLabel: 'Exportar',
  yearSummaryPdfTitle: 'PDF Resumen Anual',
  yearSummaryPdfDesc:
    'PDF horizontal con portada, totales de resumen, disposiciones a corto plazo, disposiciones a largo plazo, eventos de ingresos y lotes abiertos. Requiere plan premium.',
  fifoCsvTitle: 'Exportación CSV FIFO',
  fifoCsvDesc:
    'Descarga el CSV de ganancias/pérdidas línea por línea desde la página de transacciones. Incluye la clasificación a corto y largo plazo por lote — el formato que necesita tu CPA o software fiscal.',
  priorYearsLabel: 'Años Fiscales Anteriores',
  yearPillLabel: (year) => `Informe ${year}`,
  yearPillNote: 'Abre el Informe Anual filtrado por ese año fiscal.',
  disclaimerStrong: 'Aviso legal:',
  disclaimerText:
    'Almstins es una herramienta de registro y análisis, no un servicio de preparación de impuestos. La información aquí se basa en los datos de transacciones que has proporcionado y puede estar incompleta si faltan importaciones o las wallets no están sincronizadas. Nada en esta página constituye asesoramiento fiscal, legal o financiero. Consulta a un CPA o profesional fiscal calificado antes de presentar tu declaración.',
};

export const fr: YearEndLocale = {
  lang: 'fr',
  pageTitle: 'Centre Fiscal | Almstins',
  hubTitle: 'Centre Fiscal',
  hubSub:
    'Tous vos outils fiscaux crypto en un seul endroit. Pas un service de préparation fiscale — consultez toujours un CPA avant de déposer votre déclaration.',
  docSectionLabel: 'Documents TurboTax',
  docGainsSummary: 'Récapitulatif des Plus-values',
  docYearSummary: 'Récapitulatif Annuel',
  completenessLabel: 'Complétude des Données',
  analysisSectionLabel: 'Analyse et Planification',
  gainsSummaryTitle: 'Récapitulatif des Plus-values',
  gainsSummaryDesc:
    'Plus-values à court et long terme, ventilation par actif, opportunités de déduction des pertes fiscales, alertes de coût de base manquant, passif estimé, report de pertes et graphique annuel comparatif.',
  yearReportTitle: 'Rapport Annuel',
  yearReportDesc:
    'Historique complet des cessions avec plus-values, revenus ordinaires, événements de prêt et intérêts payés. Téléchargez en HTML ou CSV au format Form 8949.',
  reviewQueueTitle: 'File de Révision',
  reviewQueueDesc:
    "Transactions que le classificateur n'a pas pu catégoriser automatiquement. Résolvez-les ici avant qu'elles n'affectent les totaux de votre rapport.",
  usSummariesLabel: 'Récapitulatifs US',
  usSummariesNote: '(informatif — pas des documents de dépôt)',
  capitalGainsSummaryTitle: 'Récapitulatif des Plus-values',
  capitalGainsSummaryDesc:
    'Plus-values et pertes réalisées par lot, formatées selon le IRS Form 8949 pour référence, triées par court et long terme. Impression ou CSV. Informatif — pas un document de dépôt.',
  capitalGainsLossesTitle: 'Récapitulatif des Plus-values et Moins-values',
  capitalGainsLossesDesc:
    'Totaux présentés dans le format ligne par ligne du Schedule D américain pour référence. Calculés à partir des mêmes données de gains réalisés. Informatif — pas un document de dépôt.',
  lotManagerTitle: 'Gestionnaire de Lots — Identification Spécifique',
  lotManagerDesc:
    "Associez manuellement chaque cession à un lot de coût de base spécifique. Lorsque la méthode Spec ID est active, ces associations remplacent FIFO/HIFO/LIFO — le résultat à moindre fiscalité dans tout scénario.",
  reconciliationLabel: 'Rapprochement',
  recon1099Title: 'Rapprochement 1099',
  recon1099Desc:
    "Importez un CSV 1099-DA ou 1099-B de votre exchange et comparez-le aux gains calculés par Almstins. Repérez rapidement les écarts en avance.",
  exportLabel: 'Exporter',
  yearSummaryPdfTitle: 'PDF Récapitulatif Annuel',
  yearSummaryPdfDesc:
    'PDF paysage avec page de couverture, totaux récapitulatifs, cessions à court terme, cessions à long terme, événements de revenus et lots ouverts. Plan premium requis.',
  fifoCsvTitle: 'Export CSV FIFO',
  fifoCsvDesc:
    "Téléchargez le CSV de gains/pertes ligne par ligne depuis la page des transactions. Inclut la classification à court et long terme par lot — le format dont votre CPA ou logiciel fiscal a besoin.",
  priorYearsLabel: 'Années Fiscales Précédentes',
  yearPillLabel: (year) => `Rapport ${year}`,
  yearPillNote: "Ouvre le Rapport Annuel filtré sur cette année fiscale.",
  disclaimerStrong: 'Avertissement :',
  disclaimerText:
    "Almstins est un outil de tenue de registres et d'analyse, pas un service de préparation fiscale. Les informations ici sont basées sur les données de transactions que vous avez fournies et peuvent être incomplètes si des importations manquent ou si des wallets ne sont pas synchronisées. Rien sur cette page ne constitue un conseil fiscal, juridique ou financier. Consultez un CPA ou un professionnel fiscal qualifié avant de déposer votre déclaration.",
};

const MAP: Record<Lang, YearEndLocale> = { en, es, fr };

/** Select the YearEnd locale for a language, falling back to English. */
export function getYearEnd(lang: Lang): YearEndLocale {
  return MAP[lang] ?? en;
}
