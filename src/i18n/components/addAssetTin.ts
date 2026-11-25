// AddAssetTin (.astro component) — user-facing strings (EN · ES · FR).
//
// Pattern: frontmatter reads getLang(Astro.request) → getAddAssetTin(lang).
// Markup strings replaced with {t.x}. Client <script is:inline> strings
// injected via a define:vars island → window.__addAssetI18n.
//
// Do NOT translate: enum/option values, crypto jargon, "Tin/Tins", tickers,
// chain/exchange/company names, code, className, $ %, props, data attrs.
// ES/FR natural, first-pass. Double quotes in ES/FR values (apostrophe safety).

import type { Lang } from '@/lib/i18n/locale';

export interface AddAssetTinLocale {
  lang: Lang;

  // Heading
  headingTitle: string;

  // Demo clear popover
  demoClearMsg: string;
  demoClearConfirm: string;
  demoClearCancel: string;

  // Tab labels
  tabWallet: string;
  tabExchange: string;

  // Wallet panel
  fieldChain: string;
  fieldAddress: string;
  btnAddWallet: string;
  demoSamplesLabel: string;

  // Exchange panel
  exchangeHint: string;
  krakenExportHint: string;
  comingSoon: string;

  // Client script — wallet submit
  enterAddressFirst: string;
  saving: string;
  planLimitWallet: string;
  alreadyTracked: string;
  unableToAddWallet: string;
  syncingHistory: string;
  walletAddedReloading: string;

  // Chain hints (auto-detect)
  chainHintEvm: string;
  /** "Auto-detected: {chain} address." */
  chainHintAutoFn: (chain: string) => string;
  chainHintEthereum: string;
  chainHintBitcoin: string;
  chainHintLitecoin: string;
  chainHintSolana: string;
  chainHintSui: string;
}

export const en: AddAssetTinLocale = {
  lang: 'en',

  headingTitle: 'Add Asset',

  demoClearMsg: 'Reset all demo data?',
  demoClearConfirm: 'Reset',
  demoClearCancel: 'Cancel',

  tabWallet: 'Wallet',
  tabExchange: 'Exchange',

  fieldChain: 'Chain',
  fieldAddress: 'Address',
  btnAddWallet: 'Add Wallet',
  demoSamplesLabel: 'Try another wallet — enter any public address above.',

  exchangeHint:
    'Import transaction history as a CSV from any exchange below. Each exchange has an Import CSV button in its section.',
  krakenExportHint:
    'Kraken users: export from Account → History → Ledgers — not the Trades export.',
  comingSoon: 'More chains & exchanges coming soon.',

  enterAddressFirst: 'Enter a wallet address first.',
  saving: 'Saving…',
  planLimitWallet: 'Plan limit reached. Upgrade to add more tins.',
  alreadyTracked: 'Already tracked — edit the existing wallet instead.',
  unableToAddWallet: 'Unable to add wallet.',
  syncingHistory: 'Syncing wallet history…',
  walletAddedReloading: 'Wallet added — reloading…',

  chainHintEvm:
    'EVM addresses (0x…) are tracked across Ethereum, Polygon, Avalanche & Arbitrum automatically.',
  chainHintAutoFn: (chain) => 'Auto-detected: ' + chain + '.',
  chainHintEthereum:
    'Auto-detected: EVM address — covers Ethereum, Polygon, Avalanche & Arbitrum.',
  chainHintBitcoin: 'Auto-detected: Bitcoin address.',
  chainHintLitecoin: 'Auto-detected: Litecoin address.',
  chainHintSolana: 'Auto-detected: Solana address.',
  chainHintSui: 'Auto-detected: Sui address.',
};

