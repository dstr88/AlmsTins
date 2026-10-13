// Tax page — finance terminology (Form 1099, cost basis, proceeds…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// 1099 Reconciliation page — page-level strings (EN · ES · FR).
//
// NOT translated per design.claude.md: US tax form names (1099, 1099-DA, 1099-B,
// Form 8949), crypto tickers, exchange names (Coinbase, Kraken…), $, code.
// Financial concept words (proceeds, cost basis, gain, loss) ARE translated (first-pass).

import type { Lang } from '@/lib/i18n/locale';

export interface T1099Locale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  heroTitle: string;
  heroSub: string;
  uploadCardTitle: string;
  labelFormType: string;
  labelTaxYear: string;
  labelExchange: string;
  labelExchangeOptional: string;
  exchangePlaceholder: string;
  dropPrimary: string;
  dropSecondary: string;
  dropBrowse: string;
  uploadBtn: string;
  resultsTitle: string;
  /** e.g. "5 assets compared" */
  resultsSubtitle: (n: number) => string;
  /** e.g. "3 matched" */
  countMatched: (n: number) => string;
  /** e.g. "2 differences" */
  countDiff: (n: number) => string;
  /** e.g. "1 unmatched" */
  countUnmatched: (n: number) => string;
  tableAsset: string;
  /** "1099 Proceeds" — "1099" stays English */
  tableFormProceeds: string;
  /** "1099 Basis" */
  tableFormBasis: string;
  tableAlmstinsProceeds: string;
  tableAlmstinsBasis: string;
  tableDeltaProceeds: string;
  tableDeltaBasis: string;
  tableStatus: string;
  guidanceTitle: string;
  /** Full <li> innerHTML including the <strong> label — use set:html */
  guidanceMatched: string;
  guidanceProceedsDiff: string;
  guidanceBasisDiff: string;
  guidanceUnmatched: string;
  historyCardTitle: string;
  historyLoading: string;
  historyEmpty: string;
  /** "N rows · Uploaded {date}" */
  historyRowCount: (n: number | null) => string;
  historyViewLink: string;
  pleaseSelectFile: string;
  uploading: string;
  /** "✅ N rows processed" */
  rowsProcessed: (n: number) => string;
  uploadFailed: string;
  networkError: string;
  /** Status badge labels used in the JS table renderer */
  statusMatched: string;
  statusProceedsDiff: string;
  statusBasisDiff: string;
  statusUnmatched: string;
  statusExtra: string;
  /** "Uploaded" label in history meta line */
  uploaded: string;
  /** "rows" label in history meta line */
  rows: string;
}

export const en: T1099Locale = {
  lang: 'en',
  pageTitle: '1099 Reconciliation | Almstins',
  backLink: '← Summary',
  heroTitle: '1099 Reconciliation',
  heroSub:
    'Upload a 1099-DA or 1099-B CSV from your exchange and compare it line-by-line against what Almstins calculated. Catch discrepancies early.',
  uploadCardTitle: 'Upload New Form',
  labelFormType: 'Form type',
  labelTaxYear: 'Tax year',
  labelExchange: 'Exchange',
  labelExchangeOptional: '(optional)',
  exchangePlaceholder: 'e.g. Coinbase, Kraken…',
  dropPrimary: 'Drag & drop your CSV or PDF here',
  dropSecondary: 'or',
  dropBrowse: 'browse files',
  uploadBtn: 'Upload & Reconcile',
  resultsTitle: 'Reconciliation Complete',
  resultsSubtitle: (n) => `${n} asset${n !== 1 ? 's' : ''} compared`,
  countMatched: (n) => `${n} matched`,
  countDiff: (n) => `${n} difference${n !== 1 ? 's' : ''}`,
  countUnmatched: (n) => `${n} unmatched`,
  tableAsset: 'Asset',
  tableFormProceeds: '1099 Proceeds',
  tableFormBasis: '1099 Basis',
  tableAlmstinsProceeds: 'Almstins Proceeds',
  tableAlmstinsBasis: 'Almstins Basis',
  tableDeltaProceeds: 'Δ Proceeds',
  tableDeltaBasis: 'Δ Basis',
  tableStatus: 'Status',
  guidanceTitle: 'How to read this',
  guidanceMatched: '<strong>Matched</strong> — Almstins and the exchange agree within $1.',
  guidanceProceedsDiff:
    '<strong>Proceeds diff</strong> — The exchange reported different proceeds. Check for missing trades in Almstins.',
  guidanceBasisDiff:
    '<strong>Basis diff</strong> — Cost basis differs. May indicate wash-sale adjustments or missing import data.',
  guidanceUnmatched:
    '<strong>Unmatched</strong> — The exchange reported an asset Almstins has no record of. Import the missing data.',
  historyCardTitle: 'Previous Uploads',
  historyLoading: 'Loading…',
  historyEmpty: 'No uploads yet.',
  historyRowCount: (n) => `${n ?? '?'} rows`,
  historyViewLink: 'View →',
  pleaseSelectFile: 'Please select a file.',
  uploading: '⏳ Uploading and reconciling…',
  rowsProcessed: (n) => `✅ ${n} rows processed`,
  uploadFailed: 'Upload failed',
  networkError: 'Network error',
  statusMatched: '✓ Matched',
  statusProceedsDiff: 'Δ Proceeds',
  statusBasisDiff: 'Δ Basis',
  statusUnmatched: '! Unmatched',
  statusExtra: 'Extra',
  uploaded: 'Uploaded',
  rows: 'rows',
};

