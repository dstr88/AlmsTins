// CoinStory component — EN · ES · FR.
//
// Covers: image alt text for transaction direction icons and textarea placeholder.
//
// NOT translated: crypto tickers, chain names, hardcoded demo dates/amounts,
// the `title` prop, className, data attributes.

import type { Lang } from '@/lib/i18n/locale';

export interface CoinStoryLocale {
  altBought: string;
  altSold: string;
  notesPlaceholder: string;
}

export const en: CoinStoryLocale = {
  altBought: 'Bought',
  altSold: 'Sold',
  notesPlaceholder: 'Notes...',
};

export const es: CoinStoryLocale = {
  altBought: 'Comprado',
  altSold: 'Vendido',
  notesPlaceholder: 'Notas...',
};

export const fr: CoinStoryLocale = {
  altBought: 'Achat',
  altSold: 'Vente',
  notesPlaceholder: 'Notes...',
};

const MAP: Record<Lang, CoinStoryLocale> = { en, es, fr };

export function getCoinStory(lang: Lang): CoinStoryLocale {
  return MAP[lang] ?? en;
}
