// AddressLabels (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / chain names / exchange names stay English. ES/FR first-pass.
//
// ENUM VALUES (`'own_wallet'`, `'exchange'`, `'counterparty'`, etc.) are data —
// unchanged in logic. Only the display side (option text, badge labels) is translated.

import type { Lang } from '@/lib/i18n/locale';

export interface AddressLabelsLocale {
  lang: Lang;

  // Header
  eyebrow: string;
  heading: string;
  description: string;

  // Add form
  formEyebrow: string;
  scanBtnTitle: string;
  scanBtnLabel: string;
  scanBtnScanning: string;

  // Status / feedback messages
  statusScanning: string;
  statusNoAddress: string;
  statusAddressRequired: string;
  statusLabelRequired: string;
  statusSaving: string;
  statusSaveFailed: string;
  statusSaved: string;

  // Interpolated messages (functions)
  statusScanFailed: (msg: string) => string;
  statusScanError: (msg: string) => string;
  statusFoundMultiple: (count: number) => string;

  // Input placeholders
  placeholderAddress: string;
  placeholderLabel: string;
  placeholderPhone: string;

  // Category <select> option display labels (option value attrs are enum data — unchanged)
  catCounterparty: string;
  catDefiProtocol: string;
  catExchange: string;
  catPersonalWallet: string;
  catBridge: string;
  catOther: string;

  // Chain <select> first option
  allChains: string;

  // Save button
  saveBtnSaving: string;
  saveBtnSave: string;

  // Empty state
  emptyState: string;

  // Copy button
  copyTitle: string;

  // Source badge for auto-labeled addresses
  sourceCommunity: string;

  // Remove button
  removeBtn: string;

  // Category badge display labels (maps enum key → display text)
  catBadgeDefi: string;
  catBadgeExchange: string;
  catBadgePersonal: string;
  catBadgeBridge: string;
  catBadgeOther: string;
}

export const en: AddressLabelsLocale = {
  lang: 'en',

  eyebrow: 'Counterparties',
  heading: 'Address Labels',
  description:
    'Tag exchange hot wallets, other people’s wallets, and services so they show up with a name in your history. These are not your wallets and are not added to the Vault.',

  formEyebrow: 'Tag an address',
  scanBtnTitle: 'Upload a screenshot — Claude will read the wallet address for you',
  scanBtnLabel: 'Scan Screenshot',
  scanBtnScanning: 'Scanning…',

  statusScanning: 'Scanning image…',
  statusNoAddress: 'No wallet address found in that image. Try a clearer crop.',
  statusAddressRequired: 'Address is required',
  statusLabelRequired: 'Label is required',
  statusSaving: 'Saving…',
  statusSaveFailed: 'Failed to save',
  statusSaved: '✓ Label saved.',

  statusScanFailed: (msg) => `Scan failed: ${msg}`,
  statusScanError: (msg) => `Scan error: ${msg}`,
  statusFoundMultiple: (count) =>
    `Found ${count} addresses — first one pre-filled. Check the field.`,

  placeholderAddress: 'Address (any network)',
  placeholderLabel: 'Label  (e.g. Venmo LTC pool)',
  placeholderPhone: 'Phone # (optional, e.g. Venmo)',

  catCounterparty: 'Counterparty',
  catDefiProtocol: 'DeFi Protocol',
  catExchange: 'Exchange',
  catPersonalWallet: 'Personal Wallet',
  catBridge: 'Bridge',
  catOther: 'Other',

  allChains: 'All chains',

  saveBtnSaving: 'Saving…',
  saveBtnSave: 'Save Label',

  emptyState: 'No address labels yet.',

  copyTitle: 'Copy address',

  sourceCommunity: 'community',

  removeBtn: 'Remove',

  catBadgeDefi: 'DeFi',
  catBadgeExchange: 'Exchange',
  catBadgePersonal: 'Personal',
  catBadgeBridge: 'Bridge',
  catBadgeOther: 'Other',
};

