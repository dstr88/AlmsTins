// Price Alerts dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): alerts.astro reads getLang(Astro.request) and selects
// via getAlerts(lang). These are the strings the PAGE owns — heading, intro,
// the info sticky note, the add-alert form, the list section, empty/error
// states, plus the handful of client-side script strings (status messages,
// delete confirm, direction pills) injected into the inline <script> via
// define:vars.
//
// Crypto jargon stays English per design.claude.md: asset, Aave, health factor,
// collateral, liquidation, tax-loss harvesting, DeFi. Ticker symbols and $
// amounts are never translated. ES/FR are first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface AlertsLocale {
  lang: Lang;
  pageTitle: string;
  // Header
  heroTitle: string;
  intro: string;
  // Sticky note
  noteHeading: string;
  notePriceAlert: string; // contains a <strong>…</strong> span
  noteHealthAlert: string; // contains a <strong>…</strong> span
  noteTip: string;
  // No alert email warning
  noEmailTitle: string;
  noEmailTextBefore: string;
  noEmailLink: string;
  noEmailTextAfter: string;
  // Email confirmed line
  emailLineBefore: string;
  emailLineAfter: string;
  emailChange: string;
  // Add alert form
  addHeading: string;
  labelAsset: string;
  labelCondition: string;
  labelPrice: string;
  optionAbove: string;
  optionBelow: string;
  pricePlaceholder: string;
  addBtn: string;
  // List section
  listHeading: string;
  loading: string;
  emptyTitle: string;
  emptyText: string;
  loadError: string;
  // Client-side script strings
  pillAbove: string;
  pillBelow: string;
  deleteTitle: string;
  /** "Delete alert for {symbol} {direction} {price}?" */
  deleteConfirm: (symbol: string, direction: string, price: string) => string;
  /**
   * Static fragments of deleteConfirm, passed into the client <script> via
   * define:vars (which cannot serialize functions). The client assembles:
   * `${deleteBefore}${symbol} ${direction} ${price}${deleteSuffix}`.
   */
  deleteBefore: string;
  deleteSuffix: string;
  saving: string;
  added: string;
  failed: string;
  networkError: string;
}

export const en: AlertsLocale = {
  lang: 'en',
  pageTitle: 'Price Alerts | Almstins',
  heroTitle: 'Price Alerts',
  intro:
    'Get an email when any asset crosses a price threshold you set. Useful for harvesting decisions and entry/exit timing.',
  noteHeading: 'Stay one step ahead of your portfolio.',
  notePriceAlert:
    'Set a <strong style="color:var(--text-primary);">price alert</strong> and get an email the moment any asset crosses a threshold you choose — useful for timing entries, exits, and tax-loss harvesting decisions.',
  noteHealthAlert:
    '<strong style="color:var(--text-primary);">DeFi health alerts</strong> notify you when your collateral ratio approaches the liquidation zone, giving you time to add collateral or reduce debt before the protocol acts for you.',
  noteTip:
    "Tip: set a health factor alert at 1.3 if you're borrowing on Aave — it gives you a buffer before the 1.0 liquidation floor.",
  noEmailTitle: 'Alert email not set',
  noEmailTextBefore: "You won't receive notifications until you add an alert email in your ",
  noEmailLink: 'Account settings',
  noEmailTextAfter: '.',
  emailLineBefore: 'Alerts will be sent to ',
  emailLineAfter: '.',
  emailChange: 'Change',
  addHeading: 'Add New Alert',
  labelAsset: 'Asset',
  labelCondition: 'Condition',
  labelPrice: 'Price (USD)',
  optionAbove: 'Price rises above',
  optionBelow: 'Price drops below',
  pricePlaceholder: 'e.g. 100000',
  addBtn: 'Add Alert',
  listHeading: 'Your Alerts',
  loading: 'Loading…',
  emptyTitle: 'No alerts yet',
  emptyText: 'Add one above to get started.',
  loadError: 'Failed to load alerts. Please refresh.',
  pillAbove: '↑ above',
  pillBelow: '↓ below',
  deleteTitle: 'Delete alert',
  deleteConfirm: (symbol, direction, price) => `Delete alert for ${symbol} ${direction} ${price}?`,
  deleteBefore: 'Delete alert for ',
  deleteSuffix: '?',
  saving: 'Saving…',
  added: '✓ Alert added!',
  failed: 'Failed',
  networkError: 'Network error',
};

