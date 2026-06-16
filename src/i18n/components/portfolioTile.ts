// PortfolioTile (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface PortfolioTileLocale {
  lang: Lang;
  importScreenshotAriaLabel: string;
  importScreenshotParsing: string;
  importScreenshot: string;
  syncAllAriaLabel: string;
  syncingSyncing: string;
  syncTins: string;
  uploadFailed: string;
  alreadyImported: string;
  marketValue: string;
  loading: string;
  noWalletBalances: string;
  syncedAccounts: (count: number) => string;
  syncFailed: (names: string[]) => string;
  syncFailedCount: (count: number) => string;
  aaveDebtNote: (amount: string) => string;
}

export const en: PortfolioTileLocale = {
  lang: 'en',
  importScreenshotAriaLabel: 'Import transaction screenshot',
  importScreenshotParsing: 'Parsing…',
  importScreenshot: 'Import Screenshot',
  syncAllAriaLabel: 'Sync all tins',
  syncingSyncing: 'Syncing…',
  syncTins: 'Sync Tins',
  uploadFailed: 'Upload failed.',
  alreadyImported: 'Already imported (duplicate).',
  marketValue: 'Market Value',
  loading: 'Loading…',
  noWalletBalances: 'No wallet balances found.',
  syncedAccounts: (count) => `Synced ${count} account${count !== 1 ? 's' : ''}`,
  syncFailed: (names) => `Failed: ${names.join(', ')}`,
  syncFailedCount: (count) => `${count} account${count !== 1 ? 's' : ''} failed`,
  aaveDebtNote: (amount) => `${amount} Aave debt not reflected above`,
};

export const es: PortfolioTileLocale = {
  lang: 'es',
  importScreenshotAriaLabel: "Importar captura de transacción",
  importScreenshotParsing: "Procesando…",
  importScreenshot: "Importar captura",
  syncAllAriaLabel: "Sincronizar todos los tins",
  syncingSyncing: "Sincronizando…",
  syncTins: "Sincronizar Tins",
  uploadFailed: "Error al subir el archivo.",
  alreadyImported: "Ya importado (duplicado).",
  marketValue: "Valor de mercado",
  loading: "Cargando…",
  noWalletBalances: "No se encontraron saldos de carteras.",
  syncedAccounts: (count) => `${count} cuenta${count !== 1 ? 's' : ''} sincronizada${count !== 1 ? 's' : ''}`,
  syncFailed: (names) => `Error: ${names.join(', ')}`,
  syncFailedCount: (count) => `${count} cuenta${count !== 1 ? 's' : ''} con error`,
  aaveDebtNote: (amount) => `${amount} de deuda en Aave no reflejada arriba`,
};

export const fr: PortfolioTileLocale = {
  lang: 'fr',
  importScreenshotAriaLabel: "Importer une capture de transaction",
  importScreenshotParsing: "Traitement…",
  importScreenshot: "Importer une capture",
  syncAllAriaLabel: "Synchroniser tous les tins",
  syncingSyncing: "Synchronisation…",
  syncTins: "Sync Tins",
  uploadFailed: "Échec du téléversement.",
  alreadyImported: "Déjà importé (doublon).",
  marketValue: "Valeur marchande",
  loading: "Chargement…",
  noWalletBalances: "Aucun solde de portefeuille trouvé.",
  syncedAccounts: (count) => `${count} compte${count !== 1 ? 's' : ''} synchronisé${count !== 1 ? 's' : ''}`,
  syncFailed: (names) => `Échec : ${names.join(', ')}`,
  syncFailedCount: (count) => `Échec de ${count} compte${count !== 1 ? 's' : ''}`,
  aaveDebtNote: (amount) => `${amount} de dette Aave non reflétée ci-dessus`,
};

const MAP: Record<Lang, PortfolioTileLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getPortfolioTile(lang: Lang): PortfolioTileLocale {
  return MAP[lang] ?? en;
}
