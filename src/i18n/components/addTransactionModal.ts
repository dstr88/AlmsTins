// AddTransactionModal component — EN · ES · FR.
//
// Covers: modal title, tab labels, form field labels, placeholders, select
// display options, button text, and client-script status/validation messages.
//
// NOT translated: option value="" attributes (API enum values), crypto tickers,
// chain names (Bitcoin, Ethereum, etc.), className, data attributes.

import type { Lang } from '@/lib/i18n/locale';

export interface AddTransactionModalLocale {
  // Header
  title: string;
  closeAriaLabel: string;

  // Tabs
  tabHashLookup: string;
  tabManualEntry: string;

  // Hash panel
  hashHint: string;
  labelTxHash: string;
  labelChain: string;
  btnLookup: string;

  // Prefill grid
  prefillDate: string;
  prefillFrom: string;
  prefillTo: string;
  prefillValue: string;

  // Shared field labels / decorators
  labelTokenSymbol: string;
  labelUsdValue: string;
  labelKind: string;
  labelSentToAddress: string;
  labelNotes: string;
  optional: string;
  required: string;

  // Kind select placeholder (both panels)
  kindSelectPlaceholder: string;

  // Hash panel placeholders
  hashSymbolPlaceholder: string;
  hashDestinationPlaceholder: string;
  hashNotesPlaceholder: string;

  // Hash panel submit
  btnSaveTransaction: string;

  // Manual panel
  manualHint: string;
  labelDate: string;
  labelChainOptional: string;
  chainCustomUnknown: string;
  labelSymbol: string;
  labelAmount: string;
  labelDirection: string;
  dirIn: string;
  dirOut: string;
  manualSymbolPlaceholder: string;
  manualAmountPlaceholder: string;
  manualDestinationPlaceholder: string;
  manualNotesPlaceholder: string;

  // Manual panel submit
  btnSaveManual: string;

  // Client script — hash lookup status
  scriptEnterHashFirst: string;
  scriptLookingUp: string;
  scriptLookupFailed: string;
  scriptTxNotFound: string;
  scriptFoundReview: string;
  scriptNetworkErrorLookup: string;

  // Client script — hash submit validation / status
  scriptHashRequired: string;
  scriptSaving: string;
  scriptUnableToSave: string;
  scriptSaved: string;
  scriptNetworkError: string;

  // Client script — manual submit validation
  scriptDateRequired: string;
  scriptSymbolRequired: string;
  scriptPositiveAmount: string;
}

export const en: AddTransactionModalLocale = {
  title: 'Add Transaction',
  closeAriaLabel: 'Close',

  tabHashLookup: 'Hash Lookup',
  tabManualEntry: 'Manual Entry',

  hashHint: "Paste a transaction hash — we'll look it up and pre-fill the details.",
  labelTxHash: 'Tx Hash',
  labelChain: 'Chain',
  btnLookup: 'Look up',

  prefillDate: 'Date',
  prefillFrom: 'From',
  prefillTo: 'To',
  prefillValue: 'Value',

  labelTokenSymbol: 'Token Symbol',
  labelUsdValue: 'USD Value',
  labelKind: 'Kind',
  labelSentToAddress: 'Sent To Address',
  labelNotes: 'Notes',
  optional: 'optional',
  required: 'required',

  kindSelectPlaceholder: '— select —',

  hashSymbolPlaceholder: 'e.g. ETH, AVAX, USDC',
  hashDestinationPlaceholder: 'Destination address…',
  hashNotesPlaceholder: 'e.g. BTC from Ledger, sent to cold storage…',

  btnSaveTransaction: 'Save Transaction',

  manualHint: 'No hash? Enter everything manually — good for off-chain purchases or unknown exchanges.',
  labelDate: 'Date',
  labelChainOptional: 'Chain',
  chainCustomUnknown: 'Custom / Unknown',
  labelSymbol: 'Symbol',
  labelAmount: 'Amount',
  labelDirection: 'Direction',
  dirIn: 'In',
  dirOut: 'Out',
  manualSymbolPlaceholder: 'BTC, ETH…',
  manualAmountPlaceholder: '0.00',
  manualDestinationPlaceholder: 'Destination address…',
  manualNotesPlaceholder: 'e.g. Bought BTC on Venmo, sent to Ledger hardware wallet…',

  btnSaveManual: 'Save Transaction',

  scriptEnterHashFirst: 'Enter a tx hash first.',
  scriptLookingUp: 'Looking up…',
  scriptLookupFailed: 'Lookup failed.',
  scriptTxNotFound: 'Tx not found on explorer — fill in details manually below.',
  scriptFoundReview: 'Found — review details, then save.',
  scriptNetworkErrorLookup: 'Network error during lookup.',

  scriptHashRequired: 'A tx hash is required.',
  scriptSaving: 'Saving…',
  scriptUnableToSave: 'Unable to save.',
  scriptSaved: 'Saved!',
  scriptNetworkError: 'Network error — please try again.',

  scriptDateRequired: 'Date is required.',
  scriptSymbolRequired: 'Symbol is required.',
  scriptPositiveAmount: 'Enter a positive amount.',
};

