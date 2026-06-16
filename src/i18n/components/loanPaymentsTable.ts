// LoanPaymentsTable (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). "TradFi" stays
// English (proper name). ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface LoanPaymentsTableLocale {
  lang: Lang;

  // Loading / error / empty states
  loading: string;
  errorFallback: string;
  empty: string;

  // Column headers
  colDate: string;
  colLoan: string;
  colAmount: string;
}

export const en: LoanPaymentsTableLocale = {
  lang: 'en',

  loading: 'Loading payments…',
  errorFallback: 'Failed to load payments.',
  empty: 'No payments recorded yet.',

  colDate: 'Date',
  colLoan: 'Loan',
  colAmount: 'Amount',
};

export const es: LoanPaymentsTableLocale = {
  lang: 'es',

  loading: "Cargando pagos…",
  errorFallback: "Error al cargar los pagos.",
  empty: "No hay pagos registrados aún.",

  colDate: "Fecha",
  colLoan: "Préstamo",
  colAmount: "Monto",
};

export const fr: LoanPaymentsTableLocale = {
  lang: 'fr',

  loading: "Chargement des paiements…",
  errorFallback: "Impossible de charger les paiements.",
  empty: "Aucun paiement enregistré pour l'instant.",

  colDate: "Date",
  colLoan: "Prêt",
  colAmount: "Montant",
};

const MAP: Record<Lang, LoanPaymentsTableLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getLoanPaymentsTable(lang: Lang): LoanPaymentsTableLocale {
  return MAP[lang] ?? en;
}
