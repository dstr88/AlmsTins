// Tax page — finance terminology (Form 8949, cost basis, proceeds, gains…) is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Form 8949 page — page-level strings (EN · ES · FR).
//
// Cookie-based: form8949.astro reads getLang(Astro.request) and selects
// via getForm8949(lang). These are the strings the PAGE owns — header labels,
// button text, state messages, summary card labels, and client-script strings
// passed via define:vars / JSON-island.
//
// DO NOT translate: Form 8949, Schedule D, Box A–F, IRS column headers
// ((a)–(h)), FIFO/HIFO/LIFO/Spec ID, 1099-B, TurboTax, tickers, $, %, or code.
// Financial concept words (proceeds, cost basis, gain, loss, disposal, pipeline)
// ARE translatable — first-pass only.

import type { Lang } from '@/lib/i18n/locale';

export interface Form8949Locale {
  lang: Lang;
  pageTitle: string;
  backLink: string;
  heroTitle: string;
  heroSubtitle: string;
  btnLoad: string;
  btnCsv: string;
  btnPrint: string;
  // Loading / error states
  stateLoading: string;
  errLoadFailed: string;
  errNetwork: string;
  // Empty state — static HTML
  emptyTitle: string;
  emptyContext: string;
  emptyWhatLabel: string;
  diagPipelineStrong: string;
  diagPipelineText: string;
  diagMissingBuyText: string;
  diagNoDataText: string;
  emptyTokensLabel: string;
  btnReviewQueue: string;
  btnImport: string;
  btnPipeline: string;
  // Summary cards
  cardProceeds: string;
  cardBasis: string;
  cardNetGain: string;
  // BO warning
  boWarningText: string;
  boWarningLinkText: string;
  boWarningTail: string;
  // Client-script dynamic strings (injected via define:vars)
  /** "No transactions were found for {year}. Import transactions…" — built with year interpolated in JS */
  ctxNoImports: string;
  /** "AlmsTins found transactions for {year} but the classification pipeline hasn't run yet…" */
  ctxPipelineNotRun: string;
  /** suffix for ctxAffected: " coin" (singular) */
  ctxCoinSingular: string;
  /** suffix for ctxAffected: " coins" (plural) */
  ctxCoinPlural: string;
  /** "has" (singular) used in affected-assets sentence */
  ctxHasSingular: string;
  /** "have" (plural) used in affected-assets sentence */
  ctxHavePlural: string;
  /** "unresolved transaction" (singular) */
  ctxTxSingular: string;
  /** "unresolved transactions" (plural) */
  ctxTxPlural: string;
  /** suffix: "These must be fixed before this summary is complete." */
  ctxMustFix: string;
  /** "The pipeline ran but found no taxable disposals for {year}…" */
  ctxNone: string;
  // Diagnostic bullet strong labels
  diagPipelineNotRunStrong: string;
  diagPipelineNotRunText: string;
  diagNoBuyStrong: string;
  /** connector between sell count and coin list in no-buy bullet */
  diagNoBuyConnector: string;
  diagNoBuyTail: string;
  diagNoBasisStrong: string;
  diagNoBasisConnector: string;
  diagNoBasisTail: string;
  diagNoDisposalsStrong: string;
  diagNoDisposalsTail: string;
  diagNoFoundStrong: string;
  diagNoFoundTail: string;
  // Action button dynamic labels
  /** "Import Transactions — add data for {year}" */
  importBtnLabel: string;
  /** "⚙️ Run Pipeline — after importing" */
  pipelineAfterImport: string;
  /** "⚙️ Run Pipeline — classify transactions for {year}" */
  pipelineClassify: string;
  /** "⚙️ Re-run Pipeline — after adding missing records" */
  pipelineRerunMissing: string;
  /** "⚙️ Re-run Pipeline — after fixing missing prices" */
  pipelineRerunPrices: string;
  /** "🔍 Review Queue — find the missing buys for {n} sell(s)" */
  reviewNoBuy: string;
  /** "🔍 Review Queue — enter purchase prices for {n} lot(s)" */
  reviewNoBasis: string;
  // Row-count note suffix: "transaction" / "transactions · See Schedule D for totals"
  rowCountSingular: string;
  rowCountPlural: string;
  // Chip badges
  chipNoBuy: string;
  chipNoPrice: string;
  // IRS header (printed form header — shown on screen as well)
  irsHeaderBadge: string;
  irsHeaderTitle: string;
  irsHeaderDesc: string;
  irsHeaderDisclaimer: string;
  irsHeaderTaxYear: string;
  irsHeaderMethod: string;
  irsHeaderPreparedBy: string;
  // Note below box checkboxes
  boxNoteTemplate: string;
  // Table totals row prefix
  totalsPrefix: string;
}

