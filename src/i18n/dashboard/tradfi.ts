// TradFi dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): tradfi.astro reads getLang(Astro.request) and selects
// via getTradfi(lang). These are the strings the PAGE owns — tin labels, section
// headings, buttons, and status messages. Child components (LoanPayoffCalculator,
// LoanPaymentsTable, NetWorthHero internals, SalmonTin internals) are localized
// in separate passes.
//
// "TradFi" stays English per design.claude.md (product jargon). Financial terms
// (loan, debt, payoff, payment history) ARE translatable. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TradfiLocale {
  lang: Lang;
  pageTitle: string;
  heroSubtitle: string;
  tinTotals: string;
  debtLabel: string;
  tinAddLoan: string;
  addLoanButton: string;
  /** "Added contract N." — interpolated with the loan index number */
  addedContract: (n: number) => string;
  tinLoanPayoff: string;
  /** "Loan payoff N" — label for cloned loan tins */
  loanPayoffLabel: (n: number) => string;
  paymentHistory: string;
}

export const en: TradfiLocale = {
  lang: 'en',
  pageTitle: 'Traditional Finance | Almstins',
  heroSubtitle: 'Traditional finance overview',
  tinTotals: 'Totals',
  debtLabel: 'Debt',
  tinAddLoan: 'Add loan',
  addLoanButton: 'Add another contract',
  addedContract: (n) => `Added contract ${n}.`,
  tinLoanPayoff: 'Loan payoff',
  loanPayoffLabel: (n) => `Loan payoff ${n}`,
  paymentHistory: 'Payment history',
};

export const es: TradfiLocale = {
  lang: 'es',
  pageTitle: 'Finanzas tradicionales | Almstins',
  heroSubtitle: 'Resumen de finanzas tradicionales',
  tinTotals: 'Totales',
  debtLabel: 'Deuda',
  tinAddLoan: 'Agregar préstamo',
  addLoanButton: 'Agregar otro contrato',
  addedContract: (n) => `Contrato ${n} agregado.`,
  tinLoanPayoff: 'Liquidación de préstamo',
  loanPayoffLabel: (n) => `Liquidación de préstamo ${n}`,
  paymentHistory: 'Historial de pagos',
};

export const fr: TradfiLocale = {
  lang: 'fr',
  pageTitle: 'Finances traditionnelles | Almstins',
  heroSubtitle: 'Aperçu des finances traditionnelles',
  tinTotals: 'Totaux',
  debtLabel: 'Dette',
  tinAddLoan: 'Ajouter un prêt',
  addLoanButton: 'Ajouter un autre contrat',
  addedContract: (n) => `Contrat ${n} ajouté.`,
  tinLoanPayoff: 'Remboursement de prêt',
  loanPayoffLabel: (n) => `Remboursement de prêt ${n}`,
  paymentHistory: 'Historique des paiements',
};

const MAP: Record<Lang, TradfiLocale> = { en, es, fr };

/** Select the TradFi locale for a language, falling back to English. */
export function getTradfi(lang: Lang): TradfiLocale {
  return MAP[lang] ?? en;
}
