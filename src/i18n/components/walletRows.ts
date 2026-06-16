// WalletRows (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Crypto jargon / tickers stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletRowsLocale {
  lang: Lang;
  loading: string;
  errorPrefix: string;
  noWallets: string;
}

export const en: WalletRowsLocale = {
  lang: 'en',
  loading: 'Loading wallets…',
  errorPrefix: 'Error:',
  noWallets: 'No wallets found.',
};

export const es: WalletRowsLocale = {
  lang: 'es',
  loading: 'Cargando wallets…',
  errorPrefix: 'Error:',
  noWallets: 'No se encontraron wallets.',
};

export const fr: WalletRowsLocale = {
  lang: 'fr',
  loading: 'Chargement des wallets…',
  errorPrefix: 'Erreur :',
  noWallets: 'Aucun wallet trouvé.',
};

const MAP: Record<Lang, WalletRowsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getWalletRows(lang: Lang): WalletRowsLocale {
  return MAP[lang] ?? en;
}
