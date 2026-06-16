// WalletSummary (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names / LT/ST badges stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletSummaryLocale {
  lang: Lang;

  // BasisForm
  basisFormBought: string;
  basisFormPerCoin: string;
  basisFormSaving: string;
  basisFormSave: string;
  basisFormCancel: string;
  basisFormValidation: string;
  basisFormSaveFailed: string;
  basisFormNetworkError: string;

  // Spam/dust checkbox
  hideSpam: string;

  // Table column headers (snapshot fallback + stale + ready)
  colDays: string;
  colToken: string;
  colValue: string;

  // Unpriced token display
  unpriced: string;
  unpricedContractTitle: string;
  unpricedDataTitle: string;

  // Quantity suffix ("ea" = each)
  qtyEach: string;

  // "+ basis" button
  addBasis: string;
  addBasisTitle: string;

  // Error panel
  errorMessage: string;
  errorRefLabel: string;
  retryBtn: string;

  // Empty state
  emptyMessage: string;
  emptyHint: string;

  // Stale banner
  staleBanner: string;

  // Unpriced majority banner (shown in both stale + ready)
  unpricedBanner: string;

  // Total label
  totalLabel: string;

  // formatLastSync fallback
  neverSynced: string;
}

export const en: WalletSummaryLocale = {
  lang: 'en',

  basisFormBought: 'Bought',
  basisFormPerCoin: '$ per coin',
  basisFormSaving: 'Saving…',
  basisFormSave: 'Save',
  basisFormCancel: 'Cancel',
  basisFormValidation: 'Enter a date, a price, or both.',
  basisFormSaveFailed: 'Save failed.',
  basisFormNetworkError: 'Network error — please try again.',

  hideSpam: 'Hide likely spam/dust tokens',

  colDays: 'Days',
  colToken: 'Token',
  colValue: 'Value',

  unpriced: 'Unpriced',
  unpricedContractTitle: 'Unverified contract — price cannot be confirmed',
  unpricedDataTitle: 'Price data unavailable for this token',

  qtyEach: 'ea',

  addBasis: '+ basis',
  addBasisTitle: 'Enter your purchase date and/or price paid',

  errorMessage: 'Could not load wallet data',
  errorRefLabel: 'Ref',
  retryBtn: 'Try again',

  emptyMessage: 'No balance data yet.',
  emptyHint: 'Add a wallet and run a sync to populate totals.',

  staleBanner: 'Stale: refresh failed. Showing last known balances.',

  unpricedBanner: 'Holdings loaded; most tokens are unpriced/unverified (likely spam).',

  totalLabel: 'Total',

  neverSynced: 'never',
};

export const es: WalletSummaryLocale = {
  lang: 'es',

  basisFormBought: "Comprado",
  basisFormPerCoin: "$ por moneda",
  basisFormSaving: "Guardando…",
  basisFormSave: "Guardar",
  basisFormCancel: "Cancelar",
  basisFormValidation: "Ingresa una fecha, un precio o ambos.",
  basisFormSaveFailed: "Error al guardar.",
  basisFormNetworkError: "Error de red — por favor inténtalo de nuevo.",

  hideSpam: "Ocultar tokens de spam/polvo probables",

  colDays: "Días",
  colToken: "Token",
  colValue: "Valor",

  unpriced: "Sin precio",
  unpricedContractTitle: "Contrato no verificado — no se puede confirmar el precio",
  unpricedDataTitle: "Datos de precio no disponibles para este token",

  qtyEach: "c/u",

  addBasis: "+ base",
  addBasisTitle: "Ingresa tu fecha de compra y/o precio pagado",

  errorMessage: "No se pudieron cargar los datos de la cartera",
  errorRefLabel: "Ref",
  retryBtn: "Reintentar",

  emptyMessage: "Aún no hay datos de saldo.",
  emptyHint: "Agrega una cartera y ejecuta una sincronización para ver los totales.",

  staleBanner: "Desactualizado: error al actualizar. Mostrando últimos saldos conocidos.",

  unpricedBanner: "Tenencias cargadas; la mayoría de los tokens no tienen precio/no están verificados (probablemente spam).",

  totalLabel: "Total",

  neverSynced: "nunca",
};

export const fr: WalletSummaryLocale = {
  lang: 'fr',

  basisFormBought: "Acheté",
  basisFormPerCoin: "$ par pièce",
  basisFormSaving: "Enregistrement…",
  basisFormSave: "Enregistrer",
  basisFormCancel: "Annuler",
  basisFormValidation: "Saisissez une date, un prix ou les deux.",
  basisFormSaveFailed: "Échec de l’enregistrement.",
  basisFormNetworkError: "Erreur réseau — veuillez réessayer.",

  hideSpam: "Masquer les tokens spam/poussière probables",

  colDays: "Jours",
  colToken: "Token",
  colValue: "Valeur",

  unpriced: "Non évalué",
  unpricedContractTitle: "Contrat non vérifié — le prix ne peut pas être confirmé",
  unpricedDataTitle: "Données de prix non disponibles pour ce token",

  qtyEach: "u.",

  addBasis: "+ base",
  addBasisTitle: "Saisissez votre date d’achat et/ou le prix payé",

  errorMessage: "Impossible de charger les données du portefeuille",
  errorRefLabel: "Réf",
  retryBtn: "Réessayer",

  emptyMessage: "Aucune donnée de solde pour l’instant.",
  emptyHint: "Ajoutez un portefeuille et lancez une synchronisation pour voir les totaux.",

  staleBanner: "Données périmées : échec de l’actualisation. Affichage des derniers soldes connus.",

  unpricedBanner: "Avoirs chargés ; la plupart des tokens ne sont pas évalués/vérifiés (probablement du spam).",

  totalLabel: "Total",

  neverSynced: "jamais",
};

const MAP: Record<Lang, WalletSummaryLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletSummary(lang: Lang): WalletSummaryLocale {
  return MAP[lang] ?? en;
}
