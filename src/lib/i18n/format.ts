// Locale-aware formatting for the app (Phase 0 i18n foundation).
//
// Use these wherever financial values are displayed so numbers, currency,
// dates, and percentages render correctly per language
// (e.g. "$1,234.56" in en-US vs "1 234,56 $" in fr-FR).

import type { Lang } from './locale';

const INTL_LOCALE: Record<Lang, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
};

export function formatCurrency(amount: number, lang: Lang, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[lang], { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function formatNumber(n: number, lang: Lang, opts: Intl.NumberFormatOptions = {}): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[lang], opts).format(n);
  } catch {
    return String(n);
  }
}

/** `fraction` is a ratio: 0.0825 → "8.25%". */
export function formatPercent(fraction: number, lang: Lang, maximumFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[lang], {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(fraction);
  } catch {
    return `${(fraction * 100).toFixed(maximumFractionDigits)}%`;
  }
}

export function formatDate(
  iso: string | number | Date,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[lang], opts).format(new Date(iso));
  } catch {
    return '—';
  }
}
