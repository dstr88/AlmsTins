// WalletChainPicker (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletChainPickerLocale {
  lang: Lang;
  label: string;
  hint: string;
  saving: string;
  saved: string;
  saveError: string;
  keepOne: string;
}

export const en: WalletChainPickerLocale = {
  lang: 'en',
  label: 'Chains',
  hint: 'Tick a chain to read this wallet’s balance on it.',
  saving: 'Saving…',
  saved: 'Saved. Updating balances…',
  saveError: 'Could not save the chains. Try again.',
  keepOne: 'A wallet needs at least one chain.',
};

export const es: WalletChainPickerLocale = {
  lang: 'es',
  label: 'Cadenas',
  hint: 'Marca una cadena para leer el saldo de esta billetera en ella.',
  saving: 'Guardando…',
  saved: 'Guardado. Actualizando saldos…',
  saveError: 'No se pudieron guardar las cadenas. Inténtalo de nuevo.',
  keepOne: 'Una billetera necesita al menos una cadena.',
};

export const fr: WalletChainPickerLocale = {
  lang: 'fr',
  label: 'Chaînes',
  hint: 'Cochez une chaîne pour lire le solde de ce portefeuille sur celle-ci.',
  saving: 'Enregistrement…',
  saved: 'Enregistré. Mise à jour des soldes…',
  saveError: 'Impossible d’enregistrer les chaînes. Réessayez.',
  keepOne: 'Un portefeuille doit avoir au moins une chaîne.',
};

const MAP: Record<Lang, WalletChainPickerLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletChainPicker(lang: Lang): WalletChainPickerLocale {
  return MAP[lang] ?? en;
}
