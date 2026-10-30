// Tax page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Opening positions page strings (EN · ES · FR): the January 1, 2025 positions per coin and wallet.

import type { Lang } from '@/lib/i18n/locale';

export interface OpeningPositionsLocale {
  lang: Lang;
  pageTitle: string;
  heading: string;
  /** Plain-text subtitle. */
  subtitle: string;
  faqLinkLabel: string;
  notEnabled: string;
  empty: string;
  needsReviewHeading: string;
  /** "{n} coin needs a look" */
  needsReviewCount: (n: number) => string;
  sourceReconstruction: string;
  sourceOverride: string;
  overrideRejected: string;
  colWallet: string;
  colUnits: string;
  colCost: string;
  colAcquired: string;
  colPlacedBy: string;
  placedBy: Record<string, string>;
  gapReasons: Record<string, string>;
  gapDetails: Record<string, string>;
  allocationHeading: string;
  allocationHelp: string;
  allocationPlaceholder: string;
  save: string;
  remove: string;
  saving: string;
  saved: string;
  removed: string;
  rejected: string;
  networkError: string;
  noBasis: string;
}

const en: OpeningPositionsLocale = {
  lang: 'en',
  pageTitle: 'Opening positions',
  heading: 'Reconstructed January 1, 2025 positions',
  subtitle:
    "Each coin's cost from before 2025 is placed in the wallet or account that held it at the end of December 31, 2024. If you or your tax professional recorded a different allocation, enter it here; it replaces the reconstruction for that coin.",
  faqLinkLabel: 'IRS digital asset FAQ 93',
  notEnabled: 'Wallet-by-wallet matching is not switched on for this account, so there are no opening positions to show.',
  empty: 'No coins had cost left over at the end of 2024.',
  needsReviewHeading: 'Needs a look',
  needsReviewCount: (n) => `${n} ${n === 1 ? 'coin needs' : 'coins need'} a look`,
  sourceReconstruction: 'Rebuilt from your history',
  sourceOverride: 'Your own allocation',
  overrideRejected: 'The allocation you saved did not match your history, so the rebuilt positions are used.',
  colWallet: 'Wallet or account',
  colUnits: 'Units',
  colCost: 'Cost',
  colAcquired: 'Acquired',
  colPlacedBy: 'Placed by',
  placedBy: {
    origin: 'Bought here',
    fill: 'Moved here',
    override: 'Your allocation',
    placeholder: 'No basis on record',
    unallocated: 'Cost without units',
  },
  gapReasons: {
    jan1_position_gap: 'Does not match your history',
    allocation_override_rejected: 'Your allocation was not used',
  },
  gapDetails: {
    negative_balance: 'The wallet or account sent out more than it had on record',
    units_without_basis: 'Units held with no cost on record',
    basis_without_units: 'Cost on record with no units left to hold it',
    units_mismatch: 'The units per wallet differ from your history',
    duplicate_asset: 'More than one allocation for this coin',
    invalid_rows: 'A row could not be read',
    no_rows: 'No rows',
    unknown_asset: 'No cost left over for this coin',
  },
  allocationHeading: 'Enter your own allocation',
  allocationHelp:
    'One row per line: wallet key | acquired date | units | cost (optional). The units in each wallet must match the table above. All rows are saved together, or none.',
  allocationPlaceholder: 'wallet key | 2023-01-10 | 0.5 | 10000',
  save: 'Save allocation',
  remove: 'Remove saved allocation',
  saving: 'Saving…',
  saved: 'Saved.',
  removed: 'Removed.',
  rejected: 'Not saved: the allocation does not match your history.',
  networkError: 'Network error',
  noBasis: 'none',
};

