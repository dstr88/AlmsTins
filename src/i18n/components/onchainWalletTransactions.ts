// OnchainWalletTransactions component — EN · ES · FR.
//
// Covers: column labels (Chain, Hash, USD, Fee, Loss), direction alt text
// (Outbound/Inbound), amount labels (Sold/Bought), notes placeholder, save
// feedback ("Saved" / "Save failed"), linked-swap group label, and the freshness
// stamp templates (synced / data through).
//
// NOT translated: enum/category values, crypto tickers, chain names, hash values,
// className, data attributes, API keys, console.log strings.

import type { Lang } from '@/lib/i18n/locale';

export interface OnchainWalletTransactionsLocale {
  // Column labels
  labelChain: string;
  labelHash: string;
  labelUsd: string;
  labelFee: string;
  labelLoss: string;

  // Direction icon alt text
  altOutbound: string;
  altInbound: string;

  // Amount label (direction-dependent)
  amountSold: string;
  amountBought: string;

  // Notes textarea
  notesPlaceholder: string;

  // Save feedback (notes blur handler)
  savedText: string;
  saveFailedText: string;

  // Linked-swap group label — interpolation via syncedTemplate(date)
  linkedSwapPrefix: string; // "Linked swap • USD "

  // Freshness stamp templates — use syncedTemplate(date) / dataThroughTemplate(date)
  syncedPrefix: string;       // "synced "
  dataThroughPrefix: string;  // "data through "
}

export const en: OnchainWalletTransactionsLocale = {
  labelChain: 'Chain',
  labelHash: 'Hash',
  labelUsd: 'USD',
  labelFee: 'Fee',
  labelLoss: 'Loss',

  altOutbound: 'Outbound',
  altInbound: 'Inbound',

  amountSold: 'Sold',
  amountBought: 'Bought',

  notesPlaceholder: 'Notes...',

  savedText: 'Saved',
  saveFailedText: 'Save failed',

  linkedSwapPrefix: 'Linked swap • USD ',

  syncedPrefix: 'synced ',
  dataThroughPrefix: 'data through ',
};

export const es: OnchainWalletTransactionsLocale = {
  labelChain: 'Red',
  labelHash: 'Hash',
  labelUsd: 'USD',
  labelFee: 'Comision',
  labelLoss: 'Perdida',

  altOutbound: 'Saliente',
  altInbound: 'Entrante',

  amountSold: 'Vendido',
  amountBought: 'Comprado',

  notesPlaceholder: 'Notas...',

  savedText: 'Guardado',
  saveFailedText: 'Error al guardar',

  linkedSwapPrefix: 'Intercambio vinculado • USD ',

  syncedPrefix: 'sincronizado ',
  dataThroughPrefix: 'datos hasta ',
};

export const fr: OnchainWalletTransactionsLocale = {
  labelChain: 'Reseau',
  labelHash: 'Hash',
  labelUsd: 'USD',
  labelFee: 'Frais',
  labelLoss: 'Perte',

  altOutbound: 'Sortant',
  altInbound: 'Entrant',

  amountSold: 'Vendu',
  amountBought: 'Achete',

  notesPlaceholder: 'Notes...',

  savedText: 'Enregistre',
  saveFailedText: 'Echec de la sauvegarde',

  linkedSwapPrefix: 'Echange lie • USD ',

  syncedPrefix: 'synchronise ',
  dataThroughPrefix: "donnees jusqu'au ",
};

const MAP: Record<Lang, OnchainWalletTransactionsLocale> = { en, es, fr };

export function getOnchainWalletTransactions(lang: Lang): OnchainWalletTransactionsLocale {
  return MAP[lang] ?? en;
}
