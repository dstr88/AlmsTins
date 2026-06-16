// NetWorthTable (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface NetWorthTableLocale {
  lang: Lang;

  // Loading / error / empty states
  loading: string;
  noSnapshots: string;

  // Aggregate section
  aggregateLabel: string;
  /** Interpolated: tinCount tins in the ecosystem description */
  tinCountDescription: (tinCount: number) => string;

  // By-tin section
  byTinHeading: string;
  byTinSubtitle: string;

  // Table column headers
  colTin: string;
  colTotalUsd: string;
  colPerChain: string;

  // Donut chart
  donutNoData: string;
  donutCenterLine1: string;
  donutCenterLine3: string;
  /** Interpolated: "X% of portfolio" — receives the formatted percentage string e.g. "42.3" */
  donutSelectedPct: (pct: string) => string;
}

export const en: NetWorthTableLocale = {
  lang: 'en',

  loading: 'Loading net worth…',
  noSnapshots: 'No snapshots yet. Run the wallet value sync to populate net worth.',

  aggregateLabel: 'Aggregate net worth',
  tinCountDescription: (tinCount) =>
    `${tinCount} ${tinCount === 1 ? 'tin' : 'tins'} in the ecosystem — on-chain wallets, exchanges, and custom accounts.`,

  byTinHeading: 'By tin',
  byTinSubtitle: 'Latest balances and per-chain contributions.',

  colTin: 'Tin',
  colTotalUsd: 'Total USD',
  colPerChain: 'Per chain',

  donutNoData: 'No data',
  donutCenterLine1: 'Portfolio overview',
  donutCenterLine3: 'Tap a segment for details',
  donutSelectedPct: (pct) => `${pct}% of portfolio`,
};

export const es: NetWorthTableLocale = {
  lang: 'es',

  loading: "Cargando patrimonio neto…",
  noSnapshots: "Aún no hay instantáneas. Ejecuta la sincronización de valor de cartera para ver el patrimonio neto.",

  aggregateLabel: "Patrimonio neto total",
  tinCountDescription: (tinCount) =>
    `${tinCount} ${tinCount === 1 ? 'tin' : 'tins'} en el ecosistema — carteras en cadena, exchanges y cuentas personalizadas.`,

  byTinHeading: "Por tin",
  byTinSubtitle: "Últimos saldos y contribuciones por cadena.",

  colTin: "Tin",
  colTotalUsd: "Total USD",
  colPerChain: "Por cadena",

  donutNoData: "Sin datos",
  donutCenterLine1: "Resumen del portafolio",
  donutCenterLine3: "Toca un segmento para ver detalles",
  donutSelectedPct: (pct) => `${pct}% del portafolio`,
};

export const fr: NetWorthTableLocale = {
  lang: 'fr',

  loading: "Chargement du patrimoine net…",
  noSnapshots: "Aucun instantané pour l'instant. Lancez la synchronisation de la valeur du portefeuille pour afficher le patrimoine net.",

  aggregateLabel: "Patrimoine net total",
  tinCountDescription: (tinCount) =>
    `${tinCount} ${tinCount === 1 ? 'tin' : 'tins'} dans l'écosystème — portefeuilles on-chain, exchanges et comptes personnalisés.`,

  byTinHeading: "Par tin",
  byTinSubtitle: "Derniers soldes et contributions par chaîne.",

  colTin: "Tin",
  colTotalUsd: "Total USD",
  colPerChain: "Par chaîne",

  donutNoData: "Aucune donnée",
  donutCenterLine1: "Aperçu du portefeuille",
  donutCenterLine3: "Appuyez sur un segment pour les détails",
  donutSelectedPct: (pct) => `${pct}% du portefeuille`,
};

const MAP: Record<Lang, NetWorthTableLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getNetWorthTable(lang: Lang): NetWorthTableLocale {
  return MAP[lang] ?? en;
}
