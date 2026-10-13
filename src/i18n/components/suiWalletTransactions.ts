// SuiWalletTransactions component — EN · ES · FR.
//
// Covers: empty-state message, column labels, direction labels, fee label,
// notes placeholder, save confirmation, and client-script error message.
// Date locale strings for toLocaleDateString / toLocaleString.
//
// NOT translated: "Sui" (chain name), digest hashes, ticker symbols,
// className, data attributes, API enum values, console.log.

import type { Lang } from '@/lib/i18n/locale';

export interface SuiWalletTransactionsLocale {
  // Empty state
  emptyState: string;

  // Transaction row labels
  labelDigest: string;
  altOut: string;
  altIn: string;
  labelSent: string;
  labelReceived: string;
  labelFee: string;

  // Notes textarea
  notesPlaceholder: string;

  // Save feedback
  saved: string;

  // Client script — save error
  scriptSaveFailed: string;

  // Sync freshness prefix  ("synced Jan 5, 2026")
  syncedPrefix: string;

  // Date locale string used for toLocaleDateString / toLocaleString
  dateLocale: string;
}

export const en: SuiWalletTransactionsLocale = {
  emptyState: 'No transactions yet — hit Sync to load history.',

  labelDigest: 'Digest',
  altOut: 'Out',
  altIn: 'In',
  labelSent: 'Sent',
  labelReceived: 'Received',
  labelFee: 'Fee',

  notesPlaceholder: 'Notes...',

  saved: 'Saved',

  scriptSaveFailed: 'Save failed',

  syncedPrefix: 'synced',

  dateLocale: 'en-US',
};

export const es: SuiWalletTransactionsLocale = {
  emptyState: 'Aun no hay transacciones — pulsa Sincronizar para cargar el historial.',

  labelDigest: 'Resumen',
  altOut: 'Salida',
  altIn: 'Entrada',
  labelSent: 'Enviado',
  labelReceived: 'Recibido',
  labelFee: 'Comision',

  notesPlaceholder: 'Notas...',

  saved: 'Guardado',

  scriptSaveFailed: 'Error al guardar',

  syncedPrefix: 'sincronizado',

  dateLocale: 'es-ES',
};

export const fr: SuiWalletTransactionsLocale = {
  emptyState: "Aucune transaction pour le moment — cliquez sur Synchroniser pour charger l'historique.",

  labelDigest: 'Resume',
  altOut: 'Sortie',
  altIn: 'Entree',
  labelSent: 'Envoye',
  labelReceived: 'Recu',
  labelFee: 'Frais',

  notesPlaceholder: 'Notes...',

  saved: 'Enregistre',

  scriptSaveFailed: "Echec de l'enregistrement",

  syncedPrefix: 'synchronise',

  dateLocale: 'fr-FR',
};

const MAP: Record<Lang, SuiWalletTransactionsLocale> = { en, es, fr };

export function getSuiWalletTransactions(lang: Lang): SuiWalletTransactionsLocale {
  return MAP[lang] ?? en;
}
