// Tax page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Tax Review Queue page — page-level strings (EN · ES · FR).
//
// Cookie-based: yearEnd/review.astro reads getLang(Astro.request) and selects
// via getReview(lang). These are the strings the PAGE owns — header, group
// labels, group descriptions, resolution form labels, category options, and
// client-script status messages.
//
// DO NOT translate: US tax form names, tickers, product/company names, $, %,
// or code. Financial CONCEPT words (gains, cost basis, loan, income, airdrop,
// collateral, liquidation) ARE translatable — first-pass only.

import type { Lang } from '@/lib/i18n/locale';

export interface ReviewLocale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  headingPrefix: string; // "Tax Review Queue —" (year appended in template)
  /** subtitle when queue is empty for a year */
  subtitleEmpty: (year: number) => string;
  /** subtitle when items exist */
  subtitleItems: (count: number, year: number) => string;
  yearAriaLabel: string;
  btnYearSummary: string;
  btnReclassify: string;
  // Empty state
  emptyTitle: string;
  emptyText: string;
  emptyCta: string;
  // Reason group labels (emoji stays, translatable text after it)
  reasonLabels: Record<string, string>;
  // Reason group descriptions
  reasonDescs: Record<string, string>;
  // Item form
  autoClassifiedAs: (cat: string) => string;
  labelClassify: string;
  selectPlaceholder: string;
  labelPricePerToken: (date: string) => string;
  priceInputPlaceholder: string;
  labelNote: string;
  notePlaceholder: string;
  btnSave: string;
  // Category options
  categoryOptions: Array<{ value: string; label: string }>;
  // Client-script status messages (injected via define:vars)
  statusRunning: string;
  statusDone: string;
  statusFailed: string;
  statusError: string;
  statusSelectFirst: string;
  statusSaving: string;
  statusSaved: string;
  statusNetworkError: string;
}

export const en: ReviewLocale = {
  lang: 'en',
  pageTitle: 'Tax Review | Almstins',
  backLink: '← Tax Center',
  headingPrefix: 'Tax Review Queue —',
  subtitleEmpty: (year) => `No unresolved items for ${year}.`,
  subtitleItems: (count, year) =>
    `${count} item${count !== 1 ? 's' : ''} need${count === 1 ? 's' : ''} your attention before the ${year} summary is final.`,
  yearAriaLabel: 'Tax year',
  btnYearSummary: '← Year Summary',
  btnReclassify: '🔄 Re-classify All',
  emptyTitle: 'Nothing left to review',
  emptyText: 'Head to the Year Summary for your complete breakdown.',
  emptyCta: 'Open Year Summary →',
  reasonLabels: {
    unmatched_transfer: '📤 Unmatched Transfers',
    possible_loan:      '🏦 Possible Loan Events',
    airdrop_unpriced:   '🪂 Airdrops Without Prices',
    missing_price:      '💲 Missing Prices',
    low_confidence:     '🤔 Low Confidence Classifications',
    unknown_type:       '❓ Unknown Transaction Types',
  },
  reasonDescs: {
    unmatched_transfer:
      "We found coins leaving your wallets/exchanges but couldn't find a matching incoming transfer. Each could be a send to another of your wallets (not taxable), a gift, or a payment/sale.",
    possible_loan:
      'These transactions involve known lending protocols. Auto-classified as loan events (not taxable), but please confirm.',
    airdrop_unpriced:
      'Airdrops are ordinary income at fair market value when received. These need a USD price to calculate your tax liability.',
    missing_price:
      'These taxable events have no USD value recorded. Without a price, gain/loss cannot be calculated.',
    low_confidence:
      "The pipeline classified these but isn't sure. Please confirm or correct.",
    unknown_type:
      "These couldn't be classified automatically. Select the correct type below.",
  },
  autoClassifiedAs: (cat) => `Auto-classified as ${cat} — please confirm`,
  labelClassify: 'Classify as:',
  selectPlaceholder: '— select —',
  labelPricePerToken: (date) => `USD price per token on ${date}:`,
  priceInputPlaceholder: 'e.g. 2450.00',
  labelNote: 'Note (optional):',
  notePlaceholder: "e.g. 'Sent to my Ledger' or 'Aave borrow for ETH purchase'",
  btnSave: 'Save & Resolve',
  categoryOptions: [
    { value: 'buy',                label: 'Buy / Purchase' },
    { value: 'sell',               label: 'Sell' },
    { value: 'swap',               label: 'Swap (crypto-to-crypto)' },
    { value: 'transfer',           label: 'Transfer to my own wallet' },
    { value: 'income',             label: 'Income (staking / rewards / interest)' },
    { value: 'airdrop',            label: 'Airdrop' },
    { value: 'burn',               label: 'Burned / Destroyed' },
    { value: 'lost',               label: 'Lost (documented)' },
    { value: 'loan-proceeds',      label: 'Loan proceeds (not taxable)' },
    { value: 'loan-repayment',     label: 'Loan repayment (not taxable)' },
    { value: 'collateral-deposit', label: 'Collateral deposit (not taxable)' },
    { value: 'liquidation',        label: 'Collateral liquidated (taxable sale)' },
    { value: 'fee',                label: 'Transaction fee / gas' },
    { value: 'nft-sale',           label: 'NFT sale' },
    { value: 'loan-interest-paid', label: 'Loan interest paid (deductible)' },
  ],
  statusRunning: '⏳ Running…',
  statusDone: '✅ Done — reloading…',
  statusFailed: '❌ Failed',
  statusError: '❌ Error',
  statusSelectFirst: 'Please select a category first.',
  statusSaving: 'Saving…',
  statusSaved: '✅ Saved!',
  statusNetworkError: '❌ Network error',
};

