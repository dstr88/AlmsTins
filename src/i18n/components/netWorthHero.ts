// NetWorthHero (.astro) default title/subtitle. "TradFi" / "DeFi" stay English
// (proper terms); the "TradFi x DeFi" kicker is left as-is in the markup.

import type { Lang } from '@/lib/i18n/locale';

export interface NetWorthHeroLocale {
  lang: Lang;
  title: string;
  subtitle: string;
}

export const en: NetWorthHeroLocale = {
  lang: 'en',
  title: 'Net Worth',
  subtitle: 'TradFi + DeFi at a glance',
};

export const es: NetWorthHeroLocale = {
  lang: 'es',
  title: "Patrimonio neto",
  subtitle: "TradFi + DeFi de un vistazo",
};

export const fr: NetWorthHeroLocale = {
  lang: 'fr',
  title: "Valeur nette",
  subtitle: "TradFi + DeFi en un coup d'œil",
};

const MAP: Record<Lang, NetWorthHeroLocale> = { en, es, fr };

export function getNetWorthHero(lang: Lang): NetWorthHeroLocale {
  return MAP[lang] ?? en;
}