const es: OpeningPositionsLocale = {
  lang: 'es',
  pageTitle: 'Posiciones iniciales',
  heading: 'Posiciones reconstruidas al 1 de enero de 2025',
  subtitle:
    'El costo de cada moneda anterior a 2025 se coloca en el wallet o la cuenta que la tenía al final del 31 de diciembre de 2024. Si tú o tu profesional de impuestos registraron otra asignación, ingrésala aquí; reemplaza la reconstrucción de esa moneda.',
  faqLinkLabel: 'Preguntas frecuentes 93 del IRS sobre activos digitales',
  notEnabled: 'El cálculo wallet por wallet no está activado para esta cuenta, así que no hay posiciones iniciales que mostrar.',
  empty: 'Ninguna moneda tenía costo pendiente al final de 2024.',
  needsReviewHeading: 'Necesita revisión',
  needsReviewCount: (n) => `${n} ${n === 1 ? 'moneda necesita' : 'monedas necesitan'} revisión`,
  sourceReconstruction: 'Reconstruida desde tu historial',
  sourceOverride: 'Tu propia asignación',
  overrideRejected: 'La asignación que guardaste no coincidía con tu historial, así que se usan las posiciones reconstruidas.',
  colWallet: 'Wallet o cuenta',
  colUnits: 'Unidades',
  colCost: 'Costo',
  colAcquired: 'Adquirida',
  colPlacedBy: 'Colocada por',
  placedBy: {
    origin: 'Comprada aquí',
    fill: 'Movida aquí',
    override: 'Tu asignación',
    placeholder: 'Sin costo registrado',
    unallocated: 'Costo sin unidades',
  },
  gapReasons: {
    jan1_position_gap: 'No coincide con tu historial',
    allocation_override_rejected: 'No se usó tu asignación',
  },
  gapDetails: {
    negative_balance: 'El wallet o la cuenta envió más de lo que tenía registrado',
    units_without_basis: 'Unidades en posesión sin costo registrado',
    basis_without_units: 'Costo registrado sin unidades que lo respalden',
    units_mismatch: 'Las unidades por wallet difieren de tu historial',
    duplicate_asset: 'Más de una asignación para esta moneda',
    invalid_rows: 'No se pudo leer una fila',
    no_rows: 'Sin filas',
    unknown_asset: 'No queda costo pendiente para esta moneda',
  },
  allocationHeading: 'Ingresa tu propia asignación',
  allocationHelp:
    'Una fila por línea: clave del wallet | fecha de adquisición | unidades | costo (opcional). Las unidades de cada wallet deben coincidir con la tabla de arriba. Se guardan todas las filas juntas, o ninguna.',
  allocationPlaceholder: 'clave del wallet | 2023-01-10 | 0.5 | 10000',
  save: 'Guardar asignación',
  remove: 'Quitar la asignación guardada',
  saving: 'Guardando…',
  saved: 'Guardada.',
  removed: 'Quitada.',
  rejected: 'No se guardó: la asignación no coincide con tu historial.',
  networkError: 'Error de red',
  noBasis: 'ninguno',
};

const fr: OpeningPositionsLocale = {
  lang: 'fr',
  pageTitle: 'Positions initiales',
  heading: 'Positions reconstruites au 1er janvier 2025',
  subtitle:
    "Le coût de chaque crypto antérieur à 2025 est placé dans le wallet ou le compte qui la détenait à la fin du 31 décembre 2024. Si vous ou votre conseiller fiscal avez enregistré une autre répartition, saisissez-la ici ; elle remplace la reconstruction pour cette crypto.",
  faqLinkLabel: "FAQ 93 de l'IRS sur les actifs numériques",
  notEnabled: "Le calcul wallet par wallet n'est pas activé pour ce compte, il n'y a donc aucune position initiale à afficher.",
  empty: 'Aucune crypto ne conservait de coût à la fin de 2024.',
  needsReviewHeading: 'À vérifier',
  needsReviewCount: (n) => `${n} ${n === 1 ? 'crypto à vérifier' : 'cryptos à vérifier'}`,
  sourceReconstruction: 'Reconstruite à partir de votre historique',
  sourceOverride: 'Votre propre répartition',
  overrideRejected: "La répartition enregistrée ne correspondait pas à votre historique ; les positions reconstruites sont utilisées.",
  colWallet: 'Wallet ou compte',
  colUnits: 'Unités',
  colCost: 'Coût',
  colAcquired: 'Acquise',
  colPlacedBy: 'Placée par',
  placedBy: {
    origin: 'Achetée ici',
    fill: 'Déplacée ici',
    override: 'Votre répartition',
    placeholder: 'Aucun coût enregistré',
    unallocated: 'Coût sans unités',
  },
  gapReasons: {
    jan1_position_gap: 'Ne correspond pas à votre historique',
    allocation_override_rejected: "Votre répartition n'a pas été utilisée",
  },
  gapDetails: {
    negative_balance: "Le wallet ou le compte a envoyé plus que ce qui était enregistré",
    units_without_basis: 'Unités détenues sans coût enregistré',
    basis_without_units: "Coût enregistré sans unités pour le porter",
    units_mismatch: 'Les unités par wallet diffèrent de votre historique',
    duplicate_asset: 'Plusieurs répartitions pour cette crypto',
    invalid_rows: "Une ligne n'a pas pu être lue",
    no_rows: 'Aucune ligne',
    unknown_asset: 'Aucun coût restant pour cette crypto',
  },
  allocationHeading: 'Saisir votre propre répartition',
  allocationHelp:
    "Une ligne par entrée : clé du wallet | date d'acquisition | unités | coût (facultatif). Les unités de chaque wallet doivent correspondre au tableau ci-dessus. Toutes les lignes sont enregistrées ensemble, ou aucune.",
  allocationPlaceholder: 'clé du wallet | 2023-01-10 | 0.5 | 10000',
  save: 'Enregistrer la répartition',
  remove: 'Supprimer la répartition enregistrée',
  saving: 'Enregistrement…',
  saved: 'Enregistrée.',
  removed: 'Supprimée.',
  rejected: "Non enregistrée : la répartition ne correspond pas à votre historique.",
  networkError: 'Erreur réseau',
  noBasis: 'aucun',
};

const MAP: Record<Lang, OpeningPositionsLocale> = { en, es, fr };

export function getOpeningPositions(lang: Lang): OpeningPositionsLocale {
  return MAP[lang] ?? en;
}
