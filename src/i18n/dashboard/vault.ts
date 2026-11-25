// Vault dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): vault.astro reads getLang(Astro.request) and selects
// via getVault(lang). These are the strings the PAGE owns — section dividers,
// demo banners, prompts, and the tin labels/props it passes to child components.
// The child components themselves (NetWorthHero internals, PortfolioTile,
// WalletSummary, the exchange cards, AddAssetTin, SmartImport — mostly React
// islands) carry their own English text and are localized in separate passes.
//
// Crypto jargon stays English per design.claude.md: wallet, DeFi, TradFi,
// on-chain, exchange names (Coinbase, Kraken…). ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface VaultLocale {
  lang: Lang;
  pageTitle: string;
  demoPageTitle: string;
  heroTitle: string;
  heroSubtitle: string;
  /** "You're exploring a live sample vault — N of 3 wallets. …" */
  demoBanner: (have: number) => string;
  saveCta: string;
  dividerExchanges: string;
  dividerOnchain: string;
  dividerCustom: string;
  moreExchanges: string;
  walletLimitReached: string;
  signupUnlimited: string;
  notepad: string;
  portfolio: string;
  health: string;
  walletValue: string;
  /** "N flagged · Month YYYY" */
  digestFlagged: (n: number, month: string) => string;
  renameWallet: string;
  rename: string;
  copyAddress: string;
  keepRecords: string;
  keepRecordsSub: string;
}

export const en: VaultLocale = {
  lang: 'en',
  pageTitle: 'Vault | Almstins',
  demoPageTitle: 'Demo Vault | Almstins',
  heroTitle: 'Vault',
  heroSubtitle: 'TradFi + DeFi vault overview',
  demoBanner: (have) =>
    `You're exploring a live sample vault — ${have} of 3 wallets.` +
    (have < 3 ? ` Add up to ${3 - have} more, or start your own.` : ' Start your own.'),
  saveCta: 'Start your own vault for free →',
  dividerExchanges: 'Centralized Exchanges',
  dividerOnchain: 'On-Chain Wallets',
  dividerCustom: 'Custom Wallets',
  moreExchanges: '+ More exchanges available',
  walletLimitReached: 'Wallet limit reached',
  signupUnlimited: 'Sign up for unlimited wallets →',
  notepad: 'Notepad',
  portfolio: 'Portfolio',
  health: 'Health',
  walletValue: 'Wallet value',
  digestFlagged: (n, month) => `${n} flagged · ${month}`,
  renameWallet: 'Rename wallet',
  rename: 'Rename',
  copyAddress: 'Copy address',
  keepRecords: 'Keep your own records.',
  keepRecordsSub:
    'Sign up free, add your own wallets and exchange CSVs, and Almstins keeps every holding, cost basis and gain in your account. The sample wallets stay in the demo. No credit card.',
};

export const es: VaultLocale = {
  lang: 'es',
  pageTitle: 'Bóveda | Almstins',
  demoPageTitle: 'Bóveda Demo | Almstins',
  heroTitle: 'Bóveda',
  heroSubtitle: 'Resumen de la bóveda TradFi + DeFi',
  demoBanner: (have) =>
    `Estás explorando una bóveda de muestra en vivo — ${have} de 3 wallets.` +
    (have < 3 ? ` Añade hasta ${3 - have} más, o crea la tuya.` : ' Crea la tuya.'),
  saveCta: 'Crea tu propia bóveda gratis →',
  dividerExchanges: 'Exchanges centralizados',
  dividerOnchain: 'Wallets on-chain',
  dividerCustom: 'Wallets personalizadas',
  moreExchanges: '+ Más exchanges disponibles',
  walletLimitReached: 'Límite de wallets alcanzado',
  signupUnlimited: 'Regístrate para wallets ilimitadas →',
  notepad: 'Notas',
  portfolio: 'Portafolio',
  health: 'Salud',
  walletValue: 'Valor de la wallet',
  digestFlagged: (n, month) => `${n} marcadas · ${month}`,
  renameWallet: 'Renombrar wallet',
  rename: 'Renombrar',
  copyAddress: 'Copiar dirección',
  keepRecords: 'Lleva tus propios registros.',
  keepRecordsSub:
    'Regístrate gratis, agrega tus propias wallets y CSV de exchanges, y Almstins guarda cada tenencia, base de coste y ganancia en tu cuenta. Las wallets de muestra se quedan en la demo. Sin tarjeta de crédito.',
};

export const fr: VaultLocale = {
  lang: 'fr',
  pageTitle: 'Coffre | Almstins',
  demoPageTitle: 'Coffre Démo | Almstins',
  heroTitle: 'Coffre',
  heroSubtitle: 'Aperçu du coffre TradFi + DeFi',
  demoBanner: (have) =>
    `Vous explorez un coffre d'exemple en direct — ${have} wallets sur 3.` +
    (have < 3 ? ` Ajoutez-en jusqu'à ${3 - have} de plus, ou créez le vôtre.` : ' Créez le vôtre.'),
  saveCta: 'Créez votre propre coffre gratuitement →',
  dividerExchanges: 'Exchanges centralisés',
  dividerOnchain: 'Wallets on-chain',
  dividerCustom: 'Wallets personnalisés',
  moreExchanges: "+ Plus d'exchanges disponibles",
  walletLimitReached: 'Limite de wallets atteinte',
  signupUnlimited: 'Inscrivez-vous pour des wallets illimités →',
  notepad: 'Notes',
  portfolio: 'Portefeuille',
  health: 'Santé',
  walletValue: 'Valeur du wallet',
  digestFlagged: (n, month) => `${n} signalées · ${month}`,
  renameWallet: 'Renommer le wallet',
  rename: 'Renommer',
  copyAddress: "Copier l'adresse",
  keepRecords: 'Tenez vos propres registres.',
  keepRecordsSub:
    "Inscrivez-vous gratuitement, ajoutez vos propres wallets et CSV d'exchanges, et Almstins conserve chaque avoir, coût de base et gain dans votre compte. Les wallets d'exemple restent dans la démo. Sans carte bancaire.",
};

const MAP: Record<Lang, VaultLocale> = { en, es, fr };

/** Select the Vault locale for a language, falling back to English. */
export function getVault(lang: Lang): VaultLocale {
  return MAP[lang] ?? en;
}
