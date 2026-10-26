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

  // The address details modal (AddressDetailsModal.tsx)
  details: AddressDetailsLocale;
}

/**
 * The address details modal. No em dash anywhere; the Verify texts never call an address safe or
 * unsafe, and nothing here names the person behind an address.
 */
export interface AddressDetailsLocale {
  openDetails: (label: string) => string;
  dialogTitle: string;
  close: string;

  // Section headings
  secDetails: string;
  secVerify: string;
  secHistory: string;
  secQr: string;

  // Details
  fieldLabel: string;
  fieldCategory: string;
  fieldChain: string;
  fieldAddress: string;
  fieldNotes: string;
  fieldPhone: string;
  chainNotSet: string;
  copy: string;
  copied: string;
  openOn: (explorer: string) => string;
  openOnPick: string;
  noExplorer: string;
  notOnchain: string;
  notRecognized: string;

  // Verify
  verifyIntro: string;
  verifyChecking: string;
  verifyVerified: (domain: string, since: string | null) => string;
  verifyCard: string;
  verifyClaimed: (since: string | null) => string;
  verifyNotClaimed: string;
  verifyFailed: string;

  // Your history
  historyIntro: string;
  historyLoading: string;
  /** Bitcoin, Litecoin, Solana and Sui rows keep their counterparty only from syncs after it was added. */
  historySyncedOnly: string;
  /** Bitcoin and Litecoin: one counterparty per transaction, the first that isn't the user's. */
  historyBtcFirst: string;
  historyTooMany: string;
  historyEmpty: string;
  historyFailed: string;
  ownWallet: (label: string | null) => string;
  openWalletTx: string;
  range: (first: string, last: string) => string;
  sent: string;
  received: string;
  txCount: (n: number) => string;
  youSent: string;
  youReceived: string;
  dirLost: string;
  dirOther: string;
  failedTx: string;
  unknownAmount: string;
  viewTx: string;
  latest: (n: number) => string;

  // QR code
  qrAlt: string;
  qrLoading: string;
  qrFailed: string;
  qrScanCheck: string;
  qrEvmNetworks: (label: string) => string;
  qrDownload: string;
}

export const en: AddressLabelsLocale = {
  lang: 'en',

  eyebrow: 'Counterparties',
  heading: 'Address Labels',
  description:
    'Tag exchange hot wallets, other people’s wallets, and services so they show up with a name in your history. These are not your wallets and are not added to the Vault.',

  formEyebrow: 'Tag an address',
  scanBtnTitle: 'Upload a screenshot. Claude will read the wallet address for you',
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


  sourceCommunity: 'automatic',

  removeBtn: 'Remove',

  catBadgeDefi: 'DeFi',
  catBadgeExchange: 'Exchange',
  catBadgePersonal: 'Personal',
  catBadgeBridge: 'Bridge',
  catBadgeOther: 'Other',

  details: {
    openDetails: (label) => `Show details for ${label}`,
    dialogTitle: 'Address details',
    close: 'Close',

    secDetails: 'Details',
    secVerify: 'Verify',
    secHistory: 'Your history',
    secQr: 'QR code',

    fieldLabel: 'Label',
    fieldCategory: 'Category',
    fieldChain: 'Chain',
    fieldAddress: 'Address',
    fieldNotes: 'Notes',
    fieldPhone: 'Phone',
    chainNotSet: 'Not set',
    copy: 'Copy',
    copied: 'Copied',
    openOn: (explorer) => `Open on ${explorer}`,
    openOnPick: 'Open on:',
    noExplorer: 'No block explorer link for this value.',
    notOnchain: 'This is an account inside an exchange, not a blockchain address.',
    notRecognized: 'This is not a blockchain address Almstins recognizes.',

    verifyIntro: 'Whether the owner of this address has proven it with Almstins Verify. It never shows who the owner is.',
    verifyChecking: 'Checking…',
    verifyVerified: (domain, since) => (since ? `Verified by ${domain} since ${since}` : `Verified by ${domain}`),
    verifyCard: 'See the public card',
    verifyClaimed: (since) => (since ? `Claimed since ${since}` : 'Claimed'),
    verifyNotClaimed: 'Not claimed with Almstins Verify.',
    verifyFailed: 'Couldn’t check right now.',

    historyIntro: 'Only your own records with this address.',
    historyLoading: 'Loading your history…',
    historySyncedOnly: 'For Bitcoin, Litecoin, Solana and Sui, only transactions saved by a wallet sync since October 2026 show here, so older ones may be missing.',
    historyBtcFirst: 'A Bitcoin or Litecoin transaction can have several senders and receivers. It shows here under the first one that isn’t your wallet.',
    historyTooMany: 'You have more than 5,000 transactions with this address, too many to show here.',
    historyEmpty: 'No transactions with this address in your records.',
    historyFailed: 'Couldn’t load your history right now.',
    ownWallet: (label) => (label ? `This is your wallet ${label}.` : 'This is one of your wallets.'),
    openWalletTx: 'Open this wallet’s transactions',
    range: (first, last) => (first === last ? first : `${first} to ${last}`),
    sent: 'Sent',
    received: 'Received',
    txCount: (n) => (n === 1 ? '1 transaction' : `${n} transactions`),
    youSent: 'You sent',
    youReceived: 'You received',
    dirLost: 'Left your account',
    dirOther: 'Moved',
    failedTx: 'Failed',
    unknownAmount: 'not known',
    viewTx: 'View',
    latest: (n) => `Showing the latest ${n}.`,

    qrAlt: 'QR code of this address',
    qrLoading: 'Drawing the QR code…',
    qrFailed: 'Couldn’t draw the QR code.',
    qrScanCheck: 'After scanning, check that the first and last characters match.',
    qrEvmNetworks: (label) => `This address works on Ethereum, Polygon, Avalanche and BSC. Send on the network ${label} expects.`,
    qrDownload: 'Download PNG',
  },
};

