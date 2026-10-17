// PartialTotalNote (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// Crypto jargon / tickers stay English. ES/FR first-pass.
//
// Shown under a total that may leave something out: an Aave position no price source could value is
// counted as nothing, so the total reads lower than it should. The note says so instead of letting the
// total pass as complete.

import type { Lang } from '@/lib/i18n/locale';

export interface PartialTotalNoteLocale {
  lang: Lang;
  /** Interpolated: how many Aave positions have no price and are left out of the total (at least 1) */
  unpriced: (count: number) => string;
  /** No unpriced position to count: the Aave data itself came back incomplete */
  incomplete: string;
}

export const en: PartialTotalNoteLocale = {
  lang: 'en',
  unpriced: (count) =>
    `Partial total: ${count} Aave ${count === 1 ? 'position' : 'positions'} unpriced, not counted`,
  incomplete: 'Partial total: Aave data is incomplete',
};

export const es: PartialTotalNoteLocale = {
  lang: 'es',
  unpriced: (count) =>
    `Total parcial: ${count} ${count === 1 ? 'posición' : 'posiciones'} de Aave sin precio, no ${count === 1 ? 'incluida' : 'incluidas'}`,
  incomplete: 'Total parcial: los datos de Aave están incompletos',
};

export const fr: PartialTotalNoteLocale = {
  lang: 'fr',
  unpriced: (count) =>
    `Total partiel : ${count} ${count === 1 ? 'position' : 'positions'} Aave sans prix, non ${count === 1 ? 'comptée' : 'comptées'}`,
  incomplete: 'Total partiel : les données Aave sont incomplètes',
};

const MAP: Record<Lang, PartialTotalNoteLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getPartialTotalNote(lang: Lang): PartialTotalNoteLocale {
  return MAP[lang] ?? en;
}

/**
 * The note to show under a total, or null when the total is complete. A count of unpriced positions
 * names them; otherwise a partial total says the Aave data was incomplete.
 */
export function partialTotalMessage(lang: Lang, partial: boolean | undefined, unpricedCount: number | undefined): string | null {
  if (partial !== true) return null;
  const t = getPartialTotalNote(lang);
  const count = Number.isFinite(unpricedCount) ? Math.floor(unpricedCount as number) : 0;
  return count > 0 ? t.unpriced(count) : t.incomplete;
}