export const es: T1099Locale = {
  lang: 'es',
  pageTitle: 'Conciliación 1099 | Almstins',
  backLink: '← Resumen',
  heroTitle: 'Conciliación 1099',
  heroSub:
    'Sube un CSV de 1099-DA o 1099-B de tu exchange y compáralo línea por línea con lo que calculó Almstins. Detecta discrepancias a tiempo.',
  uploadCardTitle: 'Subir nuevo formulario',
  labelFormType: 'Tipo de formulario',
  labelTaxYear: 'Año fiscal',
  labelExchange: 'Exchange',
  labelExchangeOptional: '(opcional)',
  exchangePlaceholder: 'p. ej. Coinbase, Kraken…',
  dropPrimary: 'Arrastra y suelta tu CSV o PDF aquí',
  dropSecondary: 'o',
  dropBrowse: 'buscar archivos',
  uploadBtn: 'Subir y conciliar',
  resultsTitle: 'Conciliación completada',
  resultsSubtitle: (n) => `${n} activo${n !== 1 ? 's' : ''} comparado${n !== 1 ? 's' : ''}`,
  countMatched: (n) => `${n} coincidente${n !== 1 ? 's' : ''}`,
  countDiff: (n) => `${n} diferencia${n !== 1 ? 's' : ''}`,
  countUnmatched: (n) => `${n} sin coincidencia`,
  tableAsset: 'Activo',
  tableFormProceeds: '1099 Ingresos',
  tableFormBasis: '1099 Base de coste',
  tableAlmstinsProceeds: 'Almstins Ingresos',
  tableAlmstinsBasis: 'Almstins Base de coste',
  tableDeltaProceeds: 'Δ Ingresos',
  tableDeltaBasis: 'Δ Base de coste',
  tableStatus: 'Estado',
  guidanceTitle: 'Cómo interpretar esto',
  guidanceMatched: '<strong>Coincidente</strong> — Almstins y el exchange coinciden dentro de $1.',
  guidanceProceedsDiff:
    '<strong>Diferencia en ingresos</strong> — El exchange reportó ingresos distintos. Verifica si faltan operaciones en Almstins.',
  guidanceBasisDiff:
    '<strong>Diferencia en base de coste</strong> — La base de coste difiere. Puede indicar ajustes por wash-sale o datos de importación faltantes.',
  guidanceUnmatched:
    '<strong>Sin coincidencia</strong> — El exchange reportó un activo del que Almstins no tiene registro. Importa los datos faltantes.',
  historyCardTitle: 'Subidas anteriores',
  historyLoading: 'Cargando…',
  historyEmpty: 'Aún no hay subidas.',
  historyRowCount: (n) => `${n ?? '?'} filas`,
  historyViewLink: 'Ver →',
  pleaseSelectFile: 'Por favor selecciona un archivo.',
  uploading: '⏳ Subiendo y conciliando…',
  rowsProcessed: (n) => `✅ ${n} filas procesadas`,
  uploadFailed: 'La subida falló',
  networkError: 'Error de red',
  statusMatched: '✓ Coincidente',
  statusProceedsDiff: 'Δ Ingresos',
  statusBasisDiff: 'Δ Base de coste',
  statusUnmatched: '! Sin coincidencia',
  statusExtra: 'Extra',
  uploaded: 'Subido',
  rows: 'filas',
};