export const en: Form8949Locale = {
  lang: 'en',
  pageTitle: 'Form 8949 | Almstins',
  backLink: '← Tax Center',
  heroTitle: 'Capital Gains Summary',
  heroSubtitle: 'A US-style gain/loss summary, formatted to mirror IRS Form 8949 for your reference.',
  btnLoad: 'Load',
  btnCsv: '↓ CSV',
  btnPrint: '🖨 Print',
  stateLoading: 'Loading Form 8949…',
  errLoadFailed: 'Failed to load form data.',
  errNetwork: 'Network error — please try again.',
  emptyTitle: 'No classified disposals found for this year',
  emptyContext: 'AlmsTins found transactions for this year but none have been matched into taxable disposal lots yet.',
  emptyWhatLabel: 'What this usually means',
  diagPipelineStrong: 'Pipeline not run',
  diagPipelineText: '— transactions need to be classified before lots can be matched',
  diagMissingBuyText: 'A sell transaction exists but the matching buy is missing — check the Review Queue',
  diagNoDataText: 'No transactions were imported for this year yet',
  emptyTokensLabel: 'Tokens with unresolved transactions this year',
  btnReviewQueue: '🔍 Open Review Queue',
  btnImport: '📥 Import Transactions',
  btnPipeline: '⚙️ Run Classification Pipeline',
  cardProceeds: 'Total Proceeds',
  cardBasis: 'Total Basis',
  cardNetGain: 'Net Gain / (Loss)',
  boWarningText: '⚠ Some rows are marked BO (basis not reported). These are transactions where no cost basis was recorded. Review your',
  boWarningLinkText: 'Review Queue',
  boWarningTail: ' to resolve missing basis before you rely on these figures.',
  ctxNoImports: 'No transactions were found for {year}. Import transactions for your wallets or exchanges first, then re-run the pipeline.',
  ctxPipelineNotRun: 'AlmsTins found transactions for {year} but the classification pipeline hasn\'t run yet. Run the pipeline from the Tax Center to match buys and sells into taxable lots.',
  ctxCoinSingular: ' coin',
  ctxCoinPlural: ' coins',
  ctxHasSingular: 'has',
  ctxHavePlural: 'have',
  ctxTxSingular: 'unresolved transaction',
  ctxTxPlural: 'unresolved transactions',
  ctxMustFix: 'These must be fixed before this summary is complete.',
  ctxNone: 'The pipeline ran but found no taxable disposals for {year}. If you didn\'t sell any crypto this year that\'s expected — otherwise check your imports.',
  diagPipelineNotRunStrong: 'Pipeline not run',
  diagPipelineNotRunText: ' — transactions exist for {year} but haven\'t been classified into taxable lots yet',
  diagNoBuyStrong: '{n} sell{s} with no matching purchase record',
  diagNoBuyConnector: ' — ',
  diagNoBuyTail: ' · the buy transaction is either missing from your imports or happened on a platform you haven\'t connected yet',
  diagNoBasisStrong: '{n} lot{s} missing purchase price or date',
  diagNoBasisConnector: ' — ',
  diagNoBasisTail: ' · the buy was found but its USD value at purchase time is unknown',
  diagNoDisposalsStrong: 'No disposals in {year}',
  diagNoDisposalsTail: ' — the pipeline ran successfully but found no sells, swaps, or trades to report',
  diagNoFoundStrong: 'No transactions found for {year}',
  diagNoFoundTail: ' — nothing has been imported for this year yet',
  importBtnLabel: '📥 Import Transactions — add data for {year}',
  pipelineAfterImport: '⚙️ Run Pipeline — after importing',
  pipelineClassify: '⚙️ Run Pipeline — classify transactions for {year}',
  pipelineRerunMissing: '⚙️ Re-run Pipeline — after adding missing records',
  pipelineRerunPrices: '⚙️ Re-run Pipeline — after fixing missing prices',
  reviewNoBuy: '🔍 Review Queue — find the missing buys for {n} sell{s}',
  reviewNoBasis: '🔍 Review Queue — enter purchase prices for {n} lot{s}',
  rowCountSingular: 'transaction',
  rowCountPlural: 'transactions · See Schedule D for totals',
  chipNoBuy: '⚠ no purchase record',
  chipNoPrice: '⚠ missing price',
  irsHeaderBadge: 'Informational summary — not for filing',
  irsHeaderTitle: 'Capital Gains Summary',
  irsHeaderDesc: 'Realized gains and losses, formatted to mirror IRS Form 8949 for reference',
  irsHeaderDisclaimer: 'Not a tax filing or tax advice — confirm with your tax professional',
  irsHeaderTaxYear: 'Tax Year:',
  irsHeaderMethod: 'Method:',
  irsHeaderPreparedBy: 'Prepared by Almstins — not an IRS-issued form',
  boxNoteTemplate: 'Note: Crypto transactions are reported in Box {box} ("all other") because exchanges were not required to issue 1099-B for these transactions.',
  totalsPrefix: 'Totals (Box {box})',
};