export const es: AddressLabelsLocale = {
  lang: 'es',

  eyebrow: "Contrapartes",
  heading: "Etiquetas de direcciones",
  description:
    "Etiqueta billeteras de intercambios, billeteras de otras personas y servicios para que aparezcan con un nombre en tu historial. Estas no son tus billeteras y no se agregan al Vault.",

  formEyebrow: "Etiquetar una dirección",
  scanBtnTitle: "Sube una captura de pantalla. Claude leerá la dirección de la billetera por ti",
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


  sourceCommunity: "automática",

  removeBtn: "Eliminar",

  catBadgeDefi: "DeFi",
  catBadgeExchange: "Exchange",
  catBadgePersonal: "Personal",
  catBadgeBridge: "Bridge",
  catBadgeOther: "Otro",

  details: {
    openDetails: (label) => `Ver detalles de ${label}`,
    dialogTitle: "Detalles de la dirección",
    close: "Cerrar",

    secDetails: "Detalles",
    secVerify: "Verify",
    secHistory: "Tu historial",
    secQr: "Código QR",

    fieldLabel: "Etiqueta",
    fieldCategory: "Categoría",
    fieldChain: "Red",
    fieldAddress: "Dirección",
    fieldNotes: "Notas",
    fieldPhone: "Teléfono",
    chainNotSet: "Sin indicar",
    copy: "Copiar",
    copied: "Copiado",
    openOn: (explorer) => `Abrir en ${explorer}`,
    openOnPick: "Abrir en:",
    noExplorer: "No hay enlace a un explorador de bloques para este valor.",
    notOnchain: "Esta es una cuenta dentro de un exchange, no una dirección de blockchain.",
    notRecognized: "Esta no es una dirección de blockchain que Almstins reconozca.",

    verifyIntro: "Si el dueño de esta dirección la ha demostrado con Almstins Verify. Nunca muestra quién es el dueño.",
    verifyChecking: "Comprobando…",
    verifyVerified: (domain, since) => (since ? `Verificada por ${domain} desde ${since}` : `Verificada por ${domain}`),
    verifyCard: "Ver la ficha pública",
    verifyClaimed: (since) => (since ? `Reclamada desde ${since}` : "Reclamada"),
    verifyNotClaimed: "No reclamada con Almstins Verify.",
    verifyFailed: "No se pudo comprobar ahora.",

    historyIntro: "Solo tus propios registros con esta dirección.",
    historyLoading: "Cargando tu historial…",
    historySyncedOnly: "En Bitcoin, Litecoin, Solana y Sui solo aparecen aquí las transacciones guardadas por una sincronización de la billetera desde octubre de 2026, así que pueden faltar las más antiguas.",
    historyBtcFirst: "Una transacción de Bitcoin o Litecoin puede tener varios remitentes y destinatarios. Aparece aquí con el primero que no es tu billetera.",
    historyTooMany: "Tienes más de 5.000 transacciones con esta dirección, demasiadas para mostrarlas aquí.",
    historyEmpty: "No hay transacciones con esta dirección en tus registros.",
    historyFailed: "No se pudo cargar tu historial ahora.",
    ownWallet: (label) => (label ? `Esta es tu billetera ${label}.` : "Esta es una de tus billeteras."),
    openWalletTx: "Abrir las transacciones de esta billetera",
    range: (first, last) => (first === last ? first : `${first} a ${last}`),
    sent: "Enviado",
    received: "Recibido",
    txCount: (n) => (n === 1 ? "1 transacción" : `${n} transacciones`),
    youSent: "Enviaste",
    youReceived: "Recibiste",
    dirLost: "Salió de tu cuenta",
    dirOther: "Movimiento",
    failedTx: "Fallida",
    unknownAmount: "desconocido",
    viewTx: "Ver",
    latest: (n) => `Se muestran las ${n} más recientes.`,

    qrAlt: "Código QR de esta dirección",
    qrLoading: "Generando el código QR…",
    qrFailed: "No se pudo generar el código QR.",
    qrScanCheck: "Después de escanear, comprueba que los primeros y últimos caracteres coincidan.",
    qrEvmNetworks: (label) => `Esta dirección funciona en Ethereum, Polygon, Avalanche y BSC. Envía en la red que espera ${label}.`,
    qrDownload: "Descargar PNG",
  },
};

