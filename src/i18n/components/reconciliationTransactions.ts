// ReconciliationTransactions (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface ReconciliationTransactionsLocale {
  lang: Lang;
  /** Column 1 heading. */
  heading: string;
  /** Error state message. */
  errorState: string;
  /** Loading state message. */
  loadingState: string;
  /** Empty state — no holdings above the threshold. Receives the threshold number. */
  emptyState: (threshold: number) => string;
  /** Status label when lifecycle qty matches snapshot qty. */
  matchLabel: string;
  /** Status label when lifecycle qty does not match snapshot qty. */
  gapLabel: string;
  /** Footer prefix before the formatted time. Receives the formatted time string. */
  lifecycleAsOf: (time: string) => string;
  /** BCP-47 locale tag used for toLocaleTimeString() in the footer. */
  timeLocale: string;
}

export const en: ReconciliationTransactionsLocale = {
  lang: 'en',
  heading: 'From Transactions',
  errorState: 'Unable to load transaction data.',
  loadingState: 'Loading…',
  emptyState: (threshold) => `No holdings above $${threshold} threshold.`,
  matchLabel: 'Match',
  gapLabel: 'Gap',
  lifecycleAsOf: (time) => `Lifecycle as of ${time}`,
  timeLocale: 'en-US',
};

export const es: ReconciliationTransactionsLocale = {
  lang: 'es',
  heading: "Desde transacciones",
  errorState: "No se pudieron cargar los datos de transacciones.",
  loadingState: "Cargando…",
  emptyState: (threshold) => `Sin activos por encima del umbral de $${threshold}.`,
  matchLabel: "Coincide",
  gapLabel: "Diferencia",
  lifecycleAsOf: (time) => `Ciclo de vida al ${time}`,
  timeLocale: 'es-ES',
};

export const fr: ReconciliationTransactionsLocale = {
  lang: 'fr',
  heading: "Depuis les transactions",
  errorState: "Impossible de charger les données de transactions.",
  loadingState: "Chargement…",
  emptyState: (threshold) => `Aucun actif au-dessus du seuil de $${threshold}.`,
  matchLabel: "Concordance",
  gapLabel: "Écart",
  lifecycleAsOf: (time) => `Cycle de vie au ${time}`,
  timeLocale: 'fr-FR',
};

const MAP: Record<Lang, ReconciliationTransactionsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getReconciliationTransactions(lang: Lang): ReconciliationTransactionsLocale {
  return MAP[lang] ?? en;
}
