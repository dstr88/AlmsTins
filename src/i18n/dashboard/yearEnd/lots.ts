// Tax page — finance terminology (Form 8949, Schedule D, cost basis, lots, gains…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Lot Manager page — page-level strings (EN · ES · FR).
//
// What stays English: Form 8949, Schedule D, FIFO, "lot" (kept as-is per instructions),
// IRS, Rev. Rul. 2024-28, "Spec ID"/"Specific ID", asset tickers, "Automatic".
// Translatable finance concepts: gain/loss, proceeds, cost basis, holding period,
// short-term/long-term, disposal, acquired, purchase, pinned.

import type { Lang } from '@/lib/i18n/locale';

export interface LotsLocale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  heading: string;
  viewResults: string;
  subtitle: string;
  /** "No disposals for {year}" */
  emptyTitle: (year: number) => string;
  emptySub: string;
  needsAttention: string;
  /** "{n} disposal" / "{n} disposals" */
  disposalCount: (n: number) => string;
  /** "Sold {date}" — hero coin date label */
  soldOn: (date: string) => string;
  noPurchaseRecord: string;
  whichLotLabel: string;
  /** "No open lots acquired before {date} — …" */
  noLotsBeforeDate: (date: string) => string;
  chooseLotPlaceholder: string;
  /** "acquired {date}" — inside <option> text */
  acquiredOn: (date: string) => string;
  longTerm: string;
  shortTerm: string;
  save: string;
  /** "{n} resolved disposal" / "{n} resolved disposals — show" */
  resolvedToggle: (n: number) => string;
  /** "Sold {qty} {asset}" — disposal headline prefix */
  soldQtyAsset: (qty: string, asset: string) => string;
  /** "for {proceeds}" — disposal headline suffix */
  forProceeds: (proceeds: string) => string;
  /** "lot acquired {date}" — in disposal meta */
  lotAcquiredOn: (date: string) => string;
  overrideLotLabel: string;
  automaticOption: string;
  irsNoticeTitle: string;
  irsNoticeBody: string;
  /** Script strings */
  saving: string;
  pinned: string;
  networkError: string;
}

export const en: LotsLocale = {
  lang: 'en',
  pageTitle: 'Lot Manager | Almstins',
  backLink: '← Back to Gains Summary',
  heading: 'Lot Manager',
  viewResults: 'View Results →',
  subtitle:
    'Choose which lot you sold for each disposal. Pins are used when <strong>Specific ID</strong> is your cost basis method.',
  emptyTitle: (year) => `No disposals for ${year}`,
  emptySub: 'Switch to a year with transactions.',
  needsAttention: 'Needs attention',
  disposalCount: (n) => `${n} disposal${n !== 1 ? 's' : ''}`,
  soldOn: (date) => `Sold ${date}`,
  noPurchaseRecord:
    'No purchase record found — select the lot you sold to fix the gain/loss calculation.',
  whichLotLabel: 'Which lot did you sell?',
  noLotsBeforeDate: (date) =>
    `No open lots acquired before ${date} — the purchase may not be imported yet.`,
  chooseLotPlaceholder: '— choose a lot —',
  acquiredOn: (date) => `acquired ${date}`,
  longTerm: 'Long-term',
  shortTerm: 'Short-term',
  save: 'Save',
  resolvedToggle: (n) => `${n} resolved disposal${n !== 1 ? 's' : ''} — show`,
  soldQtyAsset: (qty, asset) => `Sold ${qty} ${asset}`,
  forProceeds: (proceeds) => ` for ${proceeds}`,
  lotAcquiredOn: (date) => `lot acquired ${date}`,
  overrideLotLabel: 'Override lot:',
  automaticOption: 'Automatic (earliest purchase first)',
  irsNoticeTitle: 'IRS Specific Identification rules',
  irsNoticeBody:
    'You must identify the lot <em>before or at the time of sale</em> and receive confirmation from your exchange or broker. Lot pins here are for computational purposes — maintain separate documentation (exchange confirmations, wallet records) as required by IRS Rev. Rul. 2024-28.',
  saving: 'Saving…',
  pinned: '✓ Pinned',
  networkError: '❌ Network error',
};

