// Tax page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Memory Lane — token lifecycle / annual position history page (EN · ES · FR).
//
// Cookie-based (Phase 3): memory-lane.astro reads getLang(Astro.request) and
// selects via getMemoryLane(lang). Strings are page-level only — child
// components carry their own text. Crypto jargon stays English per
// design.claude.md: wallet, DeFi, Wrapped, tickers, company names.

import type { Lang } from '@/lib/i18n/locale';

export interface MemoryLaneLocale {
  lang: Lang;
  /** "<Layout title>" — e.g. "History 2024 | almsTins" */
  pageTitle: (year: number) => string;
  backLink: string;

  // ── Error / demo ────────────────────────────────────────────────────────────
  errorHeading: string;
  errorRetry: string;
  demoHeading: string;
  demoBody: string;

  // ── Hero ────────────────────────────────────────────────────────────────────
  heroTitle: string;
  heroSubtitle: string;
  yearLabel: string;

  // ── Summary stats ───────────────────────────────────────────────────────────
  statClosed: string;
  /** "Realized P&L · {year}" */
  statRealizedPnl: (year: number) => string;
  statOpen: string;

  // ── Section headings ────────────────────────────────────────────────────────
  sectionClosedTitle: string;
  /** "Assets you fully sold in {year}" */
  sectionClosedSub: (year: number) => string;
  sectionOpenTitle: string;
  sectionOpenSub: string;

  // ── Coin-type group labels ───────────────────────────────────────────────────
  typeL1: string;
  typeStable: string;

  // ── Position card ───────────────────────────────────────────────────────────
  tagClosed: string;
  tagOpen: string;
  labelRealized: string;
  labelUnrealized: string;
  labelUnpriced: string;

  // ── Card stat keys ──────────────────────────────────────────────────────────
  statKeyLots: string;
  statKeyShortTerm: string;
  statKeyLongTerm: string;
  statKeyClosed: string;  // date label on closed card
  statKeyHeld: string;
  statKeyPrice: string;
  statKeyShortTermQty: string;
  statKeyLongTermQty: string;
  statKeyToLongTerm: string;

  // ── CTA buttons ─────────────────────────────────────────────────────────────
  ctaViewTx: string;
  ctaViewLots: string;

  // ── Timeline ────────────────────────────────────────────────────────────────
  /** "{asset} · {n} disposal{s} in {year}" */
  tlHead: (asset: string, n: number, year: number) => string;
  tlBuy: string;
  tlSell: string;
  /** "{n}d held ·" */
  tlHeld: (days: number) => string;
  tlTermLong: string;
  tlTermShort: string;

  // ── Also-sold note (open card) ───────────────────────────────────────────────
  /** "Also sold {n} lot{s} in {year} · {fmtGain} realized" */
  alsoSold: (n: number, year: number, fmtGain: string) => string;

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyTitle: (year: number) => string;
  emptySub: string;
}

export const en: MemoryLaneLocale = {
  lang: 'en',
  pageTitle: (year) => `History ${year} | almsTins`,
  backLink: '← Dashboard',

  errorHeading: 'Could not load History',
  errorRetry: 'Try again',
  demoHeading: 'Your full position history.',
  demoBody:
    'Every asset you\'ve held — what you paid, what you realized, and the complete transaction trail behind each one. This view uses demo data.',

  heroTitle: 'History',
  heroSubtitle: 'Every asset you\'ve held — and the full transaction history behind each one.',
  yearLabel: 'Year',

  statClosed: 'Closed positions',
  statRealizedPnl: (year) => `Realized P&L · ${year}`,
  statOpen: 'Open positions',

  sectionClosedTitle: 'Closed Positions',
  sectionClosedSub: (year) => `Assets you fully sold in ${year}`,
  sectionOpenTitle: 'Open Positions',
  sectionOpenSub: 'Assets you currently hold',

  typeL1: 'Layer 1',
  typeStable: 'Stablecoins',

  tagClosed: 'Closed',
  tagOpen: 'Open',
  labelRealized: 'realized',
  labelUnrealized: 'unrealized',
  labelUnpriced: 'Unpriced',

  statKeyLots: 'Lots',
  statKeyShortTerm: 'Short-term',
  statKeyLongTerm: 'Long-term',
  statKeyClosed: 'Closed',
  statKeyHeld: 'Held',
  statKeyPrice: 'Price',
  statKeyShortTermQty: 'Short-term qty',
  statKeyLongTermQty: 'Long-term qty',
  statKeyToLongTerm: 'To long-term',

  ctaViewTx: 'View transactions ▾',
  ctaViewLots: 'View sold lots ▾',

  tlHead: (asset, n, year) => `${asset} · ${n} disposal${n !== 1 ? 's' : ''} in ${year}`,
  tlBuy: 'Buy',
  tlSell: 'Sell',
  tlHeld: (days) => `${days}d held ·`,
  tlTermLong: 'Long-term',
  tlTermShort: 'Short-term',

  alsoSold: (n, year, fmtGain) =>
    `Also sold ${n} lot${n !== 1 ? 's' : ''} in ${year} · ${fmtGain} realized`,

  emptyTitle: (year) => `No history for ${year}`,
  emptySub: 'Select a different year above, or make sure your transactions are synced.',
};

