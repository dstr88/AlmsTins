// Research dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based: research.astro reads getLang(Astro.request) and selects
// via getResearch(lang). These are the strings the PAGE owns — SSR template
// text (headings, labels, sticky note, modals) AND the client-<script>
// strings injected via the define:vars JSON island (window.__researchI18n).
//
// Crypto jargon stays English per design.claude.md: wallet, token, tx hash,
// on-chain, exchange names (Coinbase, Kraken…). ES/FR are first-pass.
// Feature names "Needs Attention" and "AI Triage" kept in English for
// consistency with the rest of the product; translated as concepts where
// they appear in descriptive prose.

import type { Lang } from '@/lib/i18n/locale';

export interface ResearchLocale {
  lang: Lang;
  pageTitle: string;

  // ── Sticky note ──────────────────────────────────────────────────────────
  stickyHeading: string;
  stickyBody: string;
  stickyLi1Strong: string;
  stickyLi1Rest: string;
  stickyLi2Strong: string;
  stickyLi2Rest: string;
  stickyLi3Strong: string;
  stickyLi3Rest: string;
  stickyTip: string;

  // ── Left column — Needs Attention ────────────────────────────────────────
  colNeedsAttention: string;
  colScope: string;
  btnAiTriage: string;
  btnFillPrices: string;

  // ── Resolved tin ─────────────────────────────────────────────────────────
  resolved: string;
  resolvedShow: string;
  resolvedHide: string;

  // ── Right column — Search ────────────────────────────────────────────────
  searchPlaceholder: string;
  filterAllSymbols: string;
  filterNotePlaceholder: string;
  btnResolve: string;
  btnIgnoreDust: string;
  btnP2p: string;
  btnAddTransaction: string;
  walletPickerHeader: string;
  walletPickerEmpty: string;
  walletUnnamed: string;
  btnSearch: string;
  colResults: string;
  sortLabel: string;
  sortDate: string;
  sortAmount: string;
  emptySearch: string;

  // ── P2P panel ─────────────────────────────────────────────────────────────
  p2pPanelLabel: string;
  p2pOwnAccount: string;
  p2pThirdParty: string;

  // ── Dataset Health Check ──────────────────────────────────────────────────
  healthTitle: string;
  btnRunDiagnostics: string;
  btnDatasetQuestionnaire: string;

  // ── Confirm Transfer Match modal ──────────────────────────────────────────
  matchModalTitle: string;
  matchModalReject: string;
  matchModalConfirm: string;
}

// ── English ───────────────────────────────────────────────────────────────────
export const en: ResearchLocale = {
  lang: 'en',
  pageTitle: 'Research | Almstins',

  stickyHeading: 'This is where the mysteries live.',
  stickyBody:
    'Research is your detective desk for the unresolved chapters of your crypto journey — ' +
    'tokens that showed up with no purchase history, assets missing a price basis, ' +
    'and disposals with no clear origin. If it raised a flag in Bookkeeping, the trail starts here.',
  stickyLi1Strong: 'No purchase history',
  stickyLi1Rest: ' — tokens that appeared in your wallet without a tracked buy.',
  stickyLi2Strong: 'Missing cost basis',
  stickyLi2Rest: ' — assets you hold but can\'t price because the acquisition wasn\'t recorded.',
  stickyLi3Strong: 'Unclear disposals',
  stickyLi3Rest: ' — outbound transfers with no matching sale record or counterparty label.',
  stickyTip:
    'Search by hash, symbol, or keyword to dig into any transaction. Label what you find and it flows back through your whole history.',

  colNeedsAttention: 'Needs Attention',
  colScope: 'All years · Bookkeeping shows current year only',
  btnAiTriage: 'AI Triage',
  btnFillPrices: 'Fill Missing Prices',

  resolved: 'Resolved',
  resolvedShow: '▾ show',
  resolvedHide: '▴ hide',

  searchPlaceholder: 'Search by hash, symbol, keyword, or note…',
  filterAllSymbols: 'All symbols',
  filterNotePlaceholder: 'Note keyword…',
  btnResolve: 'Resolve',
  btnIgnoreDust: 'Ignore dust',
  btnP2p: 'P2P',
  btnAddTransaction: '＋ Add Transaction',
  walletPickerHeader: 'Select wallet',
  walletPickerEmpty: 'No wallets found.',
  walletUnnamed: 'Unnamed',
  btnSearch: 'Search',
  colResults: 'Results',
  sortLabel: 'Sort within groups:',
  sortDate: 'Date ↑',
  sortAmount: 'Amount',
  emptySearch: 'Search above or click a symbol chip to explore your transactions.',

  p2pPanelLabel: 'These phone-number transfers could be yours or someone else\'s:',
  p2pOwnAccount: 'My own account',
  p2pThirdParty: 'Third-party disposal',

  healthTitle: 'Dataset Health Check',
  btnRunDiagnostics: 'Run diagnostics',
  btnDatasetQuestionnaire: 'Dataset Questionnaire',

  matchModalTitle: 'Confirm Transfer Match?',
  matchModalReject: 'Reject',
  matchModalConfirm: 'Confirm Match',
};