export const es: LotsLocale = {
  lang: 'es',
  pageTitle: 'Gestor de Lotes | Almstins',
  backLink: '← Volver al Resumen de Ganancias',
  heading: 'Gestor de Lotes',
  viewResults: 'Ver resultados →',
  subtitle:
    'Elige qué lote vendiste en cada disposición. Los pines se usan cuando <strong>Identificación Específica</strong> es tu método de base de coste.',
  emptyTitle: (year) => `Sin disposiciones para ${year}`,
  emptySub: 'Cambia a un año con transacciones.',
  needsAttention: 'Requiere atención',
  disposalCount: (n) => `${n} disposición${n !== 1 ? 'es' : ''}`,
  soldOn: (date) => `Vendido el ${date}`,
  noPurchaseRecord:
    'No se encontró registro de compra — selecciona el lote que vendiste para corregir el cálculo de ganancias/pérdidas.',
  whichLotLabel: '¿Qué lote vendiste?',
  noLotsBeforeDate: (date) =>
    `No hay lotes abiertos adquiridos antes del ${date} — es posible que la compra aún no esté importada.`,
  chooseLotPlaceholder: '— elige un lote —',
  acquiredOn: (date) => `adquirido el ${date}`,
  longTerm: 'Largo plazo',
  shortTerm: 'Corto plazo',
  save: 'Guardar',
  resolvedToggle: (n) => `${n} disposición${n !== 1 ? 'es' : ''} resuelta${n !== 1 ? 's' : ''} — mostrar`,
  soldQtyAsset: (qty, asset) => `Vendido ${qty} ${asset}`,
  forProceeds: (proceeds) => ` por ${proceeds}`,
  lotAcquiredOn: (date) => `lote adquirido el ${date}`,
  overrideLotLabel: 'Cambiar lote:',
  automaticOption: 'Automático (primera compra primero)',
  irsNoticeTitle: 'Reglas de Identificación Específica del IRS',
  irsNoticeBody:
    'Debes identificar el lote <em>antes o en el momento de la venta</em> y recibir confirmación de tu exchange o bróker. Los pines de lote aquí son para fines computacionales — mantén documentación separada (confirmaciones del exchange, registros de wallet) según lo exige IRS Rev. Rul. 2024-28.',
  saving: 'Guardando…',
  pinned: '✓ Fijado',
  networkError: '❌ Error de red',
};

export const fr: LotsLocale = {
  lang: 'fr',
  pageTitle: 'Gestionnaire de Lots | Almstins',
  backLink: '← Retour au Résumé des Plus-values',
  heading: 'Gestionnaire de Lots',
  viewResults: 'Voir les résultats →',
  subtitle:
    "Choisissez quel lot vous avez vendu pour chaque cession. Les épingles sont utilisées quand <strong>Identification Spécifique</strong> est votre méthode de coût de base.",
  emptyTitle: (year) => `Aucune cession pour ${year}`,
  emptySub: 'Passez à une année avec des transactions.',
  needsAttention: 'Nécessite attention',
  disposalCount: (n) => `${n} cession${n !== 1 ? 's' : ''}`,
  soldOn: (date) => `Vendu le ${date}`,
  noPurchaseRecord:
    "Aucun enregistrement d'achat trouvé — sélectionnez le lot vendu pour corriger le calcul de la plus-value/moins-value.",
  whichLotLabel: 'Quel lot avez-vous vendu ?',
  noLotsBeforeDate: (date) =>
    `Aucun lot ouvert acquis avant le ${date} — l'achat n'est peut-être pas encore importé.`,
  chooseLotPlaceholder: '— choisir un lot —',
  acquiredOn: (date) => `acquis le ${date}`,
  longTerm: 'Long terme',
  shortTerm: 'Court terme',
  save: 'Enregistrer',
  resolvedToggle: (n) => `${n} cession${n !== 1 ? 's' : ''} résolue${n !== 1 ? 's' : ''} — afficher`,
  soldQtyAsset: (qty, asset) => `Vendu ${qty} ${asset}`,
  forProceeds: (proceeds) => ` pour ${proceeds}`,
  lotAcquiredOn: (date) => `lot acquis le ${date}`,
  overrideLotLabel: 'Remplacer le lot :',
  automaticOption: "Automatique (premier achat d'abord)",
  irsNoticeTitle: "Règles d'Identification Spécifique de l'IRS",
  irsNoticeBody:
    "Vous devez identifier le lot <em>avant ou au moment de la vente</em> et recevoir une confirmation de votre exchange ou courtier. Les épingles de lot ici sont à des fins de calcul — conservez une documentation séparée (confirmations d'exchange, enregistrements de wallet) comme requis par IRS Rev. Rul. 2024-28.",
  saving: 'Enregistrement…',
  pinned: '✓ Épinglé',
  networkError: '❌ Erreur réseau',
};

const MAP: Record<Lang, LotsLocale> = { en, es, fr };

/** Select the Lot Manager locale for a language, falling back to English. */
export function getLots(lang: Lang): LotsLocale {
  return MAP[lang] ?? en;
}
