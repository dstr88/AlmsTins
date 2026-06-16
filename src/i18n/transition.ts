// Transition / view-picker page — page-level strings (EN · ES · FR).
//
// Cookie-based: transition.astro reads getLang(Astro.request) and selects
// via getTransition(lang).
//
// Jargon that stays English per design.claude.md: TradFi, DeFi, Vault,
// onchain, offchain. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TransitionLocale {
  lang: Lang;
  pageTitle: string;
  /** Personalised h1 when first name is known, plain h1 otherwise. */
  welcomeBack: (firstName: string) => string;
  chooseView: string;
  subtitle: string;
  tradfiTitle: string;
  tradfiDescription: string;
  cryptoTitle: string;
  cryptoDescription: string;
}

export const en: TransitionLocale = {
  lang: 'en',
  pageTitle: 'Choose Your View | Almstins',
  welcomeBack: (firstName) => `Welcome back, ${firstName}.`,
  chooseView: 'Choose your view',
  subtitle: 'Jump into crypto vaults or traditional finance insights.',
  tradfiTitle: 'Traditional Finance',
  tradfiDescription: 'Banking, loans, and offchain holdings.',
  cryptoTitle: 'Vault',
  cryptoDescription: 'Onchain positions, DeFi health, and wallets.',
};

export const es: TransitionLocale = {
  lang: 'es',
  pageTitle: 'Elige Tu Vista | Almstins',
  welcomeBack: (firstName) => `Bienvenido de nuevo, ${firstName}.`,
  chooseView: 'Elige tu vista',
  subtitle: 'Accede a tu crypto vault o a tus finanzas tradicionales.',
  tradfiTitle: 'Finanzas Tradicionales',
  tradfiDescription: 'Banca, préstamos y activos offchain.',
  cryptoTitle: 'Vault',
  cryptoDescription: 'Posiciones onchain, salud DeFi y wallets.',
};

export const fr: TransitionLocale = {
  lang: 'fr',
  pageTitle: 'Choisissez Votre Vue | Almstins',
  welcomeBack: (firstName) => `Bon retour, ${firstName}.`,
  chooseView: 'Choisissez votre vue',
  subtitle: 'Accédez à vos crypto vaults ou à vos finances traditionnelles.',
  tradfiTitle: 'Finance Traditionnelle',
  tradfiDescription: 'Banque, prêts et avoirs offchain.',
  cryptoTitle: 'Vault',
  cryptoDescription: 'Positions onchain, santé DeFi et wallets.',
};

const MAP: Record<Lang, TransitionLocale> = { en, es, fr };

/** Select the Transition locale for a language, falling back to English. */
export function getTransition(lang: Lang): TransitionLocale {
  return MAP[lang] ?? en;
}