export const es: AlertsLocale = {
  lang: 'es',
  pageTitle: 'Alertas de precio | Almstins',
  heroTitle: 'Alertas de precio',
  intro:
    'Recibe un correo cuando cualquier asset cruce un umbral de precio que definas. Útil para decisiones de harvesting y para sincronizar entradas y salidas.',
  noteHeading: 'Mantente un paso por delante de tu portafolio.',
  notePriceAlert:
    'Crea una <strong style="color:var(--text-primary);">alerta de precio</strong> y recibe un correo en cuanto cualquier asset cruce el umbral que elijas — útil para sincronizar entradas, salidas y decisiones de tax-loss harvesting.',
  noteHealthAlert:
    'Las <strong style="color:var(--text-primary);">alertas de salud DeFi</strong> te avisan cuando tu collateral ratio se acerca a la zona de liquidación, dándote tiempo para añadir collateral o reducir deuda antes de que el protocolo actúe por ti.',
  noteTip:
    'Consejo: configura una alerta de health factor en 1.3 si pides prestado en Aave — te da un margen antes del piso de liquidación de 1.0.',
  noEmailTitle: 'Correo de alertas no configurado',
  noEmailTextBefore: 'No recibirás notificaciones hasta que añadas un correo de alertas en tus ',
  noEmailLink: 'Ajustes de cuenta',
  noEmailTextAfter: '.',
  emailLineBefore: 'Las alertas se enviarán a ',
  emailLineAfter: '.',
  emailChange: 'Cambiar',
  addHeading: 'Añadir nueva alerta',
  labelAsset: 'Asset',
  labelCondition: 'Condición',
  labelPrice: 'Precio (USD)',
  optionAbove: 'El precio sube por encima de',
  optionBelow: 'El precio baja por debajo de',
  pricePlaceholder: 'ej. 100000',
  addBtn: 'Añadir alerta',
  listHeading: 'Tus alertas',
  loading: 'Cargando…',
  emptyTitle: 'Aún no hay alertas',
  emptyText: 'Añade una arriba para empezar.',
  loadError: 'No se pudieron cargar las alertas. Actualiza la página.',
  pillAbove: '↑ por encima',
  pillBelow: '↓ por debajo',
  deleteTitle: 'Eliminar alerta',
  deleteConfirm: (symbol, direction, price) => `¿Eliminar la alerta de ${symbol} ${direction} ${price}?`,
  deleteBefore: '¿Eliminar la alerta de ',
  deleteSuffix: '?',
  saving: 'Guardando…',
  added: '✓ ¡Alerta añadida!',
  failed: 'Error',
  networkError: 'Error de red',
};

export const fr: AlertsLocale = {
  lang: 'fr',
  pageTitle: 'Alertes de prix | Almstins',
  heroTitle: 'Alertes de prix',
  intro:
    "Recevez un e-mail dès qu'un asset franchit un seuil de prix que vous définissez. Utile pour les décisions de harvesting et le timing des entrées/sorties.",
  noteHeading: 'Gardez une longueur d’avance sur votre portefeuille.',
  notePriceAlert:
    "Créez une <strong style=\"color:var(--text-primary);\">alerte de prix</strong> et recevez un e-mail dès qu'un asset franchit le seuil que vous choisissez — utile pour synchroniser les entrées, les sorties et les décisions de tax-loss harvesting.",
  noteHealthAlert:
    "Les <strong style=\"color:var(--text-primary);\">alertes de santé DeFi</strong> vous préviennent lorsque votre collateral ratio approche de la zone de liquidation, vous laissant le temps d'ajouter du collateral ou de réduire la dette avant que le protocole n'agisse à votre place.",
  noteTip:
    "Astuce : réglez une alerte de health factor à 1.3 si vous empruntez sur Aave — cela vous donne une marge avant le seuil de liquidation de 1.0.",
  noEmailTitle: "E-mail d'alerte non défini",
  noEmailTextBefore: "Vous ne recevrez aucune notification tant que vous n'aurez pas ajouté un e-mail d'alerte dans vos ",
  noEmailLink: 'Paramètres du compte',
  noEmailTextAfter: '.',
  emailLineBefore: 'Les alertes seront envoyées à ',
  emailLineAfter: '.',
  emailChange: 'Modifier',
  addHeading: 'Ajouter une alerte',
  labelAsset: 'Asset',
  labelCondition: 'Condition',
  labelPrice: 'Prix (USD)',
  optionAbove: 'Le prix dépasse',
  optionBelow: 'Le prix passe sous',
  pricePlaceholder: 'ex. 100000',
  addBtn: 'Ajouter une alerte',
  listHeading: 'Vos alertes',
  loading: 'Chargement…',
  emptyTitle: 'Aucune alerte pour le moment',
  emptyText: 'Ajoutez-en une ci-dessus pour commencer.',
  loadError: 'Échec du chargement des alertes. Veuillez actualiser.',
  pillAbove: '↑ au-dessus',
  pillBelow: '↓ en dessous',
  deleteTitle: "Supprimer l'alerte",
  deleteConfirm: (symbol, direction, price) => `Supprimer l'alerte pour ${symbol} ${direction} ${price} ?`,
  deleteBefore: "Supprimer l'alerte pour ",
  deleteSuffix: ' ?',
  saving: 'Enregistrement…',
  added: '✓ Alerte ajoutée !',
  failed: 'Échec',
  networkError: 'Erreur réseau',
};

const MAP: Record<Lang, AlertsLocale> = { en, es, fr };

/** Select the Price Alerts locale for a language, falling back to English. */
export function getAlerts(lang: Lang): AlertsLocale {
  return MAP[lang] ?? en;
}
