// SmartImport component — EN · ES · FR.
//
// Covers: drop-zone label, browse button, toast messages, result-row
// status/progress/error messages (including interpolated variants).
//
// NOT translated: exchange/source names (Coinbase, Kraken, Crypto.com, etc.),
// file extensions (.csv, .zip), crypto tickers, className, data attributes,
// console.log output, API enum values.

import type { Lang } from '@/lib/i18n/locale';

export interface SmartImportLocale {
  // Drop zone markup
  dropLabel: string;
  browseFiles: string;

  // Drop error (unsupported file type)
  errorUnsupportedType: string;

  // Result row / toast — processing states
  detectingExchange: string;
  /** Interpolated: call uploadingFile(filename) */
  uploadingFile: (filename: string) => string;

  // Detection result
  unknownFormat: string;
  /** Interpolated: call detectedImporting(name) */
  detectedImporting: (name: string) => string;
  /** Interpolated: call detectedToast(name) */
  detectedToast: (name: string) => string;

  // Import error fallback
  /** Interpolated: call importFailed(status) */
  importFailed: (status: number | string) => string;

  // Success
  /** Interpolated: call dupesSkipped(count) */
  dupesSkipped: (count: number | string) => string;
  /** Interpolated: call importSuccess(name, inserted, skipped) — skipped is already-formatted string or '' */
  importSuccess: (name: string, inserted: number | string, skipped: string) => string;

  // Catch-all error
  /** Interpolated: call unexpectedError(message) */
  unexpectedError: (message: string) => string;
}

export const en: SmartImportLocale = {
  dropLabel: 'Drop any exchange CSV here',
  browseFiles: 'Browse files',

  errorUnsupportedType: 'Not a supported file type. Drop a CSV or ZIP export from a supported exchange.',

  detectingExchange: 'Detecting exchange…',
  uploadingFile: (filename) => `Uploading ${filename}…`,

  unknownFormat: 'Unknown format',
  detectedImporting: (name) => `Detected: ${name} — importing…`,
  detectedToast: (name) => `${name} detected — importing…`,

  importFailed: (status) => `Import failed (${status})`,

  dupesSkipped: (count) => ` · ${count} dupes skipped`,
  importSuccess: (name, inserted, skipped) => `${name} — ${inserted} rows imported${skipped}`,

  unexpectedError: (message) => `Unexpected error: ${message}`,
};

export const es: SmartImportLocale = {
  dropLabel: "Suelta cualquier CSV de exchange aqui",
  browseFiles: "Examinar archivos",

  errorUnsupportedType: "Tipo de archivo no compatible. Suelta un CSV o ZIP de un exchange compatible.",

  detectingExchange: "Detectando exchange…",
  uploadingFile: (filename) => `Subiendo ${filename}…`,

  unknownFormat: "Formato desconocido",
  detectedImporting: (name) => `Detectado: ${name} — importando…`,
  detectedToast: (name) => `${name} detectado — importando…`,

  importFailed: (status) => `Error al importar (${status})`,

  dupesSkipped: (count) => ` · ${count} duplicados omitidos`,
  importSuccess: (name, inserted, skipped) => `${name} — ${inserted} filas importadas${skipped}`,

  unexpectedError: (message) => `Error inesperado: ${message}`,
};

export const fr: SmartImportLocale = {
  dropLabel: "Deposez ici le CSV de n'importe quel exchange",
  browseFiles: "Parcourir les fichiers",

  errorUnsupportedType: "Type de fichier non pris en charge. Deposez un export CSV ou ZIP d'un exchange compatible.",

  detectingExchange: "Detection de l'exchange…",
  uploadingFile: (filename) => `Telechargement de ${filename}…`,

  unknownFormat: "Format inconnu",
  detectedImporting: (name) => `Detecte : ${name} — importation…`,
  detectedToast: (name) => `${name} detecte — importation…`,

  importFailed: (status) => `Echec de l'importation (${status})`,

  dupesSkipped: (count) => ` · ${count} doublons ignores`,
  importSuccess: (name, inserted, skipped) => `${name} — ${inserted} lignes importees${skipped}`,

  unexpectedError: (message) => `Erreur inattendue : ${message}`,
};

const MAP: Record<Lang, SmartImportLocale> = { en, es, fr };

export function getSmartImport(lang: Lang): SmartImportLocale {
  return MAP[lang] ?? en;
}