export const es: AddTransactionModalLocale = {
  title: 'Agregar transaccion',
  closeAriaLabel: 'Cerrar',

  tabHashLookup: 'Buscar por hash',
  tabManualEntry: 'Entrada manual',

  hashHint: "Pega un hash de transaccion — lo buscaremos y rellenaremos los detalles.",
  labelTxHash: 'Hash de tx',
  labelChain: 'Red',
  btnLookup: 'Buscar',

  prefillDate: 'Fecha',
  prefillFrom: 'De',
  prefillTo: 'Para',
  prefillValue: 'Valor',

  labelTokenSymbol: 'Simbolo del token',
  labelUsdValue: 'Valor en USD',
  labelKind: 'Tipo',
  labelSentToAddress: 'Enviado a la direccion',
  labelNotes: 'Notas',
  optional: 'opcional',
  required: 'obligatorio',

  kindSelectPlaceholder: '— seleccionar —',

  hashSymbolPlaceholder: 'p. ej. ETH, AVAX, USDC',
  hashDestinationPlaceholder: 'Direccion de destino…',
  hashNotesPlaceholder: 'p. ej. BTC desde Ledger, enviado a almacenamiento frio…',

  btnSaveTransaction: 'Guardar transaccion',

  manualHint: "Sin hash? Ingresa todo manualmente — ideal para compras fuera de la cadena o exchanges desconocidos.",
  labelDate: 'Fecha',
  labelChainOptional: 'Red',
  chainCustomUnknown: 'Personalizado / Desconocido',
  labelSymbol: 'Simbolo',
  labelAmount: 'Cantidad',
  labelDirection: 'Direccion',
  dirIn: 'Entrada',
  dirOut: 'Salida',
  manualSymbolPlaceholder: 'BTC, ETH…',
  manualAmountPlaceholder: '0.00',
  manualDestinationPlaceholder: 'Direccion de destino…',
  manualNotesPlaceholder: 'p. ej. Compre BTC en Venmo, enviado a hardware wallet Ledger…',

  btnSaveManual: 'Guardar transaccion',

  scriptEnterHashFirst: 'Ingresa primero un hash de tx.',
  scriptLookingUp: 'Buscando…',
  scriptLookupFailed: 'Busqueda fallida.',
  scriptTxNotFound: 'Tx no encontrada en el explorador — completa los detalles manualmente abajo.',
  scriptFoundReview: 'Encontrada — revisa los detalles y guarda.',
  scriptNetworkErrorLookup: 'Error de red durante la busqueda.',

  scriptHashRequired: 'Se requiere un hash de tx.',
  scriptSaving: 'Guardando…',
  scriptUnableToSave: 'No se pudo guardar.',
  scriptSaved: 'Guardado!',
  scriptNetworkError: 'Error de red — intentalo de nuevo.',

  scriptDateRequired: 'La fecha es obligatoria.',
  scriptSymbolRequired: 'El simbolo es obligatorio.',
  scriptPositiveAmount: 'Ingresa una cantidad positiva.',
};

export const fr: AddTransactionModalLocale = {
  title: 'Ajouter une transaction',
  closeAriaLabel: 'Fermer',

  tabHashLookup: 'Recherche par hash',
  tabManualEntry: 'Saisie manuelle',

  hashHint: "Collez un hash de transaction — nous le rechercherons et remplirons les details.",
  labelTxHash: 'Hash de tx',
  labelChain: 'Reseau',
  btnLookup: 'Rechercher',

  prefillDate: 'Date',
  prefillFrom: 'De',
  prefillTo: 'Vers',
  prefillValue: 'Valeur',

  labelTokenSymbol: 'Symbole du token',
  labelUsdValue: 'Valeur en USD',
  labelKind: 'Type',
  labelSentToAddress: "Envoye a l'adresse",
  labelNotes: 'Notes',
  optional: 'optionnel',
  required: 'obligatoire',

  kindSelectPlaceholder: '— selectionner —',

  hashSymbolPlaceholder: 'ex. ETH, AVAX, USDC',
  hashDestinationPlaceholder: 'Adresse de destination…',
  hashNotesPlaceholder: 'ex. BTC depuis Ledger, envoye en stockage froid…',

  btnSaveTransaction: 'Enregistrer la transaction',

  manualHint: "Pas de hash ? Saisissez tout manuellement — ideal pour les achats hors chaine ou les exchanges inconnus.",
  labelDate: 'Date',
  labelChainOptional: 'Reseau',
  chainCustomUnknown: 'Personnalise / Inconnu',
  labelSymbol: 'Symbole',
  labelAmount: 'Montant',
  labelDirection: 'Direction',
  dirIn: 'Entree',
  dirOut: 'Sortie',
  manualSymbolPlaceholder: 'BTC, ETH…',
  manualAmountPlaceholder: '0.00',
  manualDestinationPlaceholder: 'Adresse de destination…',
  manualNotesPlaceholder: 'ex. Achat de BTC sur Venmo, envoye au hardware wallet Ledger…',

  btnSaveManual: 'Enregistrer la transaction',

  scriptEnterHashFirst: "Saisissez d'abord un hash de tx.",
  scriptLookingUp: 'Recherche en cours…',
  scriptLookupFailed: 'Recherche echouee.',
  scriptTxNotFound: "Tx introuvable sur l'explorateur — remplissez les details manuellement ci-dessous.",
  scriptFoundReview: 'Trouvee — verifiez les details, puis enregistrez.',
  scriptNetworkErrorLookup: 'Erreur reseau lors de la recherche.',

  scriptHashRequired: 'Un hash de tx est obligatoire.',
  scriptSaving: 'Enregistrement…',
  scriptUnableToSave: "Impossible d'enregistrer.",
  scriptSaved: 'Enregistre !',
  scriptNetworkError: 'Erreur reseau — veuillez reessayer.',

  scriptDateRequired: 'La date est obligatoire.',
  scriptSymbolRequired: 'Le symbole est obligatoire.',
  scriptPositiveAmount: 'Saisissez un montant positif.',
};

const MAP: Record<Lang, AddTransactionModalLocale> = { en, es, fr };

export function getAddTransactionModal(lang: Lang): AddTransactionModalLocale {
  return MAP[lang] ?? en;
}