export const fr: AddressLabelsLocale = {
  lang: 'fr',

  eyebrow: "Contreparties",
  heading: "Libellés d'adresses",
  description:
    "Identifiez les portefeuilles des exchanges, les portefeuilles d'autres personnes et les services pour qu'ils apparaissent avec un nom dans votre historique. Ce ne sont pas vos portefeuilles et ils ne sont pas ajoutés au Vault.",

  formEyebrow: "Identifier une adresse",
  scanBtnTitle: "Importez une capture d'écran. Claude lira l'adresse du portefeuille pour vous",
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


  sourceCommunity: "automatique",

  removeBtn: "Supprimer",

  catBadgeDefi: "DeFi",
  catBadgeExchange: "Exchange",
  catBadgePersonal: "Personnel",
  catBadgeBridge: "Bridge",
  catBadgeOther: "Autre",

  details: {
    openDetails: (label) => `Afficher les détails de ${label}`,
    dialogTitle: "Détails de l'adresse",
    close: "Fermer",

    secDetails: "Détails",
    secVerify: "Verify",
    secHistory: "Votre historique",
    secQr: "Code QR",

    fieldLabel: "Libellé",
    fieldCategory: "Catégorie",
    fieldChain: "Chaîne",
    fieldAddress: "Adresse",
    fieldNotes: "Notes",
    fieldPhone: "Téléphone",
    chainNotSet: "Non précisée",
    copy: "Copier",
    copied: "Copiée",
    openOn: (explorer) => `Ouvrir sur ${explorer}`,
    openOnPick: "Ouvrir sur :",
    noExplorer: "Aucun lien vers un explorateur de blocs pour cette valeur.",
    notOnchain: "C'est un compte dans un exchange, pas une adresse de blockchain.",
    notRecognized: "Ce n'est pas une adresse de blockchain reconnue par Almstins.",

    verifyIntro: "Si le propriétaire de cette adresse l'a prouvée avec Almstins Verify. Cela n'indique jamais qui est le propriétaire.",
    verifyChecking: "Vérification…",
    verifyVerified: (domain, since) => (since ? `Vérifiée par ${domain} depuis le ${since}` : `Vérifiée par ${domain}`),
    verifyCard: "Voir la fiche publique",
    verifyClaimed: (since) => (since ? `Revendiquée depuis le ${since}` : "Revendiquée"),
    verifyNotClaimed: "Non revendiquée avec Almstins Verify.",
    verifyFailed: "Vérification impossible pour le moment.",

    historyIntro: "Uniquement vos propres enregistrements avec cette adresse.",
    historyLoading: "Chargement de votre historique…",
    historySyncedOnly: "Pour Bitcoin, Litecoin, Solana et Sui, seules les transactions enregistrées par une synchronisation du portefeuille depuis octobre 2026 apparaissent ici, les plus anciennes peuvent donc manquer.",
    historyBtcFirst: "Une transaction Bitcoin ou Litecoin peut avoir plusieurs expéditeurs et destinataires. Elle apparaît ici avec le premier qui n'est pas votre portefeuille.",
    historyTooMany: "Vous avez plus de 5 000 transactions avec cette adresse, trop pour les afficher ici.",
    historyEmpty: "Aucune transaction avec cette adresse dans vos enregistrements.",
    historyFailed: "Impossible de charger votre historique pour le moment.",
    ownWallet: (label) => (label ? `C'est votre portefeuille ${label}.` : "C'est l'un de vos portefeuilles."),
    openWalletTx: "Ouvrir les transactions de ce portefeuille",
    range: (first, last) => (first === last ? first : `du ${first} au ${last}`),
    sent: "Envoyé",
    received: "Reçu",
    txCount: (n) => (n === 1 ? "1 transaction" : `${n} transactions`),
    youSent: "Vous avez envoyé",
    youReceived: "Vous avez reçu",
    dirLost: "Sorti de votre compte",
    dirOther: "Mouvement",
    failedTx: "Échouée",
    unknownAmount: "inconnu",
    viewTx: "Voir",
    latest: (n) => `Affichage des ${n} plus récentes.`,

    qrAlt: "Code QR de cette adresse",
    qrLoading: "Création du code QR…",
    qrFailed: "Impossible de créer le code QR.",
    qrScanCheck: "Après le scan, vérifiez que les premiers et derniers caractères correspondent.",
    qrEvmNetworks: (label) => `Cette adresse fonctionne sur Ethereum, Polygon, Avalanche et BSC. Envoyez sur le réseau qu'attend ${label}.`,
    qrDownload: "Télécharger le PNG",
  },
};

const MAP: Record<Lang, AddressLabelsLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getAddressLabels(lang: Lang): AddressLabelsLocale {
  return MAP[lang] ?? en;
}