export const es: Form8949Locale = {
  lang: 'es',
  pageTitle: 'Resumen de ganancias de capital | Almstins',
  backLink: '← Centro fiscal',
  heroTitle: 'Resumen de ganancias de capital',
  heroSubtitle: 'Resumen de ganancias y pérdidas al estilo estadounidense, con formato similar al Formulario 8949 del IRS para tu referencia.',
  btnLoad: 'Cargar',
  btnCsv: '↓ CSV',
  btnPrint: '🖨 Imprimir',
  stateLoading: 'Cargando Form 8949…',
  errLoadFailed: 'No se pudieron cargar los datos del formulario.',
  errNetwork: 'Error de red — por favor, inténtalo de nuevo.',
  emptyTitle: 'No se encontraron disposiciones clasificadas para este año',
  emptyContext: 'AlmsTins encontró transacciones para este año pero ninguna ha sido emparejada en lotes de disposición imponible todavía.',
  emptyWhatLabel: 'Qué significa normalmente',
  diagPipelineStrong: 'Pipeline no ejecutado',
  diagPipelineText: '— las transacciones deben clasificarse antes de que los lotes puedan emparejarse',
  diagMissingBuyText: 'Existe una transacción de venta pero la compra correspondiente falta — revisa la cola de revisión',
  diagNoDataText: 'No se importaron transacciones para este año todavía',
  emptyTokensLabel: 'Tokens con transacciones sin resolver este año',
  btnReviewQueue: '🔍 Abrir cola de revisión',
  btnImport: '📥 Importar transacciones',
  btnPipeline: '⚙️ Ejecutar pipeline de clasificación',
  cardProceeds: 'Total de ingresos',
  cardBasis: 'Base de coste total',
  cardNetGain: 'Ganancia / (pérdida) neta',
  boWarningText: '⚠ Algunas filas están marcadas como BO (base no reportada). Son transacciones sin base de coste registrada. Revisa tu',
  boWarningLinkText: 'cola de revisión',
  boWarningTail: ' para resolver la base faltante antes de confiar en estas cifras.',
  ctxNoImports: 'No se encontraron transacciones para {year}. Importa primero las transacciones de tus wallets o exchanges y luego vuelve a ejecutar el pipeline.',
  ctxPipelineNotRun: 'AlmsTins encontró transacciones para {year} pero el pipeline de clasificación no se ha ejecutado aún. Ejecuta el pipeline desde el Centro fiscal para emparejar compras y ventas en lotes imponibles.',
  ctxCoinSingular: ' moneda',
  ctxCoinPlural: ' monedas',
  ctxHasSingular: 'tiene',
  ctxHavePlural: 'tienen',
  ctxTxSingular: 'transacción sin resolver',
  ctxTxPlural: 'transacciones sin resolver',
  ctxMustFix: 'Deben corregirse antes de que este resumen sea completo.',
  ctxNone: 'El pipeline se ejecutó pero no encontró disposiciones imponibles para {year}. Si no vendiste cripto este año, es lo esperado — de lo contrario, revisa tus importaciones.',
  diagPipelineNotRunStrong: 'Pipeline no ejecutado',
  diagPipelineNotRunText: ' — existen transacciones para {year} pero no han sido clasificadas en lotes imponibles aún',
  diagNoBuyStrong: '{n} venta{s} sin registro de compra correspondiente',
  diagNoBuyConnector: ' — ',
  diagNoBuyTail: ' · la transacción de compra no está en tus importaciones o se realizó en una plataforma que aún no has conectado',
  diagNoBasisStrong: '{n} lote{s} sin precio o fecha de compra',
  diagNoBasisConnector: ' — ',
  diagNoBasisTail: ' · se encontró la compra pero se desconoce su valor en USD en el momento de la adquisición',
  diagNoDisposalsStrong: 'Sin disposiciones en {year}',
  diagNoDisposalsTail: ' — el pipeline se ejecutó correctamente pero no encontró ventas, intercambios ni operaciones que reportar',
  diagNoFoundStrong: 'No se encontraron transacciones para {year}',
  diagNoFoundTail: ' — no se ha importado nada para este año todavía',
  importBtnLabel: '📥 Importar transacciones — añadir datos de {year}',
  pipelineAfterImport: '⚙️ Ejecutar pipeline — después de importar',
  pipelineClassify: '⚙️ Ejecutar pipeline — clasificar transacciones de {year}',
  pipelineRerunMissing: '⚙️ Volver a ejecutar el pipeline — después de añadir registros faltantes',
  pipelineRerunPrices: '⚙️ Volver a ejecutar el pipeline — después de corregir precios faltantes',
  reviewNoBuy: '🔍 Cola de revisión — encontrar las compras faltantes para {n} venta{s}',
  reviewNoBasis: '🔍 Cola de revisión — introducir precios de compra para {n} lote{s}',
  rowCountSingular: 'transacción',
  rowCountPlural: 'transacciones · Ver Schedule D para los totales',
  chipNoBuy: '⚠ sin registro de compra',
  chipNoPrice: '⚠ precio faltante',
  irsHeaderBadge: 'Resumen informativo — no para declarar',
  irsHeaderTitle: 'Resumen de ganancias de capital',
  irsHeaderDesc: 'Ganancias y pérdidas realizadas, con formato similar al Formulario 8949 del IRS para referencia',
  irsHeaderDisclaimer: 'No es una declaración fiscal ni asesoramiento tributario — confirma con tu asesor fiscal',
  irsHeaderTaxYear: 'Año fiscal:',
  irsHeaderMethod: 'Método:',
  irsHeaderPreparedBy: 'Preparado por Almstins — no es un formulario oficial del IRS',
  boxNoteTemplate: 'Nota: Las transacciones de cripto se reportan en el Casillero {box} ("todos los demás") porque los exchanges no estaban obligados a emitir 1099-B para estas transacciones.',
  totalsPrefix: 'Totales (Casillero {box})',
};

