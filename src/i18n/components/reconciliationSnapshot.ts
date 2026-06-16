// ReconciliationSnapshot (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / "Memory Lane" feature name stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface ReconciliationSnapshotLocale {
  lang: Lang;
  heading: string;
  errorState: string;
  loadingState: string;
  emptyState: (threshold: number) => string;
  matchLabel: string;
  investigateTitle: (symbol: string) => string;
  historyLink: string;
  footerAs: (time: string) => string;
}

export const en: ReconciliationSnapshotLocale = {
  lang: 'en',
  heading: 'From Snapshot',
  errorState: 'Unable to load snapshot data.',
  loadingState: 'Loading…',
  emptyState: (threshold) => `No holdings above $${threshold} threshold.`,
  matchLabel: 'Match',
  investigateTitle: (symbol) => `Investigate ${symbol} in Memory Lane`,
  historyLink: 'Memory Lane →',
  footerAs: (time) => `Snapshot as of ${time}`,
};

export const es: ReconciliationSnapshotLocale = {
  lang: 'es',
  heading: 'Desde instantánea',
  errorState: 'No se pudieron cargar los datos de la instantánea.',
  loadingState: 'Cargando…',
  emptyState: (threshold) => `Sin posiciones por encima del umbral de $${threshold}.`,
  matchLabel: 'Coincide',
  investigateTitle: (symbol) => `Investigar ${symbol} en Memory Lane`,
  historyLink: 'Memory Lane →',
  footerAs: (time) => `Instantánea al ${time}`,
};

export const fr: ReconciliationSnapshotLocale = {
  lang: 'fr',
  heading: 'Depuis le snapshot',
  errorState: 'Impossible de charger les données du snapshot.',
  loadingState: 'Chargement…',
  emptyState: (threshold) => `Aucune position au-dessus du seuil de $${threshold}.`,
  matchLabel: 'Correspondance',
  investigateTitle: (symbol) => `Explorer ${symbol} dans Memory Lane`,
  historyLink: 'Memory Lane →',
  footerAs: (time) => `Snapshot au ${time}`,
};

const MAP: Record<Lang, ReconciliationSnapshotLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getReconciliationSnapshot(lang: Lang): ReconciliationSnapshotLocale {
  return MAP[lang] ?? en;
}
