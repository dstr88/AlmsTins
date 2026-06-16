// Transactions dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): transactions.astro reads getLang(Astro.request) and
// selects via getTransactions(lang). These are the strings the PAGE owns —
// header text, filter labels, table headers, empty states, modal copy, and
// the client-script strings injected via the define:vars JSON island.
//
// Crypto jargon stays English per design.claude.md: wallet, on-chain,
// exchange names, ticker symbols, tx hash, token. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface TransactionsLocale {
  lang: Lang;
  pageTitle: string;
  eyebrow: string;
  heroTitle: string;
  lede: string;
  syncSelected: string;
  refreshAll: string;
  filterWallet: string;
  filterChain: string;
  filterChainAll: string;
  filterFrom: string;
  filterTo: string;
  loadBtn: string;
  statusInitial: string;
  thDate: string;
  thChain: string;
  thFrom: string;
  thTo: string;
  thToken: string;
  thAmount: string;
  thCategory: string;
  thNote: string;
  thShots: string;
  emptyInitial: string;
  modalTitle: string;
  modalClose: string;
  uploadImage: string;
  takePhoto: string;
  parseImport: string;
  // Client-script strings (injected via define:vars JSON island)
  syncingWallet: string;
  /** "Synced N transactions. Loading latest data…" */
  syncedTransactions: (n: number) => string;
  syncFailed: string;
  syncingAll: string;
  /** "Synced N wallets (N transactions). Reloading…" */
  syncedAll: (wallets: number, txns: number) => string;
  syncAllFailed: string;
  selectWalletFirst: string;
  loadingTransactions: string;
  failedToLoad: string;
  /** "Showing N transactions." */
  showingCount: (n: number) => string;
  unableToLoad: string;
  noMatchFilters: string;
  missingIds: string;
  failedToSave: string;
  savedBtn: string;
  saveBtn: string;
  annotationSaved: string;
  failedToSaveAnnotation: string;
  notePlaceholder: string;
  shotsTitle: string;
  shotsLoading: string;
  shotsFailed: string;
  shotsEmpty: string;
  uploading: string;
  uploaded: string;
  uploadFailed: string;
  deleteFailed: string;
  confirmDelete: string;
  deleteTitle: string;
  /** "Parsing N screenshot(s) with AI…" */
  parsing: (n: number) => string;
  parseFailed: string;
  /** "N imported" part of the parse summary */
  importedCount: (n: number) => string;
  /** "N duplicate(s) skipped" part of the parse summary */
  duplicatesSkipped: (n: number) => string;
  checkTins: string;
}

export const en: TransactionsLocale = {
  lang: 'en',
  pageTitle: 'Transactions | Almstins',
  eyebrow: 'Ledger view',
  heroTitle: 'Transactions & annotations',
  lede: 'Review on-chain activity, classify each movement, and attach notes for taxes.',
  syncSelected: 'Sync selected wallet',
  refreshAll: 'Refresh all wallets',
  filterWallet: 'Wallet',
  filterChain: 'Chain',
  filterChainAll: 'All',
  filterFrom: 'From',
  filterTo: 'To',
  loadBtn: 'Load transactions',
  statusInitial: 'Choose a wallet and press "Load transactions".',
  thDate: 'Date',
  thChain: 'Chain',
  thFrom: 'From',
  thTo: 'To',
  thToken: 'Token',
  thAmount: 'Amount',
  thCategory: 'Category',
  thNote: 'Note',
  thShots: 'Shots',
  emptyInitial: 'No transactions loaded yet.',
  modalTitle: 'Screenshots',
  modalClose: 'Close',
  uploadImage: 'Upload image',
  takePhoto: 'Take photo',
  parseImport: 'Parse & import',
  syncingWallet: 'Syncing wallet history…',
  syncedTransactions: (n) => `Synced ${n} transactions. Loading latest data…`,
  syncFailed: 'Sync failed',
  syncingAll: 'Syncing all wallets… this may take a moment.',
  syncedAll: (wallets, txns) => `Synced ${wallets} wallets (${txns} transactions). Reloading…`,
  syncAllFailed: 'Failed to sync wallets',
  selectWalletFirst: 'Select a wallet first.',
  loadingTransactions: 'Loading transactions…',
  failedToLoad: 'Failed to load transactions',
  showingCount: (n) => `Showing ${n} transactions.`,
  unableToLoad: 'Unable to load transactions.',
  noMatchFilters: 'No transactions match your filters.',
  missingIds: 'Missing transaction identifiers.',
  failedToSave: 'Failed to save annotation',
  savedBtn: 'Saved',
  saveBtn: 'Save',
  annotationSaved: 'Annotation saved.',
  failedToSaveAnnotation: 'Failed to save annotation.',
  notePlaceholder: 'Add note',
  shotsTitle: 'Screenshots',
  shotsLoading: 'Loading…',
  shotsFailed: 'Failed to load screenshots.',
  shotsEmpty: 'No screenshots yet. Upload one below.',
  uploading: 'Uploading…',
  uploaded: 'Uploaded.',
  uploadFailed: 'Upload failed',
  deleteFailed: 'Delete failed',
  confirmDelete: 'Delete this screenshot?',
  deleteTitle: 'Delete',
  parsing: (n) => `Parsing ${n} screenshot${n > 1 ? 's' : ''} with AI…`,
  parseFailed: 'Parse failed',
  importedCount: (n) => `${n} imported`,
  duplicatesSkipped: (n) => `${n} duplicate${n > 1 ? 's' : ''} skipped`,
  checkTins: 'Check your exchange tins.',
};

