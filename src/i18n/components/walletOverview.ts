// WalletOverview (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US. Crypto jargon / tickers / chain names stay
// English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletOverviewLocale {
  lang: Lang;

  // Header
  sectionEyebrow: string;
  heading: string;
  subheading: string;

  // Empty state
  emptyState: string;

  // Wallet card fallback label
  unnamed: string;

  // Copy button
  copyAddressTitle: string;

  // Action buttons (editing mode)
  btnSave: string;
  btnCancel: string;
  btnDelete: string;
  btnEdit: string;

  // Inline status messages (edit / delete flow)
  statusDeleting: string;
  statusDeleted: string;
  statusDeleteError: string;
  statusSaving: string;
  statusSaved: string;
  statusSaveError: string;
  statusLabelRequired: string;

  // Delete confirmation dialog (window.confirm)
  confirmDelete: (nameOrAddress: string) => string;

  // Add-wallet form
  addFormLabel: string;
  addPlaceholderAddress: string;
  addPlaceholderLabel: string;
  addPlaceholderSymbol: string;
  addBtnAdding: string;
  addBtnAdd: string;

  // Add-wallet status messages
  addStatusAddressRequired: string;
  addStatusLabelRequired: string;
  addStatusSaving: string;
  addStatusAdded: string;
  addStatusErrorPrefix: string;
}

export const en: WalletOverviewLocale = {
  lang: 'en',

  sectionEyebrow: 'Vault',
  heading: 'My Wallets',
  subheading: 'Wallets added here are synced to the Vault and tracked as yours.',

  emptyState: 'No wallets yet — add your first one below.',

  unnamed: 'Unnamed',

  copyAddressTitle: 'Copy address',

  btnSave: 'Save',
  btnCancel: 'Cancel',
  btnDelete: 'Delete',
  btnEdit: 'Edit',

  statusDeleting: 'Deleting…',
  statusDeleted: 'Wallet deleted.',
  statusDeleteError: 'Unable to delete right now.',
  statusSaving: 'Saving…',
  statusSaved: 'Saved.',
  statusSaveError: 'Unable to save right now.',
  statusLabelRequired: 'Label is required',

  confirmDelete: (nameOrAddress) =>
    `Delete wallet "${nameOrAddress}"?\n\nThis will permanently delete the wallet and ALL of its transaction history. This cannot be undone.`,

  addFormLabel: 'Add a wallet to the Vault',
  addPlaceholderAddress: 'Wallet address',
  addPlaceholderLabel: 'Label  (e.g. My Ledger)',
  addPlaceholderSymbol: 'Symbol  (e.g. LTC)',
  addBtnAdding: 'Adding…',
  addBtnAdd: 'Add Wallet',

  addStatusAddressRequired: 'Address is required',
  addStatusLabelRequired: 'Label is required',
  addStatusSaving: 'Saving…',
  addStatusAdded: '✓ Wallet added.',
  addStatusErrorPrefix: 'Error: ',
};

export const es: WalletOverviewLocale = {
  lang: 'es',

  sectionEyebrow: "Vault",
  heading: "Mis carteras",
  subheading: "Las carteras añadidas aquí se sincronizan con el Vault y se registran como tuyas.",

  emptyState: "Aún no hay carteras — añade la primera a continuación.",

  unnamed: "Sin nombre",

  copyAddressTitle: "Copiar dirección",

  btnSave: "Guardar",
  btnCancel: "Cancelar",
  btnDelete: "Eliminar",
  btnEdit: "Editar",

  statusDeleting: "Eliminando…",
  statusDeleted: "Cartera eliminada.",
  statusDeleteError: "No se puede eliminar ahora mismo.",
  statusSaving: "Guardando…",
  statusSaved: "Guardado.",
  statusSaveError: "No se puede guardar ahora mismo.",
  statusLabelRequired: "Se requiere una etiqueta",

  confirmDelete: (nameOrAddress) =>
    `¿Eliminar la cartera "${nameOrAddress}"?\n\nEsto eliminará permanentemente la cartera y TODO su historial de transacciones. Esta acción no se puede deshacer.`,

  addFormLabel: "Añadir una cartera al Vault",
  addPlaceholderAddress: "Dirección de cartera",
  addPlaceholderLabel: "Etiqueta  (p. ej. Mi Ledger)",
  addPlaceholderSymbol: "Símbolo  (p. ej. LTC)",
  addBtnAdding: "Añadiendo…",
  addBtnAdd: "Añadir cartera",

  addStatusAddressRequired: "Se requiere una dirección",
  addStatusLabelRequired: "Se requiere una etiqueta",
  addStatusSaving: "Guardando…",
  addStatusAdded: "✓ Cartera añadida.",
  addStatusErrorPrefix: "Error: ",
};

export const fr: WalletOverviewLocale = {
  lang: 'fr',

  sectionEyebrow: "Vault",
  heading: "Mes portefeuilles",
  subheading: "Les portefeuilles ajoutés ici sont synchronisés avec le Vault et suivis comme les vôtres.",

  emptyState: "Aucun portefeuille pour l'instant — ajoutez-en un ci-dessous.",

  unnamed: "Sans nom",

  copyAddressTitle: "Copier l'adresse",

  btnSave: "Enregistrer",
  btnCancel: "Annuler",
  btnDelete: "Supprimer",
  btnEdit: "Modifier",

  statusDeleting: "Suppression…",
  statusDeleted: "Portefeuille supprimé.",
  statusDeleteError: "Impossible de supprimer pour l'instant.",
  statusSaving: "Enregistrement…",
  statusSaved: "Enregistré.",
  statusSaveError: "Impossible d'enregistrer pour l'instant.",
  statusLabelRequired: "Un libellé est requis",

  confirmDelete: (nameOrAddress) =>
    `Supprimer le portefeuille "${nameOrAddress}" ?\n\nCela supprimera définitivement le portefeuille et TOUT son historique de transactions. Cette action est irréversible.`,

  addFormLabel: "Ajouter un portefeuille au Vault",
  addPlaceholderAddress: "Adresse du portefeuille",
  addPlaceholderLabel: "Libellé  (ex. Mon Ledger)",
  addPlaceholderSymbol: "Symbole  (ex. LTC)",
  addBtnAdding: "Ajout…",
  addBtnAdd: "Ajouter le portefeuille",

  addStatusAddressRequired: "Une adresse est requise",
  addStatusLabelRequired: "Un libellé est requis",
  addStatusSaving: "Enregistrement…",
  addStatusAdded: "✓ Portefeuille ajouté.",
  addStatusErrorPrefix: "Erreur : ",
};

const MAP: Record<Lang, WalletOverviewLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletOverview(lang: Lang): WalletOverviewLocale {
  return MAP[lang] ?? en;
}
