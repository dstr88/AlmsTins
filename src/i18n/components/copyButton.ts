// CopyButton and Address (shared React pieces) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via getClientLang()
// unless the caller passes one. Callers with their own words (Agentics, the Verify dashboard)
// pass them in instead.

import type { Lang } from '@/lib/i18n/locale';

export interface CopyButtonLocale {
  /** The word on a text button before it is pressed. */
  copy: string;
  copied: string;
  copyFailed: string;
  /** The button's name for a screen reader, with the address shortened. */
  copyAddress: (short: string) => string;
  /** The same, for a value that is not an address (a hash, a code). */
  copyValue: (short: string) => string;
}

const en: CopyButtonLocale = {
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  copyAddress: (short) => `Copy address ${short}`,
  copyValue: (short) => `Copy ${short}`,
};

const es: CopyButtonLocale = {
  copy: 'Copiar',
  copied: 'Copiado',
  copyFailed: 'No se pudo copiar',
  copyAddress: (short) => `Copiar la dirección ${short}`,
  copyValue: (short) => `Copiar ${short}`,
};

const fr: CopyButtonLocale = {
  copy: 'Copier',
  copied: 'Copié',
  copyFailed: 'Échec de la copie',
  copyAddress: (short) => `Copier l'adresse ${short}`,
  copyValue: (short) => `Copier ${short}`,
};

const MAP: Record<Lang, CopyButtonLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getCopyButton(lang: Lang): CopyButtonLocale {
  return MAP[lang] ?? en;
}