export const es: TransactionsLocale = {
  lang: 'es',
  pageTitle: 'Transacciones | Almstins',
  eyebrow: 'Vista del libro mayor',
  heroTitle: 'Transacciones y anotaciones',
  lede: 'Revisa la actividad on-chain, clasifica cada movimiento y adjunta notas para impuestos.',
  syncSelected: 'Sincronizar wallet seleccionada',
  refreshAll: 'Actualizar todas las wallets',
  filterWallet: 'Wallet',
  filterChain: 'Chain',
  filterChainAll: 'Todas',
  filterFrom: 'Desde',
  filterTo: 'Hasta',
  loadBtn: 'Cargar transacciones',
  statusInitial: 'Elige una wallet y pulsa "Cargar transacciones".',
  thDate: 'Fecha',
  thChain: 'Chain',
  thFrom: 'Origen',
  thTo: 'Destino',
  thToken: 'Token',
  thAmount: 'Cantidad',
  thCategory: 'Categoría',
  thNote: 'Nota',
  thShots: 'Capturas',
  emptyInitial: 'Aún no se han cargado transacciones.',
  modalTitle: 'Capturas de pantalla',
  modalClose: 'Cerrar',
  uploadImage: 'Subir imagen',
  takePhoto: 'Tomar foto',
  parseImport: 'Analizar e importar',
  syncingWallet: 'Sincronizando historial de la wallet…',
  syncedTransactions: (n) => `Sincronizadas ${n} transacciones. Cargando los últimos datos…`,
  syncFailed: 'Error de sincronización',
  syncingAll: 'Sincronizando todas las wallets… esto puede tardar un momento.',
  syncedAll: (wallets, txns) => `Sincronizadas ${wallets} wallets (${txns} transacciones). Recargando…`,
  syncAllFailed: 'Error al sincronizar las wallets',
  selectWalletFirst: 'Selecciona una wallet primero.',
  loadingTransactions: 'Cargando transacciones…',
  failedToLoad: 'Error al cargar las transacciones',
  showingCount: (n) => `Mostrando ${n} transacciones.`,
  unableToLoad: 'No se pudieron cargar las transacciones.',
  noMatchFilters: 'Ninguna transacción coincide con tus filtros.',
  missingIds: 'Faltan identificadores de la transacción.',
  failedToSave: 'Error al guardar la anotación',
  savedBtn: 'Guardado',
  saveBtn: 'Guardar',
  annotationSaved: 'Anotación guardada.',
  failedToSaveAnnotation: 'Error al guardar la anotación.',
  notePlaceholder: 'Añadir nota',
  shotsTitle: 'Capturas de pantalla',
  shotsLoading: 'Cargando…',
  shotsFailed: 'Error al cargar las capturas.',
  shotsEmpty: 'Aún no hay capturas. Sube una aquí abajo.',
  uploading: 'Subiendo…',
  uploaded: 'Subida.',
  uploadFailed: 'Error al subir',
  deleteFailed: 'Error al eliminar',
  confirmDelete: '¿Eliminar esta captura?',
  deleteTitle: 'Eliminar',
  parsing: (n) => `Analizando ${n} captura${n > 1 ? 's' : ''} con IA…`,
  parseFailed: 'Error al analizar',
  importedCount: (n) => `${n} importada${n > 1 ? 's' : ''}`,
  duplicatesSkipped: (n) => `${n} duplicada${n > 1 ? 's' : ''} omitida${n > 1 ? 's' : ''}`,
  checkTins: 'Revisa tus tins de exchange.',
};

