// SolanaDefiSummary (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Crypto jargon / tickers / protocol names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface SolanaDefiSummaryLocale {
  lang: Lang;
  loading: string;
  error: string;
  activeProtocols: string;
  noActiveProtocols: string;
  alsoSeenInHistory: string;
}

export const en: SolanaDefiSummaryLocale = {
  lang: 'en',
  loading: 'Scanning Solana DeFi…',
  error: 'Unable to load DeFi activity.',
  activeProtocols: 'Active protocols',
  noActiveProtocols: 'No active protocol accounts found.',
  alsoSeenInHistory: 'Also seen in tx history',
};

export const es: SolanaDefiSummaryLocale = {
  lang: 'es',
  loading: 'Escaneando Solana DeFi…',
  error: "No se pudo cargar la actividad DeFi.",
  activeProtocols: 'Protocolos activos',
  noActiveProtocols: "No se encontraron cuentas de protocolo activas.",
  alsoSeenInHistory: "Visto también en el historial de transacciones",
};

export const fr: SolanaDefiSummaryLocale = {
  lang: 'fr',
  loading: "Analyse de Solana DeFi…",
  error: "Impossible de charger l'activité DeFi.",
  activeProtocols: 'Protocoles actifs',
  noActiveProtocols: "Aucun compte de protocole actif trouvé.",
  alsoSeenInHistory: "Vu aussi dans l'historique des transactions",
};

const MAP: Record<Lang, SolanaDefiSummaryLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getSolanaDefiSummary(lang: Lang): SolanaDefiSummaryLocale {
  return MAP[lang] ?? en;
}
