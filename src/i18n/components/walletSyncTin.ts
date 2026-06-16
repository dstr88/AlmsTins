// Shared strings for the small wallet "sync tin" wrappers (Sui / Solana / Tin2
// on-chain). These are consumed in client <script> blocks via a define:vars
// island, so interpolated values are TEMPLATE strings with a {n} placeholder
// (functions can't serialize through define:vars; the script does .replace).
// Tickers / $ amounts stay as-is.

import type { Lang } from '@/lib/i18n/locale';

export interface WalletSyncTinLocale {
  lang: Lang;
  sync: string;
  syncing: string;
  syncingHistory: string;
  syncedNewTemplate: string;
  syncedCountTemplate: string;
  syncFailed: string;
}

export const en: WalletSyncTinLocale = {
  lang: 'en',
  sync: 'Sync',
  syncing: 'Syncing…',
  syncingHistory: 'Syncing wallet history…',
  syncedNewTemplate: 'Synced {n} new transactions.',
  syncedCountTemplate: 'Synced {n} transactions.',
  syncFailed: 'Sync failed.',
};

export const es: WalletSyncTinLocale = {
  lang: 'es',
  sync: "Sincronizar",
  syncing: "Sincronizando…",
  syncingHistory: "Sincronizando el historial del wallet…",
  syncedNewTemplate: "{n} transacciones nuevas sincronizadas.",
  syncedCountTemplate: "{n} transacciones sincronizadas.",
  syncFailed: "Error al sincronizar.",
};

export const fr: WalletSyncTinLocale = {
  lang: 'fr',
  sync: "Synchroniser",
  syncing: "Synchronisation…",
  syncingHistory: "Synchronisation de l'historique du wallet…",
  syncedNewTemplate: "{n} nouvelles transactions synchronisées.",
  syncedCountTemplate: "{n} transactions synchronisées.",
  syncFailed: "Échec de la synchronisation.",
};

const MAP: Record<Lang, WalletSyncTinLocale> = { en, es, fr };

export function getWalletSyncTin(lang: Lang): WalletSyncTinLocale {
  return MAP[lang] ?? en;
}
