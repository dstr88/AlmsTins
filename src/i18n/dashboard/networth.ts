// Net Worth dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): networth.astro reads getLang(Astro.request) and selects
// via getNetworth(lang). These are the strings the PAGE owns — the layout title,
// hero title/subtitle, section heading, and tin labels passed to child components.
// Child components (NetWorthTable, NetWorthOverviewCard, PriceWatchlist,
// TotalsTin, WalletRows, NetWorthHero internals) carry their own English text and
// are localized in separate passes.
//
// Crypto jargon stays English per design.claude.md: wallet, DeFi, TradFi, on-chain.

import type { Lang } from '@/lib/i18n/locale';

export interface NetworthLocale {
  lang: Lang;
  pageTitle: string;
  heroTitle: string;
  heroSubtitle: string;
  heading: string;
  watchlistLabel: string;
}

export const en: NetworthLocale = {
  lang: 'en',
  pageTitle: 'Net Worth | Almstins',
  heroTitle: 'Net Worth',
  heroSubtitle: 'TradFi + DeFi at a glance',
  heading: 'Net worth',
  watchlistLabel: 'Watchlist',
};

export const es: NetworthLocale = {
  lang: 'es',
  pageTitle: 'Valor Neto | Almstins',
  heroTitle: 'Valor Neto',
  heroSubtitle: 'TradFi + DeFi de un vistazo',
  heading: 'Valor neto',
  watchlistLabel: 'Lista de seguimiento',
};

export const fr: NetworthLocale = {
  lang: 'fr',
  pageTitle: 'Valeur Nette | Almstins',
  heroTitle: 'Valeur Nette',
  heroSubtitle: 'TradFi + DeFi en un coup d\'œil',
  heading: 'Valeur nette',
  watchlistLabel: 'Liste de surveillance',
};

const MAP: Record<Lang, NetworthLocale> = { en, es, fr };

/** Select the Net Worth locale for a language, falling back to English. */
export function getNetworth(lang: Lang): NetworthLocale {
  return MAP[lang] ?? en;
}