export const fr: TransactionsLocale = {
  lang: 'fr',
  pageTitle: 'Transactions | Almstins',
  eyebrow: 'Vue du grand livre',
  heroTitle: 'Transactions & annotations',
  lede: "Examinez l'activité on-chain, classifiez chaque mouvement et ajoutez des notes pour les impôts.",
  syncSelected: 'Synchroniser le wallet sélectionné',
  refreshAll: 'Actualiser tous les wallets',
  filterWallet: 'Wallet',
  filterChain: 'Chain',
  filterChainAll: 'Toutes',
  filterFrom: 'Du',
  filterTo: 'Au',
  loadBtn: 'Charger les transactions',
  statusInitial: 'Choisissez un wallet et appuyez sur « Charger les transactions ».',
  thDate: 'Date',
  thChain: 'Chain',
  thFrom: 'Expéditeur',
  thTo: 'Destinataire',
  thToken: 'Token',
  thAmount: 'Montant',
  thCategory: 'Catégorie',
  thNote: 'Note',
  thShots: 'Captures',
  emptyInitial: "Aucune transaction chargée pour l'instant.",
  modalTitle: "Captures d'écran",
  modalClose: 'Fermer',
  uploadImage: 'Importer une image',
  takePhoto: 'Prendre une photo',
  parseImport: 'Analyser et importer',
  syncingWallet: "Synchronisation de l'historique du wallet…",
  syncedTransactions: (n) => `${n} transaction${n > 1 ? 's' : ''} synchronisée${n > 1 ? 's' : ''}. Chargement des dernières données…`,
  syncFailed: 'Échec de la synchronisation',
  syncingAll: 'Synchronisation de tous les wallets… cela peut prendre un moment.',
  syncedAll: (wallets, txns) => `${wallets} wallet${wallets > 1 ? 's' : ''} synchronisé${wallets > 1 ? 's' : ''} (${txns} transaction${txns > 1 ? 's' : ''}). Rechargement…`,
  syncAllFailed: 'Échec de la synchronisation des wallets',
  selectWalletFirst: "Sélectionnez d'abord un wallet.",
  loadingTransactions: 'Chargement des transactions…',
  failedToLoad: 'Impossible de charger les transactions',
  showingCount: (n) => `Affichage de ${n} transaction${n > 1 ? 's' : ''}.`,
  unableToLoad: 'Impossible de charger les transactions.',
  noMatchFilters: 'Aucune transaction ne correspond à vos filtres.',
  missingIds: 'Identifiants de transaction manquants.',
  failedToSave: "Échec de l'enregistrement de l'annotation",
  savedBtn: 'Enregistré',
  saveBtn: 'Enregistrer',
  annotationSaved: 'Annotation enregistrée.',
  failedToSaveAnnotation: "Échec de l'enregistrement de l'annotation.",
  notePlaceholder: 'Ajouter une note',
  shotsTitle: "Captures d'écran",
  shotsLoading: 'Chargement…',
  shotsFailed: 'Impossible de charger les captures.',
  shotsEmpty: "Aucune capture pour l'instant. Importez-en une ci-dessous.",
  uploading: 'Import en cours…',
  uploaded: 'Importée.',
  uploadFailed: "Échec de l'import",
  deleteFailed: 'Échec de la suppression',
  confirmDelete: 'Supprimer cette capture ?',
  deleteTitle: 'Supprimer',
  parsing: (n) => `Analyse de ${n} capture${n > 1 ? 's' : ''} avec l'IA…`,
  parseFailed: "Échec de l'analyse",
  importedCount: (n) => `${n} importée${n > 1 ? 's' : ''}`,
  duplicatesSkipped: (n) => `${n} doublon${n > 1 ? 's' : ''} ignoré${n > 1 ? 's' : ''}`,
  checkTins: "Vérifiez vos tins d'exchange.",
};

const MAP: Record<Lang, TransactionsLocale> = { en, es, fr };

/** Select the Transactions locale for a language, falling back to English. */
export function getTransactions(lang: Lang): TransactionsLocale {
  return MAP[lang] ?? en;
}
