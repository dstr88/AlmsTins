// API error strings for account / alerts / import / wallet-sync endpoints.
//
// ONLY user-facing validation messages are translated here. Machine codes
// (Unauthorized, Invalid JSON, Database error, Failed to save, Missing <field>,
// etc.) are left as English in the endpoint files and are NOT in this locale.
//
// Crypto jargon, ticker symbols, and $ amounts are never translated.
// ES/FR are first-pass natural translations.

import type { Lang } from '@/lib/i18n/locale';

export interface AccountErrorsLocale {
  lang: Lang;

  // price-alerts — POST validation
  /** "Asset symbol is required" */
  assetSymbolRequired: string;
  /** "Price threshold must be a positive number" */
  thresholdPositive: string;

  // alert-email — POST validation
  /** "Invalid email address" */
  invalidEmail: string;

  // alert-preferences — POST validation
  /** "Threshold must be between 0 and 100" */
  thresholdRange: string;

  // wallets/value/sync-all — catch-all fallback shown when sync throws
  /** "Wallet value sync failed" */
  valueSyncFailed: string;
}

const en: AccountErrorsLocale = {
  lang: 'en',
  assetSymbolRequired: 'Asset symbol is required',
  thresholdPositive:   'Price threshold must be a positive number',
  invalidEmail:        'Invalid email address',
  thresholdRange:      'Threshold must be between 0 and 100',
  valueSyncFailed:     'Wallet value sync failed',
};

const es: AccountErrorsLocale = {
  lang: 'es',
  assetSymbolRequired: "Se requiere el símbolo del asset",
  thresholdPositive:   "El umbral de precio debe ser un número positivo",
  invalidEmail:        "Dirección de correo inválida",
  thresholdRange:      "El umbral debe estar entre 0 y 100",
  valueSyncFailed:     "Error al sincronizar el valor de la cartera",
};

const fr: AccountErrorsLocale = {
  lang: 'fr',
  assetSymbolRequired: "Le symbole de l'asset est requis",
  thresholdPositive:   "Le seuil de prix doit être un nombre positif",
  invalidEmail:        "Adresse e-mail invalide",
  thresholdRange:      "Le seuil doit être compris entre 0 et 100",
  valueSyncFailed:     "Échec de la synchronisation de la valeur du portefeuille",
};

const MAP: Record<Lang, AccountErrorsLocale> = { en, es, fr };

/** Select the account-API error locale for a language, falling back to English. */
export function getAccountErrors(lang: Lang): AccountErrorsLocale {
  return MAP[lang] ?? en;
}
