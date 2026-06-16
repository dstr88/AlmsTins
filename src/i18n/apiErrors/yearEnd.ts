import type { Lang } from '@/lib/i18n/locale';

export interface YearEndErrorsLocale {
  lang: Lang;

  // Shared — year validation
  invalidYear: string;
  invalidTaxYear: string;

  // summary.ts
  unableToBuildSummary: string;

  // review/resolve.ts
  missingRequiredFields: string;
  reviewItemNotFound: string;
  failedToSave: string;

  // 1099/upload.ts
  noFileProvided: string;
  fileTooLarge10mb: string;
  couldNotReadPdf: string;
  noTransactionsInPdf: string;
  failedToParseCsv: string;
  noRowsInCsv: string;
  couldNotReadFile: string;

  // documents/index.ts
  invalidDocumentType: string;
  fileTooLarge5mb: string;

  // documents/[id].ts  &  1099/reconciliation.ts
  notFound: string;
  uploadNotFound: string;
}

// ── English ───────────────────────────────────────────────────────────────────
const en: YearEndErrorsLocale = {
  lang: 'en',

  invalidYear:              'Invalid year',
  invalidTaxYear:           'Invalid tax year',

  unableToBuildSummary:     'Unable to build tax summary.',

  missingRequiredFields:    'Missing required fields.',
  reviewItemNotFound:       'Review item not found.',
  failedToSave:             'Failed to save.',

  noFileProvided:           'No file provided',
  fileTooLarge10mb:         'File too large (max 10 MB)',
  couldNotReadPdf:          'Could not read PDF. Make sure it is a valid 1099-DA or 1099-B form.',
  noTransactionsInPdf:      'No transactions found in this PDF. Only Form 1099-DA PDFs are supported — try a CSV export if available.',
  failedToParseCsv:         'Failed to parse CSV',
  noRowsInCsv:              'No data rows found in CSV. Check that this is a valid 1099-DA/B file.',
  couldNotReadFile:         'Could not read file',

  invalidDocumentType:      'Invalid document type',
  fileTooLarge5mb:          'File too large (max 5 MB)',

  notFound:                 'Not found',
  uploadNotFound:           'Not found',
};

// ── Spanish ───────────────────────────────────────────────────────────────────
const es: YearEndErrorsLocale = {
  lang: 'es',

  invalidYear:              "Año no válido",
  invalidTaxYear:           "Año fiscal no válido",

  unableToBuildSummary:     "No se pudo generar el resumen fiscal.",

  missingRequiredFields:    "Faltan campos obligatorios.",
  reviewItemNotFound:       "Elemento de revisión no encontrado.",
  failedToSave:             "Error al guardar.",

  noFileProvided:           "No se proporcionó ningún archivo",
  fileTooLarge10mb:         "Archivo demasiado grande (máx. 10 MB)",
  couldNotReadPdf:          "No se pudo leer el PDF. Asegúrate de que sea un formulario 1099-DA o 1099-B válido.",
  noTransactionsInPdf:      "No se encontraron transacciones en este PDF. Solo se admiten formularios 1099-DA en PDF; prueba a exportar en CSV si está disponible.",
  failedToParseCsv:         "Error al procesar el archivo CSV",
  noRowsInCsv:              "No se encontraron filas de datos en el CSV. Comprueba que sea un archivo 1099-DA/B válido.",
  couldNotReadFile:         "No se pudo leer el archivo",

  invalidDocumentType:      "Tipo de documento no válido",
  fileTooLarge5mb:          "Archivo demasiado grande (máx. 5 MB)",

  notFound:                 "No encontrado",
  uploadNotFound:           "No encontrado",
};

// ── French ────────────────────────────────────────────────────────────────────
const fr: YearEndErrorsLocale = {
  lang: 'fr',

  invalidYear:              "Année invalide",
  invalidTaxYear:           "Année fiscale invalide",

  unableToBuildSummary:     "Impossible de générer le récapitulatif fiscal.",

  missingRequiredFields:    "Champs obligatoires manquants.",
  reviewItemNotFound:       "Élément de révision introuvable.",
  failedToSave:             "Échec de l'enregistrement.",

  noFileProvided:           "Aucun fichier fourni",
  fileTooLarge10mb:         "Fichier trop volumineux (max 10 Mo)",
  couldNotReadPdf:          "Impossible de lire le PDF. Vérifiez qu'il s'agit d'un formulaire 1099-DA ou 1099-B valide.",
  noTransactionsInPdf:      "Aucune transaction trouvée dans ce PDF. Seuls les formulaires 1099-DA en PDF sont pris en charge — essayez un export CSV si disponible.",
  failedToParseCsv:         "Échec du traitement du fichier CSV",
  noRowsInCsv:              "Aucune ligne de données trouvée dans le CSV. Vérifiez qu'il s'agit d'un fichier 1099-DA/B valide.",
  couldNotReadFile:         "Impossible de lire le fichier",

  invalidDocumentType:      "Type de document invalide",
  fileTooLarge5mb:          "Fichier trop volumineux (max 5 Mo)",

  notFound:                 "Introuvable",
  uploadNotFound:           "Introuvable",
};

// ── Lookup ────────────────────────────────────────────────────────────────────
const MAP: Record<Lang, YearEndErrorsLocale> = { en, es, fr };

export function getYearEndErrors(lang: Lang): YearEndErrorsLocale {
  return MAP[lang] ?? en;
}
