// AaveHealthSummary (React island) — user-facing strings (EN · ES · FR).
//
// React-island i18n pattern: the component reads the language client-side via
// getClientLang() (the almstins-lang cookie) and selects with the get*() helper.
// $ currency formatting stays en-US (consistent dollar format). Crypto jargon /
// tickers / protocol names (Aave) / chain names stay English. ES/FR first-pass.

import type { Lang } from '@/lib/i18n/locale';

export interface AaveHealthSummaryLocale {
  lang: Lang;

  // AlertPill — inactive state
  setAlert: string;

  // AlertPill — active state pill label (dynamic: direction symbol + threshold number)
  activePillLabel: (dirSymbol: string, threshold: string | number) => string;

  // AlertPill button titles
  editAlertTitle: string;
  setAlertTitle: string;

  // AlertPill panel
  panelTitle: string;
  panelSub: string;
  panelAccountLink: string;
  alertWhenHfIs: string;
  directionBelow: string;
  directionAbove: string;
  thresholdLabel: string;
  savingBtn: string;
  saveAlertBtn: string;
  disableBtn: string;

  // Health-factor alert row label (labels the relocated AlertPill row)
  healthAlertLabel: string;

  // LiquidationCallout header (dynamic: chain name + date string)
  liquidationHeader: (chain: string, date: string) => string;

  // LiquidationCallout rows
  loanCleared: string;
  collateralSeized: string;
  penaltyToLiquidator: string;
  viewTransaction: string;
  taxableDisposal: string;

  // LiquidationAlertToggle
  liquidationEmail: string;
  liqAlertOnTitle: string;
  liqAlertOffTitle: string;
  liqAlertOn: string;
  liqAlertOff: string;

  // Health factor row label (dynamic: chain name already capitalized)
  chainHealthLabel: (chain: string) => string;

  // Fallback health row label (when no chain-specific rows)
  healthLabel: string;

  // Main stats
  collateralLabel: string;
  debtLabel: string;
  netLabel: string;

  // Collateral breakdown section
  breakdownTitle: string;

  // Breakdown table headers
  colDays: string;
  colAsset: string;
  colQty: string;
  colPrice: string;
  // colUsd intentionally omitted — "USD" stays as-is (currency abbreviation)
  // colPL intentionally omitted — "P/L" stays as-is (universal abbreviation)

  // Breakdown empty state
  breakdownEmpty: string;

  // Status messages
  refreshing: string;
  loadingHealthFactor: string;
  errorHealthFactor: string;
}

export const en: AaveHealthSummaryLocale = {
  lang: 'en',

  setAlert: 'Set Alert',
  activePillLabel: (dirSymbol, threshold) => `HF ${dirSymbol} ${threshold}`,
  editAlertTitle: 'Edit health factor alert',
  setAlertTitle: 'Set health factor alert',

  panelTitle: 'Health Factor Alert',
  panelSub: 'Get an email when your health factor crosses a threshold.',
  panelAccountLink: 'Set alert email in Account ↗',
  alertWhenHfIs: 'Alert when HF is',
  directionBelow: 'below',
  directionAbove: 'above',
  thresholdLabel: 'Threshold',
  savingBtn: 'Saving…',
  saveAlertBtn: 'Save alert',
  disableBtn: 'Disable',
  healthAlertLabel: 'Health alert',

  liquidationHeader: (chain, date) => `Liquidation — ${chain} — ${date}`,
  loanCleared: 'Loan cleared',
  collateralSeized: 'Collateral seized',
  penaltyToLiquidator: 'Penalty to liquidator',
  viewTransaction: 'View transaction ↗',
  taxableDisposal: '⚠ Taxable disposal — logged to your bookkeeping records',

  liquidationEmail: 'Liquidation email',
  liqAlertOnTitle: 'Email alerts on — click to disable',
  liqAlertOffTitle: 'Click to receive an email if this position is liquidated',
  liqAlertOn: 'On',
  liqAlertOff: 'Off',

  chainHealthLabel: (chain) => `${chain} Health`,
  healthLabel: 'Health',

  collateralLabel: 'Collateral',
  debtLabel: 'Debt',
  netLabel: 'Net',

  breakdownTitle: 'Collateral breakdown',

  colDays: 'Days',
  colAsset: 'Asset',
  colQty: 'Qty',
  colPrice: 'Price',

  breakdownEmpty: 'No collateral positions found.',

  refreshing: 'Refreshing…',
  loadingHealthFactor: 'Loading health factor…',
  errorHealthFactor: 'Unable to load health factor.',
};