export const es: AddAssetTinLocale = {
  lang: 'es',

  headingTitle: 'Agregar activo',

  demoClearMsg: "¿Restablecer todos los datos de demostración?",
  demoClearConfirm: "Restablecer",
  demoClearCancel: "Cancelar",

  tabWallet: "Wallet",
  tabExchange: "Exchange",

  fieldChain: "Red",
  fieldAddress: "Dirección",
  btnAddWallet: "Agregar wallet",
  demoSamplesLabel: "Prueba otra wallet — ingresa cualquier dirección pública arriba.",

  exchangeHint:
    "Importa el historial de transacciones como CSV desde cualquier exchange. Cada exchange tiene un botón Importar CSV en su sección.",
  krakenExportHint:
    "Usuarios de Kraken: exporta desde Cuenta → Historial → Libros contables — no desde la exportación de operaciones.",
  comingSoon: "Pronto habrá más redes y exchanges.",

  enterAddressFirst: "Ingresa primero una dirección de wallet.",
  saving: "Guardando…",
  planLimitWallet: "Limite del plan alcanzado. Actualiza para agregar mas Tins.",
  alreadyTracked: "Ya se esta rastreando — edita la wallet existente.",
  unableToAddWallet: "No se pudo agregar la wallet.",
  syncingHistory: "Sincronizando historial de la wallet…",
  walletAddedReloading: "Wallet agregada — recargando…",

  chainHintEvm:
    "Las direcciones EVM (0x…) se rastrean en Ethereum, Polygon, Avalanche y Arbitrum automaticamente.",
  chainHintAutoFn: (chain) => "Detectado automaticamente: " + chain + ".",
  chainHintEthereum:
    "Detectado automaticamente: dirección EVM — cubre Ethereum, Polygon, Avalanche y Arbitrum.",
  chainHintBitcoin: "Detectado automaticamente: dirección Bitcoin.",
  chainHintLitecoin: "Detectado automaticamente: dirección Litecoin.",
  chainHintSolana: "Detectado automaticamente: dirección Solana.",
  chainHintSui: "Detectado automaticamente: dirección Sui.",
};

export const fr: AddAssetTinLocale = {
  lang: 'fr',

  headingTitle: "Ajouter un actif",

  demoClearMsg: "Reinitialiser toutes les donnees de demonstration ?",
  demoClearConfirm: "Reinitialiser",
  demoClearCancel: "Annuler",

  tabWallet: "Wallet",
  tabExchange: "Exchange",

  fieldChain: "Reseau",
  fieldAddress: "Adresse",
  btnAddWallet: "Ajouter un wallet",
  demoSamplesLabel: "Essayez un autre wallet — saisissez une adresse publique ci-dessus.",

  exchangeHint:
    "Importez l'historique des transactions au format CSV depuis n'importe quel exchange ci-dessous. Chaque exchange dispose d'un bouton Importer CSV dans sa section.",
  krakenExportHint:
    "Utilisateurs Kraken : exportez depuis Compte → Historique → Grands livres — pas depuis l'export des transactions.",
  comingSoon: "D'autres reseaux et exchanges bientot disponibles.",

  enterAddressFirst: "Saisissez d'abord une adresse de wallet.",
  saving: "Enregistrement…",
  planLimitWallet: "Limite du plan atteinte. Passez a un forfait superieur pour ajouter plus de Tins.",
  alreadyTracked: "Deja suivi — modifiez le wallet existant.",
  unableToAddWallet: "Impossible d'ajouter le wallet.",
  syncingHistory: "Synchronisation de l'historique du wallet…",
  walletAddedReloading: "Wallet ajoute — rechargement…",

  chainHintEvm:
    "Les adresses EVM (0x…) sont suivies sur Ethereum, Polygon, Avalanche et Arbitrum automatiquement.",
  chainHintAutoFn: (chain) => "Detecte automatiquement : " + chain + ".",
  chainHintEthereum:
    "Detecte automatiquement : adresse EVM — couvre Ethereum, Polygon, Avalanche et Arbitrum.",
  chainHintBitcoin: "Detecte automatiquement : adresse Bitcoin.",
  chainHintLitecoin: "Detecte automatiquement : adresse Litecoin.",
  chainHintSolana: "Detecte automatiquement : adresse Solana.",
  chainHintSui: "Detecte automatiquement : adresse Sui.",
};

const MAP: Record<Lang, AddAssetTinLocale> = { en, es, fr };

export function getAddAssetTin(lang: Lang): AddAssetTinLocale {
  return MAP[lang] ?? en;
}