export const fr: T1099Locale = {
  lang: 'fr',
  pageTitle: 'Rapprochement 1099 | Almstins',
  backLink: '← Résumé',
  heroTitle: 'Rapprochement 1099',
  heroSub:
    "Importez un CSV 1099-DA ou 1099-B de votre exchange et comparez-le ligne par ligne avec les calculs d'Almstins. Détectez les écarts tôt.",
  uploadCardTitle: 'Importer un nouveau formulaire',
  labelFormType: 'Type de formulaire',
  labelTaxYear: 'Année fiscale',
  labelExchange: 'Exchange',
  labelExchangeOptional: '(facultatif)',
  exchangePlaceholder: 'ex. Coinbase, Kraken…',
  dropPrimary: 'Glissez-déposez votre CSV ou PDF ici',
  dropSecondary: 'ou',
  dropBrowse: 'parcourir les fichiers',
  uploadBtn: 'Importer et rapprocher',
  resultsTitle: 'Rapprochement terminé',
  resultsSubtitle: (n) => `${n} actif${n !== 1 ? 's' : ''} comparé${n !== 1 ? 's' : ''}`,
  countMatched: (n) => `${n} correspondance${n !== 1 ? 's' : ''}`,
  countDiff: (n) => `${n} différence${n !== 1 ? 's' : ''}`,
  countUnmatched: (n) => `${n} sans correspondance`,
  tableAsset: 'Actif',
  tableFormProceeds: '1099 Produits',
  tableFormBasis: '1099 Coût de base',
  tableAlmstinsProceeds: 'Almstins Produits',
  tableAlmstinsBasis: 'Almstins Coût de base',
  tableDeltaProceeds: 'Δ Produits',
  tableDeltaBasis: 'Δ Coût de base',
  tableStatus: 'Statut',
  guidanceTitle: 'Comment lire ceci',
  guidanceMatched: "<strong>Correspondance</strong> — Almstins et l'exchange s'accordent à $1 près.",
  guidanceProceedsDiff:
    "<strong>Écart de produits</strong> — L'exchange a déclaré des produits différents. Vérifiez les transactions manquantes dans Almstins.",
  guidanceBasisDiff:
    "<strong>Écart de coût de base</strong> — Le coût de base diffère. Peut indiquer des ajustements wash-sale ou des données d'importation manquantes.",
  guidanceUnmatched:
    "<strong>Sans correspondance</strong> — L'exchange a déclaré un actif qu'Almstins ne connaît pas. Importez les données manquantes.",
  historyCardTitle: 'Importations précédentes',
  historyLoading: 'Chargement…',
  historyEmpty: "Aucune importation pour l'instant.",
  historyRowCount: (n) => `${n ?? '?'} lignes`,
  historyViewLink: 'Voir →',
  pleaseSelectFile: 'Veuillez sélectionner un fichier.',
  uploading: '⏳ Importation et rapprochement…',
  rowsProcessed: (n) => `✅ ${n} lignes traitées`,
  uploadFailed: "L'importation a échoué",
  networkError: 'Erreur réseau',
  statusMatched: '✓ Correspondance',
  statusProceedsDiff: 'Δ Produits',
  statusBasisDiff: 'Δ Coût de base',
  statusUnmatched: '! Sans correspondance',
  statusExtra: 'Extra',
  uploaded: 'Importé le',
  rows: 'lignes',
};

const MAP: Record<Lang, T1099Locale> = { en, es, fr };

/** Select the 1099 Reconciliation locale for a language, falling back to English. */
export function get1099(lang: Lang): T1099Locale {
  return MAP[lang] ?? en;
}