export const es: ReviewLocale = {
  lang: 'es',
  pageTitle: 'Revisión Fiscal | Almstins',
  backLink: '← Centro Fiscal',
  headingPrefix: 'Cola de Revisión Fiscal —',
  subtitleEmpty: (year) => `No hay elementos sin resolver para ${year}.`,
  subtitleItems: (count, year) =>
    `${count} elemento${count !== 1 ? "s" : ""} ${count === 1 ? "requiere" : "requieren"} tu atención antes de que el resumen de ${year} sea definitivo.`,
  yearAriaLabel: 'Año fiscal',
  btnYearSummary: '← Resumen Anual',
  btnReclassify: '🔄 Reclasificar Todo',
  emptyTitle: 'No queda nada por revisar',
  emptyText: 'Ve al Resumen Anual para ver tu desglose completo.',
  emptyCta: 'Abrir Resumen Anual →',
  reasonLabels: {
    unmatched_transfer: '📤 Transferencias sin Coincidencia',
    possible_loan:      '🏦 Posibles Eventos de Préstamo',
    airdrop_unpriced:   '🪂 Airdrops sin Precio',
    missing_price:      '💲 Precios Faltantes',
    low_confidence:     '🤔 Clasificaciones de Baja Confianza',
    unknown_type:       '❓ Tipos de Transacción Desconocidos',
  },
  reasonDescs: {
    unmatched_transfer:
      "Encontramos monedas que salieron de tus wallets/exchanges pero no pudimos encontrar una transferencia entrante correspondiente. Cada una podría ser un envío a otra de tus wallets (no gravable), un regalo o un pago/venta.",
    possible_loan:
      "Estas transacciones involucran protocolos de préstamo conocidos. Se clasificaron automáticamente como eventos de préstamo (no gravables), pero por favor confírmalas.",
    airdrop_unpriced:
      "Los airdrops son ingresos ordinarios al valor justo de mercado en el momento de recibirlos. Estos necesitan un precio en USD para calcular tu obligación fiscal.",
    missing_price:
      "Estos eventos gravables no tienen un valor en USD registrado. Sin un precio, no se puede calcular la ganancia/pérdida.",
    low_confidence:
      "El sistema los clasificó pero no con certeza. Por favor confírmalos o corrígelos.",
    unknown_type:
      "Estos no pudieron clasificarse automáticamente. Selecciona el tipo correcto a continuación.",
  },
  autoClassifiedAs: (cat) => `Clasificado automáticamente como ${cat} — por favor confirma`,
  labelClassify: 'Clasificar como:',
  selectPlaceholder: '— selecciona —',
  labelPricePerToken: (date) => `Precio USD por token el ${date}:`,
  priceInputPlaceholder: 'ej. 2450.00',
  labelNote: 'Nota (opcional):',
  notePlaceholder: "ej. \"Enviado a mi Ledger\" o \"Préstamo Aave para compra de ETH\"",
  btnSave: 'Guardar y Resolver',
  categoryOptions: [
    { value: 'buy',                label: 'Compra' },
    { value: 'sell',               label: 'Venta' },
    { value: 'swap',               label: 'Intercambio (cripto a cripto)' },
    { value: 'transfer',           label: 'Transferencia a mi propia wallet' },
    { value: 'income',             label: 'Ingresos (staking / recompensas / intereses)' },
    { value: 'airdrop',            label: 'Airdrop' },
    { value: 'burn',               label: 'Quemado / Destruido' },
    { value: 'lost',               label: 'Pérdida (documentada)' },
    { value: 'loan-proceeds',      label: 'Préstamo recibido (no gravable)' },
    { value: 'loan-repayment',     label: 'Pago de préstamo (no gravable)' },
    { value: 'collateral-deposit', label: 'Depósito de colateral (no gravable)' },
    { value: 'liquidation',        label: 'Colateral liquidado (venta gravable)' },
    { value: 'fee',                label: 'Comisión de transacción / gas' },
    { value: 'nft-sale',           label: 'Venta de NFT' },
    { value: 'loan-interest-paid', label: 'Intereses de préstamo pagados (deducibles)' },
  ],
  statusRunning: '⏳ Ejecutando…',
  statusDone: '✅ Listo — recargando…',
  statusFailed: '❌ Error',
  statusError: '❌ Error',
  statusSelectFirst: 'Por favor selecciona una categoría primero.',
  statusSaving: 'Guardando…',
  statusSaved: '✅ Guardado!',
  statusNetworkError: '❌ Error de red',
};