export const es: MemoryLaneLocale = {
  lang: 'es',
  pageTitle: (year) => `Historial ${year} | almsTins`,
  backLink: '← Panel',

  errorHeading: 'No se pudo cargar el historial',
  errorRetry: 'Intentar de nuevo',
  demoHeading: 'Tu historial completo de posiciones.',
  demoBody:
    'Cada activo que has tenido — lo que pagaste, lo que realizaste y el rastro completo de transacciones detrás de cada uno. Esta vista usa datos de demostración.',

  heroTitle: 'Historial',
  heroSubtitle: 'Todos los activos que has tenido — y el historial completo de transacciones detrás de cada uno.',
  yearLabel: 'Año',

  statClosed: 'Posiciones cerradas',
  statRealizedPnl: (year) => `P&G realizado · ${year}`,
  statOpen: 'Posiciones abiertas',

  sectionClosedTitle: 'Posiciones cerradas',
  sectionClosedSub: (year) => `Activos que vendiste completamente en ${year}`,
  sectionOpenTitle: 'Posiciones abiertas',
  sectionOpenSub: 'Activos que tienes actualmente',

  typeL1: 'Capa 1',
  typeStable: 'Stablecoins',

  tagClosed: 'Cerrada',
  tagOpen: 'Abierta',
  labelRealized: 'realizado',
  labelUnrealized: 'no realizado',
  labelUnpriced: 'Sin precio',

  statKeyLots: 'Lotes',
  statKeyShortTerm: 'Corto plazo',
  statKeyLongTerm: 'Largo plazo',
  statKeyClosed: 'Cerrada',
  statKeyHeld: 'En cartera',
  statKeyPrice: 'Precio',
  statKeyShortTermQty: 'Cant. corto plazo',
  statKeyLongTermQty: 'Cant. largo plazo',
  statKeyToLongTerm: 'Hasta largo plazo',

  ctaViewTx: 'Ver transacciones ▾',
  ctaViewLots: 'Ver lotes vendidos ▾',

  tlHead: (asset, n, year) => `${asset} · ${n} disposición${n !== 1 ? 'es' : ''} en ${year}`,
  tlBuy: 'Compra',
  tlSell: 'Venta',
  tlHeld: (days) => `${days}d en cartera ·`,
  tlTermLong: 'Largo plazo',
  tlTermShort: 'Corto plazo',

  alsoSold: (n, year, fmtGain) =>
    `También vendiste ${n} lote${n !== 1 ? 's' : ''} en ${year} · ${fmtGain} realizado`,

  emptyTitle: (year) => `Sin historial para ${year}`,
  emptySub: 'Selecciona un año diferente arriba, o asegúrate de que tus transacciones estén sincronizadas.',
};

export const fr: MemoryLaneLocale = {
  lang: 'fr',
  pageTitle: (year) => `Historique ${year} | almsTins`,
  backLink: '← Tableau de bord',

  errorHeading: "Impossible de charger l'historique",
  errorRetry: 'Réessayer',
  demoHeading: 'Votre historique complet de positions.',
  demoBody:
    "Chaque actif que vous avez détenu — ce que vous avez payé, ce que vous avez réalisé et la trace complète des transactions derrière chacun. Cette vue utilise des données de démonstration.",

  heroTitle: 'Historique',
  heroSubtitle: 'Tous les actifs que vous avez détenus — et l\'historique complet des transactions derrière chacun.',
  yearLabel: 'Année',

  statClosed: 'Positions fermées',
  statRealizedPnl: (year) => `P&P réalisés · ${year}`,
  statOpen: 'Positions ouvertes',

  sectionClosedTitle: 'Positions fermées',
  sectionClosedSub: (year) => `Actifs entièrement vendus en ${year}`,
  sectionOpenTitle: 'Positions ouvertes',
  sectionOpenSub: 'Actifs que vous détenez actuellement',

  typeL1: 'Couche 1',
  typeStable: 'Stablecoins',

  tagClosed: 'Fermée',
  tagOpen: 'Ouverte',
  labelRealized: 'réalisé',
  labelUnrealized: 'non réalisé',
  labelUnpriced: 'Sans prix',

  statKeyLots: 'Lots',
  statKeyShortTerm: 'Court terme',
  statKeyLongTerm: 'Long terme',
  statKeyClosed: 'Fermée',
  statKeyHeld: 'Détenu',
  statKeyPrice: 'Prix',
  statKeyShortTermQty: 'Qté court terme',
  statKeyLongTermQty: 'Qté long terme',
  statKeyToLongTerm: 'Jusqu\'au long terme',

  ctaViewTx: 'Voir les transactions ▾',
  ctaViewLots: 'Voir les lots vendus ▾',

  tlHead: (asset, n, year) => `${asset} · ${n} cession${n !== 1 ? 's' : ''} en ${year}`,
  tlBuy: 'Achat',
  tlSell: 'Vente',
  tlHeld: (days) => `${days}j détenu ·`,
  tlTermLong: 'Long terme',
  tlTermShort: 'Court terme',

  alsoSold: (n, year, fmtGain) =>
    `Également vendu ${n} lot${n !== 1 ? 's' : ''} en ${year} · ${fmtGain} réalisé`,

  emptyTitle: (year) => `Aucun historique pour ${year}`,
  emptySub: 'Sélectionnez une autre année ci-dessus, ou vérifiez que vos transactions sont bien synchronisées.',
};

const MAP: Record<Lang, MemoryLaneLocale> = { en, es, fr };

/** Select the Memory Lane locale for a language, falling back to English. */
export function getMemoryLane(lang: Lang): MemoryLaneLocale {
  return MAP[lang] ?? en;
}
