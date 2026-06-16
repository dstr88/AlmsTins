// BookkeepingTin2 (.astro component) — user-facing strings (EN · ES · FR).
//
// Astro-component i18n pattern: the component reads getLang(Astro.request) in
// its frontmatter and selects via getBookkeepingTin2(lang).
// Crypto jargon / tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface BookkeepingTin2Locale {
  lang: Lang;

  // Header
  /** "Close" button visible text */
  close: string;
  /** aria-label for the close button */
  closeLabel: string;
  /** aria-label for the download button */
  downloadLabel: string;

  // Summary row labels
  gas: string;
  lastActivity: string;

  // Section headings
  stillInWallet: string;
  transferredOut: string;

  // Transaction row alt text
  inbound: string;
  outbound: string;

  // Textarea placeholders
  notesPlaceholder: string;
  noteUnsavedPlaceholder: string;
}

export const en: BookkeepingTin2Locale = {
  lang: 'en',

  close: 'Close',
  closeLabel: 'Close',
  downloadLabel: 'Download transactions',

  gas: 'Gas',
  lastActivity: 'Last activity',

  stillInWallet: 'Still in wallet',
  transferredOut: 'Transferred out',

  inbound: 'Inbound',
  outbound: 'Outbound',

  notesPlaceholder: 'Notes...',
  noteUnsavedPlaceholder: 'Note (not saved yet)',
};

export const es: BookkeepingTin2Locale = {
  lang: 'es',

  close: 'Cerrar',
  closeLabel: 'Cerrar',
  downloadLabel: 'Descargar transacciones',

  gas: 'Gas',
  lastActivity: "Ultima actividad",

  stillInWallet: 'En el wallet',
  transferredOut: 'Transferido fuera',

  inbound: 'Entrante',
  outbound: 'Saliente',

  notesPlaceholder: 'Notas...',
  noteUnsavedPlaceholder: 'Nota (sin guardar)',
};

export const fr: BookkeepingTin2Locale = {
  lang: 'fr',

  close: 'Fermer',
  closeLabel: 'Fermer',
  downloadLabel: 'Telecharger les transactions',

  gas: 'Gas',
  lastActivity: 'Derniere activite',

  stillInWallet: 'Encore dans le wallet',
  transferredOut: 'Transfere hors du wallet',

  inbound: 'Entrant',
  outbound: 'Sortant',

  notesPlaceholder: 'Notes...',
  noteUnsavedPlaceholder: 'Note (non enregistree)',
};

const MAP: Record<Lang, BookkeepingTin2Locale> = { en, es, fr };

/** Select the BookkeepingTin2 locale for a language, falling back to English. */
export function getBookkeepingTin2(lang: Lang): BookkeepingTin2Locale {
  return MAP[lang] ?? en;
}