export const fr: Form8949Locale = {
  lang: 'fr',
  pageTitle: "Résumé des plus-values | Almstins",
  backLink: "← Centre fiscal",
  heroTitle: "Résumé des plus-values",
  heroSubtitle: "Résumé des gains et pertes au format américain, présenté en miroir du formulaire IRS Form 8949 pour votre référence.",
  btnLoad: "Charger",
  btnCsv: "↓ CSV",
  btnPrint: "🖨 Imprimer",
  stateLoading: "Chargement du Form 8949…",
  errLoadFailed: "Impossible de charger les données du formulaire.",
  errNetwork: "Erreur réseau — veuillez réessayer.",
  emptyTitle: "Aucune cession classifiée trouvée pour cette année",
  emptyContext: "AlmsTins a trouvé des transactions pour cette année mais aucune n'a encore été regroupée dans des lots de cession imposables.",
  emptyWhatLabel: "Ce que cela signifie habituellement",
  diagPipelineStrong: "Pipeline non exécuté",
  diagPipelineText: "— les transactions doivent être classifiées avant que les lots puissent être appariés",
  diagMissingBuyText: "Une transaction de vente existe mais l'achat correspondant est manquant — vérifiez la file de révision",
  diagNoDataText: "Aucune transaction n'a encore été importée pour cette année",
  emptyTokensLabel: "Tokens avec des transactions non résolues cette année",
  btnReviewQueue: "🔍 Ouvrir la file de révision",
  btnImport: "📥 Importer des transactions",
  btnPipeline: "⚙️ Lancer le pipeline de classification",
  cardProceeds: "Total des produits",
  cardBasis: "Base de coût totale",
  cardNetGain: "Gain / (perte) net(te)",
  boWarningText: "⚠ Certaines lignes sont marquées BO (base non déclarée). Ce sont des transactions sans base de coût enregistrée. Consultez votre",
  boWarningLinkText: "file de révision",
  boWarningTail: " pour résoudre la base manquante avant de vous fier à ces chiffres.",
  ctxNoImports: "Aucune transaction trouvée pour {year}. Importez d'abord les transactions de vos wallets ou exchanges, puis relancez le pipeline.",
  ctxPipelineNotRun: "AlmsTins a trouvé des transactions pour {year} mais le pipeline de classification n'a pas encore été exécuté. Lancez le pipeline depuis le Centre fiscal pour apparier les achats et les ventes en lots imposables.",
  ctxCoinSingular: " crypto-actif",
  ctxCoinPlural: " crypto-actifs",
  ctxHasSingular: "a",
  ctxHavePlural: "ont",
  ctxTxSingular: "transaction non résolue",
  ctxTxPlural: "transactions non résolues",
  ctxMustFix: "Ces éléments doivent être corrigés avant que ce résumé soit complet.",
  ctxNone: "Le pipeline a été exécuté mais n'a trouvé aucune cession imposable pour {year}. Si vous n'avez pas vendu de crypto cette année, c'est normal — sinon vérifiez vos importations.",
  diagPipelineNotRunStrong: "Pipeline non exécuté",
  diagPipelineNotRunText: " — des transactions existent pour {year} mais n'ont pas encore été classifiées en lots imposables",
  diagNoBuyStrong: "{n} vente{s} sans dossier d'achat correspondant",
  diagNoBuyConnector: " — ",
  diagNoBuyTail: " · la transaction d'achat est soit absente de vos importations, soit effectuée sur une plateforme que vous n'avez pas encore connectée",
  diagNoBasisStrong: "{n} lot{s} sans prix ou date d'achat",
  diagNoBasisConnector: " — ",
  diagNoBasisTail: "· l'achat a été trouvé mais sa valeur en USD au moment de l'acquisition est inconnue",
  diagNoDisposalsStrong: "Aucune cession en {year}",
  diagNoDisposalsTail: " — le pipeline a été exécuté avec succès mais n'a trouvé aucune vente, échange ou opération à déclarer",
  diagNoFoundStrong: "Aucune transaction trouvée pour {year}",
  diagNoFoundTail: " — rien n'a encore été importé pour cette année",
  importBtnLabel: "📥 Importer des transactions — ajouter des données pour {year}",
  pipelineAfterImport: "⚙️ Lancer le pipeline — après l'importation",
  pipelineClassify: "⚙️ Lancer le pipeline — classifier les transactions de {year}",
  pipelineRerunMissing: "⚙️ Relancer le pipeline — après avoir ajouté les enregistrements manquants",
  pipelineRerunPrices: "⚙️ Relancer le pipeline — après avoir corrigé les prix manquants",
  reviewNoBuy: "🔍 File de révision — trouver les achats manquants pour {n} vente{s}",
  reviewNoBasis: "🔍 File de révision — saisir les prix d'achat pour {n} lot{s}",
  rowCountSingular: "transaction",
  rowCountPlural: "transactions · Voir Schedule D pour les totaux",
  chipNoBuy: "⚠ pas de dossier d'achat",
  chipNoPrice: "⚠ prix manquant",
  irsHeaderBadge: "Résumé informatif — pas pour déclaration",
  irsHeaderTitle: "Résumé des plus-values",
  irsHeaderDesc: "Gains et pertes réalisés, formatés en miroir du formulaire IRS Form 8949 pour référence",
  irsHeaderDisclaimer: "Pas une déclaration fiscale ni un conseil fiscal — confirmez avec votre conseiller fiscal",
  irsHeaderTaxYear: "Année fiscale :",
  irsHeaderMethod: "Méthode :",
  irsHeaderPreparedBy: "Préparé par Almstins — pas un formulaire officiel de l'IRS",
  boxNoteTemplate: "Note : Les transactions crypto sont déclarées dans la Case {box} (\"toutes les autres\") car les exchanges n'étaient pas tenus d'émettre un 1099-B pour ces transactions.",
  totalsPrefix: "Totaux (Case {box})",
};

const MAP: Record<Lang, Form8949Locale> = { en, es, fr };

/** Select the Form 8949 locale for a language, falling back to English. */
export function getForm8949(lang: Lang): Form8949Locale {
  return MAP[lang] ?? en;
}