export const es: AddressLabelsLocale = {
  lang: 'es',

  eyebrow: "Contrapartes",
  heading: "Etiquetas de direcciones",
  description:
    "Etiqueta billeteras de intercambios, billeteras de otras personas y servicios para que aparezcan con un nombre en tu historial. Estas no son tus billeteras y no se agregan al Vault.",

  formEyebrow: "Etiquetar una dirección",
  scanBtnTitle: "Sube una captura de pantalla — Claude leerá la dirección de la billetera por ti",
  scanBtnLabel: "Escanear captura",
  scanBtnScanning: "Escaneando…",

  statusScanning: "Escaneando imagen…",
  statusNoAddress: "No se encontró ninguna dirección de billetera en esa imagen. Intenta con un recorte más claro.",
  statusAddressRequired: "La dirección es obligatoria",
  statusLabelRequired: "La etiqueta es obligatoria",
  statusSaving: "Guardando…",
  statusSaveFailed: "Error al guardar",
  statusSaved: "✓ Etiqueta guardada.",

  statusScanFailed: (msg) => `Error de escaneo: ${msg}`,
  statusScanError: (msg) => `Error al escanear: ${msg}`,
  statusFoundMultiple: (count) =>
    `Se encontraron ${count} direcciones — la primera se precargó. Revisa el campo.`,

  placeholderAddress: "Dirección (cualquier red)",
  placeholderLabel: "Etiqueta  (p. ej. Venmo LTC pool)",
  placeholderPhone: "Teléfono (opcional, p. ej. Venmo)",

  catCounterparty: "Contraparte",
  catDefiProtocol: "Protocolo DeFi",
  catExchange: "Exchange",
  catPersonalWallet: "Billetera personal",
  catBridge: "Bridge",
  catOther: "Otro",

  allChains: "Todas las redes",

  saveBtnSaving: "Guardando…",
  saveBtnSave: "Guardar etiqueta",

  emptyState: "Aún no hay etiquetas de direcciones.",

  copyTitle: "Copiar dirección",

  sourceCommunity: "comunidad",

  removeBtn: "Eliminar",

  catBadgeDefi: "DeFi",
  catBadgeExchange: "Exchange",
  catBadgePersonal: "Personal",
  catBadgeBridge: "Bridge",
  catBadgeOther: "Otro",
};

export const fr: AddressLabelsLocale = {
  lang: 'fr',

  eyebrow: "Contreparties",
  heading: "Libellés d'adresses",
  description:
    "Identifiez les portefeuilles des exchanges, les portefeuilles d'autres personnes et les services pour qu'ils apparaissent avec un nom dans votre historique. Ce ne sont pas vos portefeuilles et ils ne sont pas ajoutés au Vault.",

  formEyebrow: "Identifier une adresse",
  scanBtnTitle: "Importez une capture d'écran — Claude lira l'adresse du portefeuille pour vous",
  scanBtnLabel: "Scanner la capture",
  scanBtnScanning: "Analyse en cours…",

  statusScanning: "Analyse de l'image…",
  statusNoAddress: "Aucune adresse de portefeuille trouvée dans cette image. Essayez un recadrage plus net.",
  statusAddressRequired: "L'adresse est obligatoire",
  statusLabelRequired: "Le libellé est obligatoire",
  statusSaving: "Enregistrement…",
  statusSaveFailed: "Échec de l'enregistrement",
  statusSaved: "✓ Libellé enregistré.",

  statusScanFailed: (msg) => `Échec du scan : ${msg}`,
  statusScanError: (msg) => `Erreur de scan : ${msg}`,
  statusFoundMultiple: (count) =>
    `${count} adresses trouvées — la première a été préremplie. Vérifiez le champ.`,

  placeholderAddress: "Adresse (tous réseaux)",
  placeholderLabel: "Libellé  (ex. : Venmo LTC pool)",
  placeholderPhone: "Tél. (optionnel, ex. : Venmo)",

  catCounterparty: "Contrepartie",
  catDefiProtocol: "Protocole DeFi",
  catExchange: "Exchange",
  catPersonalWallet: "Portefeuille personnel",
  catBridge: "Bridge",
  catOther: "Autre",

  allChains: "Toutes les chaînes",

  saveBtnSaving: "Enregistrement…",
  saveBtnSave: "Enregistrer le libellé",

  emptyState: "Aucun libellé d'adresse pour l'instant.",

  copyTitle: "Copier l'adresse",

  sourceCommunity: "communauté",

  removeBtn: "Supprimer",

  catBadgeDefi: "DeFi",
  catBadgeExchange: "Exchange",
  catBadgePersonal: "Personnel",
  catBadgeBridge: "Bridge",
  catBadgeOther: "Autre",
};

const MAP: Record<Lang, AddressLabelsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getAddressLabels(lang: Lang): AddressLabelsLocale {
  return MAP[lang] ?? en;
}