export const es: AaveHealthSummaryLocale = {
  lang: 'es',

  setAlert: "Crear alerta",
  activePillLabel: (dirSymbol, threshold) => `HF ${dirSymbol} ${threshold}`,
  editAlertTitle: "Editar alerta de factor de salud",
  setAlertTitle: "Crear alerta de factor de salud",

  panelTitle: "Alerta de factor de salud",
  panelSub: "Recibe un correo cuando tu factor de salud cruce un umbral.",
  panelAccountLink: "Configurar correo de alerta en Cuenta ↗",
  alertWhenHfIs: "Alertar cuando HF sea",
  directionBelow: "menor que",
  directionAbove: "mayor que",
  thresholdLabel: "Umbral",
  savingBtn: "Guardando…",
  saveAlertBtn: "Guardar alerta",
  disableBtn: "Desactivar",
  healthAlertLabel: "Alerta de salud",

  liquidationHeader: (chain, date) => `Liquidación — ${chain} — ${date}`,
  loanCleared: "Préstamo liquidado",
  collateralSeized: "Garantía incautada",
  penaltyToLiquidator: "Penalización al liquidador",
  viewTransaction: "Ver transacción ↗",
  taxableDisposal: "⚠ Disposición imponible — registrada en tus registros contables",

  liquidationEmail: "Correo de liquidación",
  liqAlertOnTitle: "Alertas por correo activadas — haz clic para desactivar",
  liqAlertOffTitle: "Haz clic para recibir un correo si esta posición es liquidada",
  liqAlertOn: "Activado",
  liqAlertOff: "Desactivado",

  chainHealthLabel: (chain) => `Salud ${chain}`,
  healthLabel: "Salud",

  collateralLabel: "Garantía",
  debtLabel: "Deuda",
  netLabel: "Neto",

  breakdownTitle: "Desglose de garantías",

  colDays: "Días",
  colAsset: "Activo",
  colQty: "Cant.",
  colPrice: "Precio",

  breakdownEmpty: "No se encontraron posiciones de garantía.",

  refreshing: "Actualizando…",
  loadingHealthFactor: "Cargando factor de salud…",
  errorHealthFactor: "No se pudo cargar el factor de salud.",
};

export const fr: AaveHealthSummaryLocale = {
  lang: 'fr',

  setAlert: "Créer une alerte",
  activePillLabel: (dirSymbol, threshold) => `HF ${dirSymbol} ${threshold}`,
  editAlertTitle: "Modifier l'alerte du facteur de santé",
  setAlertTitle: "Créer une alerte du facteur de santé",

  panelTitle: "Alerte du facteur de santé",
  panelSub: "Recevez un e-mail lorsque votre facteur de santé franchit un seuil.",
  panelAccountLink: "Configurer l'e-mail d'alerte dans le Compte ↗",
  alertWhenHfIs: "Alerter quand HF est",
  directionBelow: "inférieur à",
  directionAbove: "supérieur à",
  thresholdLabel: "Seuil",
  savingBtn: "Enregistrement…",
  saveAlertBtn: "Enregistrer l'alerte",
  disableBtn: "Désactiver",
  healthAlertLabel: "Alerte de santé",

  liquidationHeader: (chain, date) => `Liquidation — ${chain} — ${date}`,
  loanCleared: "Prêt remboursé",
  collateralSeized: "Garantie saisie",
  penaltyToLiquidator: "Pénalité au liquidateur",
  viewTransaction: "Voir la transaction ↗",
  taxableDisposal: "⚠ Cession imposable — enregistrée dans vos registres comptables",

  liquidationEmail: "E-mail de liquidation",
  liqAlertOnTitle: "Alertes par e-mail activées — cliquez pour désactiver",
  liqAlertOffTitle: "Cliquez pour recevoir un e-mail si cette position est liquidée",
  liqAlertOn: "Activé",
  liqAlertOff: "Désactivé",

  chainHealthLabel: (chain) => `Santé ${chain}`,
  healthLabel: "Santé",

  collateralLabel: "Garantie",
  debtLabel: "Dette",
  netLabel: "Net",

  breakdownTitle: "Répartition des garanties",

  colDays: "Jours",
  colAsset: "Actif",
  colQty: "Qté",
  colPrice: "Prix",

  breakdownEmpty: "Aucune position de garantie trouvée.",

  refreshing: "Actualisation…",
  loadingHealthFactor: "Chargement du facteur de santé…",
  errorHealthFactor: "Impossible de charger le facteur de santé.",
};

const MAP: Record<Lang, AaveHealthSummaryLocale> = { en, es, fr };

/** Select the locale for a language, falling back to English. */
export function getAaveHealthSummary(lang: Lang): AaveHealthSummaryLocale {
  return MAP[lang] ?? en;
}
