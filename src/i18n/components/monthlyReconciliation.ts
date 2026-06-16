// MonthlyReconciliation (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface MonthlyReconciliationLocale {
  lang: Lang;

  // Month selector / recompute button
  computing: string;
  recompute: string;

  // Checkbook row labels
  openingBalance: string;
  inflows: string;
  outflows: string;
  matchedTransfers: string;
  expectedClosing: string;
  actualClosing: string;
  delta: string;

  // Unmatched transfer warning
  unmatchedWarning: (count: number) => string;
  unmatchedOut: (amount: string) => string;
  unmatchedIn: (amount: string) => string;

  // Per-asset breakdown toggle
  hideBreakdown: string;
  showBreakdown: string;
  assetBreakdownSuffix: (count: number) => string;

  // Asset table column headers
  colAsset: string;
  colIn: string;
  colOut: string;
  colGap: string;

  // Footer
  txFooter: (count: number) => string;

  // Empty state
  noData: string;

  // Locale tag for month name formatting (Intl)
  dateLocale: string;
}

export const en: MonthlyReconciliationLocale = {
  lang: 'en',

  computing: 'Computing…',
  recompute: '↻ Recompute',

  openingBalance: 'Opening balance',
  inflows: '+ Inflows (buys, income)',
  outflows: '− Outflows (sells, fees)',
  matchedTransfers: '± Matched transfers (net)',
  expectedClosing: 'Expected closing',
  actualClosing: 'Actual closing (wallets)',
  delta: 'Delta (price change + gaps)',

  unmatchedWarning: (count) =>
    `${count} unmatched transfer${count !== 1 ? 's' : ''} — data gap detected`,
  unmatchedOut: (amount) =>
    `Sent out with no inbound record: ${amount} — transaction may have disappeared from source data`,
  unmatchedIn: (amount) =>
    `Received with no outbound record: ${amount} — check if source wallet/exchange is connected`,

  hideBreakdown: '▲ Hide',
  showBreakdown: '▼ Show',
  assetBreakdownSuffix: (count) => ` asset breakdown (${count})`,

  colAsset: 'Asset',
  colIn: 'In',
  colOut: 'Out',
  colGap: 'Gap',

  txFooter: (count) => `${count} transactions · snapshots from wallet sync`,

  noData: 'No data for this month.',

  dateLocale: 'en-US',
};

export const es: MonthlyReconciliationLocale = {
  lang: 'es',

  computing: "Calculando…",
  recompute: "↻ Recalcular",

  openingBalance: "Saldo inicial",
  inflows: "+ Entradas (compras, ingresos)",
  outflows: "− Salidas (ventas, comisiones)",
  matchedTransfers: "± Transferencias emparejadas (neto)",
  expectedClosing: "Cierre esperado",
  actualClosing: "Cierre real (carteras)",
  delta: "Delta (cambio de precio + diferencias)",

  unmatchedWarning: (count) =>
    `${count} transferencia${count !== 1 ? "s" : ""} sin emparejar — diferencia de datos detectada`,
  unmatchedOut: (amount) =>
    `Enviado sin registro de entrada: ${amount} — la transacción puede haber desaparecido de los datos de origen`,
  unmatchedIn: (amount) =>
    `Recibido sin registro de salida: ${amount} — verifica si la cartera/exchange de origen está conectado`,

  hideBreakdown: "▲ Ocultar",
  showBreakdown: "▼ Mostrar",
  assetBreakdownSuffix: (count) => ` desglose de activos (${count})`,

  colAsset: "Activo",
  colIn: "Entrada",
  colOut: "Salida",
  colGap: "Diferencia",

  txFooter: (count) => `${count} transacciones · instantáneas de sincronización de carteras`,

  noData: "Sin datos para este mes.",

  dateLocale: 'es-ES',
};

export const fr: MonthlyReconciliationLocale = {
  lang: 'fr',

  computing: "Calcul en cours…",
  recompute: "↻ Recalculer",

  openingBalance: "Solde initial",
  inflows: "+ Entrées (achats, revenus)",
  outflows: "− Sorties (ventes, frais)",
  matchedTransfers: "± Transferts associés (net)",
  expectedClosing: "Clôture attendue",
  actualClosing: "Clôture réelle (portefeuilles)",
  delta: "Delta (variation de prix + écarts)",

  unmatchedWarning: (count) =>
    `${count} transfert${count !== 1 ? "s" : ""} non associé${count !== 1 ? "s" : ""} — écart de données détecté`,
  unmatchedOut: (amount) =>
    `Envoyé sans enregistrement entrant : ${amount} — la transaction a peut-être disparu des données sources`,
  unmatchedIn: (amount) =>
    `Reçu sans enregistrement sortant : ${amount} — vérifiez si le portefeuille/exchange source est connecté`,

  hideBreakdown: "▲ Masquer",
  showBreakdown: "▼ Afficher",
  assetBreakdownSuffix: (count) => ` répartition des actifs (${count})`,

  colAsset: "Actif",
  colIn: "Entrée",
  colOut: "Sortie",
  colGap: "Écart",

  txFooter: (count) => `${count} transactions · instantanés de synchronisation des portefeuilles`,

  noData: "Aucune donnée pour ce mois.",

  dateLocale: 'fr-FR',
};

const MAP: Record<Lang, MonthlyReconciliationLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getMonthlyReconciliation(lang: Lang): MonthlyReconciliationLocale {
  return MAP[lang] ?? en;
}