export const fr: ReviewLocale = {
  lang: 'fr',
  pageTitle: 'Révision Fiscale | Almstins',
  backLink: '← Centre Fiscal',
  headingPrefix: 'File de Révision Fiscale —',
  subtitleEmpty: (year) => `Aucun élément non résolu pour ${year}.`,
  subtitleItems: (count, year) =>
    `${count} élément${count !== 1 ? "s" : ""} ${count === 1 ? "nécessite" : "nécessitent"} votre attention avant que le récapitulatif de ${year} ne soit définitif.`,
  yearAriaLabel: 'Année fiscale',
  btnYearSummary: '← Récapitulatif Annuel',
  btnReclassify: '🔄 Tout Reclassifier',
  emptyTitle: "Plus rien à réviser",
  emptyText: "Rendez-vous au Récapitulatif Annuel pour votre ventilation complète.",
  emptyCta: 'Ouvrir le Récapitulatif Annuel →',
  reasonLabels: {
    unmatched_transfer: '📤 Transferts sans Correspondance',
    possible_loan:      '🏦 Événements de Prêt Possibles',
    airdrop_unpriced:   '🪂 Airdrops sans Prix',
    missing_price:      '💲 Prix Manquants',
    low_confidence:     '🤔 Classifications à Faible Confiance',
    unknown_type:       '❓ Types de Transactions Inconnus',
  },
  reasonDescs: {
    unmatched_transfer:
      "Nous avons trouvé des cryptos quittant vos wallets/exchanges mais n'avons pas pu trouver un transfert entrant correspondant. Chacun pourrait être un envoi vers un autre de vos wallets (non imposable), un don ou un paiement/vente.",
    possible_loan:
      "Ces transactions impliquent des protocoles de prêt connus. Classées automatiquement comme événements de prêt (non imposables), veuillez confirmer.",
    airdrop_unpriced:
      "Les airdrops constituent un revenu ordinaire à la valeur marchande équitable au moment de leur réception. Ceux-ci ont besoin d'un prix en USD pour calculer votre obligation fiscale.",
    missing_price:
      "Ces événements imposables n'ont aucune valeur en USD enregistrée. Sans prix, la plus-value/moins-value ne peut pas être calculée.",
    low_confidence:
      "Le système les a classés mais sans certitude. Veuillez confirmer ou corriger.",
    unknown_type:
      "Ceux-ci n'ont pas pu être classés automatiquement. Sélectionnez le type correct ci-dessous.",
  },
  autoClassifiedAs: (cat) => `Classé automatiquement comme ${cat} — veuillez confirmer`,
  labelClassify: 'Classer comme :',
  selectPlaceholder: '— sélectionner —',
  labelPricePerToken: (date) => `Prix USD par token le ${date} :`,
  priceInputPlaceholder: 'ex. 2450.00',
  labelNote: 'Note (optionnelle) :',
  notePlaceholder: "ex. \"Envoyé à mon Ledger\" ou \"Emprunt Aave pour achat d'ETH\"",
  btnSave: 'Enregistrer et Résoudre',
  categoryOptions: [
    { value: 'buy',                label: 'Achat' },
    { value: 'sell',               label: 'Vente' },
    { value: 'swap',               label: 'Échange (crypto-à-crypto)' },
    { value: 'transfer',           label: 'Transfert vers mon propre wallet' },
    { value: 'income',             label: 'Revenus (staking / récompenses / intérêts)' },
    { value: 'airdrop',            label: 'Airdrop' },
    { value: 'burn',               label: 'Brûlé / Détruit' },
    { value: 'lost',               label: 'Perdu (documenté)' },
    { value: 'loan-proceeds',      label: 'Produit de prêt (non imposable)' },
    { value: 'loan-repayment',     label: 'Remboursement de prêt (non imposable)' },
    { value: 'collateral-deposit', label: 'Dépôt de garantie (non imposable)' },
    { value: 'liquidation',        label: 'Garantie liquidée (vente imposable)' },
    { value: 'fee',                label: 'Frais de transaction / gas' },
    { value: 'nft-sale',           label: 'Vente de NFT' },
    { value: 'loan-interest-paid', label: 'Intérêts de prêt payés (déductibles)' },
  ],
  statusRunning: '⏳ En cours…',
  statusDone: '✅ Terminé — rechargement…',
  statusFailed: '❌ Échec',
  statusError: '❌ Erreur',
  statusSelectFirst: 'Veuillez d\'abord sélectionner une catégorie.',
  statusSaving: 'Enregistrement…',
  statusSaved: '✅ Enregistré !',
  statusNetworkError: '❌ Erreur réseau',
};

const MAP: Record<Lang, ReviewLocale> = { en, es, fr };

/** Select the Review Queue locale for a language, falling back to English. */
export function getReview(lang: Lang): ReviewLocale {
  return MAP[lang] ?? en;
}
