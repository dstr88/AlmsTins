// NetWorthWalletCard (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface NetWorthWalletCardLocale {
  lang: Lang;
  loadingBalances: string;
  errorPrefix: string;
  totalPrefix: string;
  colToken: string;
  colChain: string;
  colAmount: string;
  colUsd: string;
  noTokens: string;
}

export const en: NetWorthWalletCardLocale = {
  lang: 'en',
  loadingBalances: 'Loading balances…',
  errorPrefix: 'Error: ',
  totalPrefix: 'Total: $',
  colToken: 'Token',
  colChain: 'Chain',
  colAmount: 'Amount',
  colUsd: 'USD',
  noTokens: 'No tokens found.',
};

export const es: NetWorthWalletCardLocale = {
  lang: 'es',
  loadingBalances: 'Cargando saldos…',
  errorPrefix: 'Error: ',
  totalPrefix: 'Total: $',
  colToken: 'Token',
  colChain: 'Cadena',
  colAmount: 'Cantidad',
  colUsd: 'USD',
  noTokens: 'No se encontraron tokens.',
};

export const fr: NetWorthWalletCardLocale = {
  lang: 'fr',
  loadingBalances: 'Chargement des soldes…',
  errorPrefix: 'Erreur : ',
  totalPrefix: 'Total : $',
  colToken: 'Token',
  colChain: 'Chaîne',
  colAmount: 'Montant',
  colUsd: 'USD',
  noTokens: 'Aucun token trouvé.',
};

const MAP: Record<Lang, NetWorthWalletCardLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getNetWorthWalletCard(lang: Lang): NetWorthWalletCardLocale {
  return MAP[lang] ?? en;
}
