// CustomWalletCard component — EN · ES · FR.
//
// Covers: meta label, add/delete/confirm button text, tx count label (singular/plural),
// confirm-panel hint, and client-script status messages.
//
// NOT translated: crypto jargars, tickers, chain names, className, data attributes,
// address display strings, wallet label (comes from props/DB), console.log.

import type { Lang } from '@/lib/i18n/locale';

export interface CustomWalletCardLocale {
  // Meta badge
  metaManual: string;

  // Add transaction button
  btnAddTransaction: string;

  // Transaction count label (singular / plural)
  txSingular: string;
  txPlural: string;

  // Delete area
  btnDeleteWallet: string;
  confirmHint: string;
  btnConfirmYes: string;
  btnConfirmNo: string;

  // Client script fallback wallet label
  scriptDefaultWalletLabel: string;

  // Client script — delete status messages
  scriptDeleting: string;
  scriptDeleteFailed: string;
  scriptDeleted: string;
  scriptNetworkError: string;

  // Date locale identifier (for toLocaleDateString)
  dateLocale: string;
}

export const en: CustomWalletCardLocale = {
  metaManual: 'Manual',

  btnAddTransaction: '+ Add Transaction',

  txSingular: 'transaction',
  txPlural: 'transactions',

  btnDeleteWallet: 'Delete Wallet',
  confirmHint: 'Type the wallet name to confirm:',
  btnConfirmYes: 'Delete',
  btnConfirmNo: 'Cancel',

  scriptDefaultWalletLabel: 'Custom Wallet',

  scriptDeleting: 'Deleting…',
  scriptDeleteFailed: 'Delete failed.',
  scriptDeleted: 'Deleted — reloading…',
  scriptNetworkError: 'Network error — try again.',

  dateLocale: 'en-US',
};

export const es: CustomWalletCardLocale = {
  metaManual: 'Manual',

  btnAddTransaction: '+ Agregar transaccion',

  txSingular: 'transaccion',
  txPlural: 'transacciones',

  btnDeleteWallet: 'Eliminar cartera',
  confirmHint: 'Escribe el nombre de la cartera para confirmar:',
  btnConfirmYes: 'Eliminar',
  btnConfirmNo: 'Cancelar',

  scriptDefaultWalletLabel: 'Cartera personalizada',

  scriptDeleting: 'Eliminando…',
  scriptDeleteFailed: 'Error al eliminar.',
  scriptDeleted: 'Eliminada — recargando…',
  scriptNetworkError: 'Error de red — intentalo de nuevo.',

  dateLocale: 'es-419',
};

export const fr: CustomWalletCardLocale = {
  metaManual: 'Manuel',

  btnAddTransaction: '+ Ajouter une transaction',

  txSingular: 'transaction',
  txPlural: 'transactions',

  btnDeleteWallet: 'Supprimer le portefeuille',
  confirmHint: 'Tapez le nom du portefeuille pour confirmer :',
  btnConfirmYes: 'Supprimer',
  btnConfirmNo: 'Annuler',

  scriptDefaultWalletLabel: 'Portefeuille personnalise',

  scriptDeleting: 'Suppression…',
  scriptDeleteFailed: 'Echec de la suppression.',
  scriptDeleted: 'Supprime — rechargement…',
  scriptNetworkError: 'Erreur reseau — veuillez reessayer.',

  dateLocale: 'fr-FR',
};

const MAP: Record<Lang, CustomWalletCardLocale> = { en, es, fr };

export function getCustomWalletCard(lang: Lang): CustomWalletCardLocale {
  return MAP[lang] ?? en;
}