// ── Spanish ───────────────────────────────────────────────────────────────────
export const es: ResearchLocale = {
  lang: 'es',
  pageTitle: 'Investigación | Almstins',

  stickyHeading: "Aquí viven los misterios.",
  stickyBody:
    "Investigación es tu escritorio de detective para los capítulos sin resolver de tu historial cripto — " +
    "tokens que aparecieron sin historial de compra, activos sin base de coste " +
    "y disposiciones sin un origen claro. Si algo levantó una bandera en Contabilidad, el rastro comienza aquí.",
  stickyLi1Strong: "Sin historial de compra",
  stickyLi1Rest: " — tokens que aparecieron en tu wallet sin una compra registrada.",
  stickyLi2Strong: "Base de coste faltante",
  stickyLi2Rest: " — activos que tienes pero no puedes valorar porque la adquisición no fue registrada.",
  stickyLi3Strong: "Disposiciones poco claras",
  stickyLi3Rest: " — transferencias salientes sin registro de venta o etiqueta de contraparte.",
  stickyTip:
    "Busca por hash, símbolo o palabra clave para investigar cualquier transacción. Etiqueta lo que encuentres y fluirá por todo tu historial.",

  colNeedsAttention: 'Needs Attention',
  colScope: "Todos los años · Contabilidad muestra solo el año actual",
  btnAiTriage: 'AI Triage',
  btnFillPrices: "Rellenar precios faltantes",

  resolved: "Resuelto",
  resolvedShow: "▾ mostrar",
  resolvedHide: "▴ ocultar",

  searchPlaceholder: "Buscar por hash, símbolo, palabra clave o nota…",
  filterAllSymbols: "Todos los símbolos",
  filterNotePlaceholder: "Palabra clave de nota…",
  btnResolve: "Resolver",
  btnIgnoreDust: "Ignorar polvo",
  btnP2p: "P2P",
  btnAddTransaction: "＋ Añadir transacción",
  walletPickerHeader: "Seleccionar wallet",
  walletPickerEmpty: "No se encontraron wallets.",
  walletUnnamed: "Sin nombre",
  btnSearch: "Buscar",
  colResults: "Resultados",
  sortLabel: "Ordenar dentro de grupos:",
  sortDate: "Fecha ↑",
  sortAmount: "Importe",
  emptySearch: "Busca arriba o haz clic en un chip de símbolo para explorar tus transacciones.",

  p2pPanelLabel: "Estas transferencias a número de teléfono pueden ser tuyas o de otra persona:",
  p2pOwnAccount: "Mi propia cuenta",
  p2pThirdParty: "Disposición a terceros",

  healthTitle: "Comprobación del dataset",
  btnRunDiagnostics: "Ejecutar diagnósticos",
  btnDatasetQuestionnaire: "Cuestionario del dataset",

  matchModalTitle: "¿Confirmar coincidencia de transferencia?",
  matchModalReject: "Rechazar",
  matchModalConfirm: "Confirmar coincidencia",
};

// ── French ────────────────────────────────────────────────────────────────────
export const fr: ResearchLocale = {
  lang: 'fr',
  pageTitle: "Recherche | Almstins",

  stickyHeading: "C'est ici que vivent les mystères.",
  stickyBody:
    "Recherche est votre bureau d'enquête pour les chapitres non résolus de votre parcours crypto — " +
    "des tokens apparus sans historique d'achat, des actifs sans base de coût " +
    "et des cessions sans origine claire. Si quelque chose a déclenché une alerte dans la Comptabilité, la piste commence ici.",
  stickyLi1Strong: "Aucun historique d'achat",
  stickyLi1Rest: " — des tokens apparus dans votre wallet sans achat enregistré.",
  stickyLi2Strong: "Base de coût manquante",
  stickyLi2Rest: " — des actifs que vous détenez mais ne pouvez pas valoriser car l'acquisition n'a pas été enregistrée.",
  stickyLi3Strong: "Cessions peu claires",
  stickyLi3Rest: " — des transferts sortants sans enregistrement de vente ni étiquette de contrepartie.",
  stickyTip:
    "Recherchez par hash, symbole ou mot-clé pour analyser n'importe quelle transaction. Étiquetez ce que vous trouvez et cela se répercutera sur tout votre historique.",

  colNeedsAttention: 'Needs Attention',
  colScope: "Toutes les années · La Comptabilité affiche uniquement l'année en cours",
  btnAiTriage: 'AI Triage',
  btnFillPrices: "Compléter les prix manquants",

  resolved: "Résolu",
  resolvedShow: "▾ afficher",
  resolvedHide: "▴ masquer",

  searchPlaceholder: "Rechercher par hash, symbole, mot-clé ou note…",
  filterAllSymbols: "Tous les symboles",
  filterNotePlaceholder: "Mot-clé de note…",
  btnResolve: "Résoudre",
  btnIgnoreDust: "Ignorer la poussière",
  btnP2p: "P2P",
  btnAddTransaction: "＋ Ajouter une transaction",
  walletPickerHeader: "Sélectionner un wallet",
  walletPickerEmpty: "Aucun wallet trouvé.",
  walletUnnamed: "Sans nom",
  btnSearch: "Rechercher",
  colResults: "Résultats",
  sortLabel: "Trier dans les groupes :",
  sortDate: "Date ↑",
  sortAmount: "Montant",
  emptySearch: "Recherchez ci-dessus ou cliquez sur un chip de symbole pour explorer vos transactions.",

  p2pPanelLabel: "Ces transferts par numéro de téléphone peuvent vous appartenir ou appartenir à quelqu'un d'autre :",
  p2pOwnAccount: "Mon propre compte",
  p2pThirdParty: "Cession à un tiers",

  healthTitle: "Vérification du dataset",
  btnRunDiagnostics: "Lancer les diagnostics",
  btnDatasetQuestionnaire: "Questionnaire du dataset",

  matchModalTitle: "Confirmer la correspondance de transfert ?",
  matchModalReject: "Rejeter",
  matchModalConfirm: "Confirmer la correspondance",
};

const MAP: Record<Lang, ResearchLocale> = { en, es, fr };

/** Select the Research locale for a language, falling back to English. */
export function getResearch(lang: Lang): ResearchLocale {
  return MAP[lang] ?? en;
}
