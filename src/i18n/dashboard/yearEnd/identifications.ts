// Tax page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).
//
// Lot identifications page and the add-wallet prompt (EN · ES · FR). Records and estimates wording
// only: Almstins is not tax software, so nothing here says what is owed, allowed or sufficient.

import type { Lang } from '@/lib/i18n/locale';

export interface IdentificationsLocale {
  lang: Lang;
  pageTitle: string;
  heading: string;
  /** Plain text. */
  intro: string;
  /** Shown near the top: a record, not advice. */
  disclaimer: string;
  notEnabled: string;
  methods: { earliest: string; latest: string; highest_basis: string };
  methodHelp: { earliest: string; latest: string; highest_basis: string };
  defaultLabel: string;
  chooseHeading: string;
  methodLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  applyAll: string;
  applyAllHelp: string;
  /** "{n} of {total} wallets and accounts have no identification yet" */
  undecidedCount: (n: number, total: number) => string;
  allDecided: string;
  exchangeWarningHeading: string;
  exchangeWarning: string;
  walletsHeading: string;
  noWallets: string;
  ownerPrefix: string;
  notDecided: string;
  currentPrefix: string;
  chooseButton: string;
  keepDefault: string;
  record: string;
  cancel: string;
  recording: string;
  recorded: string;
  errors: Record<string, string>;
  networkError: string;
  entriesHeading: string;
  entriesHelp: string;
  noEntries: string;
  colWallet: string;
  colMethod: string;
  colEffective: string;
  colRecorded: string;
  colNote: string;
  colExchange: string;
  colTimestamp: string;
  exchangeStatus: { not_needed: string; not_confirmed: string; confirmed: string };
  markConfirmed: string;
  stampStatus: { unstamped: string; pending: string; confirmed: string };
  /** "Confirmed in Bitcoin block {height}" */
  stampConfirmed: (height: number, time: string | null) => string;
  stampMeaning: string;
  downloadProof: string;
  retryStamps: string;
  reconcileHeading: string;
  reconcileHelp: string;
  yearLabel: string;
  reconcileBefore2025: string;
  reconcileNone: string;
  /** "{covered} of {total} sales were covered by an identification recorded before them" */
  reconcileCounts: (covered: number, total: number) => string;
  colDate: string;
  colAsset: string;
  colQty: string;
  colRule: string;
  ruleIdentified: (method: string, recorded: string) => string;
  ruleDefault: string;
  // The add-wallet prompt
  promptTitle: string;
  /** "Use {method} for this wallet too" */
  promptUse: (method: string) => string;
  promptDifferent: string;
  promptSkip: string;
  promptSetOne: string;
  promptBody: string;
  promptSkipNote: string;
  openPage: string;
}

const en: IdentificationsLocale = {
  lang: 'en',
  pageTitle: 'Which units a sale uses',
  heading: 'Which units a sale uses',
  intro:
    "A record of the choice you make, wallet by wallet, about which units a sale draws on: the earliest acquired, the latest acquired, or the highest cost. Each entry is dated, can't be edited, and is timestamped on Bitcoin when you record it. A change of mind is a new entry. A sale uses the entry that was in force at its date and time, and only an entry recorded before the sale counts. With none, a sale uses the earliest-acquired units in its own wallet.",
  disclaimer:
    'This is a record and an estimate, not tax advice and not tax software. Whether a record like this is sufficient is for you and your tax professional to decide.',
  notEnabled: 'Wallet-by-wallet matching is not switched on for this account, so there is nothing to record here.',
  methods: { earliest: 'Earliest acquired', latest: 'Latest acquired', highest_basis: 'Highest cost' },
  methodHelp: {
    earliest: 'Sales use the units you acquired first (the default).',
    latest: 'Sales use the units you acquired last, by original acquisition date.',
    highest_basis: 'Sales use the units with the highest cost per unit.',
  },
  defaultLabel: 'Earliest acquired (the default)',
  chooseHeading: 'Record a choice',
  methodLabel: 'Which units a sale uses',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'For example: standing choice for all sales from now on',
  applyAll: 'Apply to all',
  applyAllHelp: 'Records one dated entry for every wallet and exchange account below, all at the same moment.',
  undecidedCount: (n, total) => `${n} of ${total} ${total === 1 ? 'wallet or account has' : 'wallets and accounts have'} no identification yet`,
  allDecided: 'Every wallet and account has an identification.',
  exchangeWarningHeading: 'For coins an exchange holds',
  exchangeWarning:
    'Recording a choice here does not tell the exchange. For coins an exchange holds, you also need to tell the exchange which units to sell; a standing order counts (Treas. Reg. 1.1012-1(j)(3)(ii)). Some exchanges support only certain methods. Until you mark an entry as confirmed, it shows as recorded here, not confirmed with the exchange. Almstins does not check with the exchange.',
  walletsHeading: 'Wallets and accounts',
  noWallets: 'No wallets or exchange accounts yet.',
  ownerPrefix: 'Owner',
  notDecided: 'No identification yet: sales use earliest acquired (the default)',
  currentPrefix: 'Latest entry',
  chooseButton: 'Choose how sales pick units',
  keepDefault: 'Keep earliest-acquired (the default)',
  record: 'Record',
  cancel: 'Cancel',
  recording: 'Recording…',
  recorded: 'Recorded.',
  errors: {
    method_invalid: 'Choose which units a sale uses.',
    effective_before_recorded: 'An entry cannot take effect before the moment it is recorded.',
    note_too_long: 'The note is too long.',
    wallet_unknown: 'That wallet or account is not in your list.',
    not_enabled: 'Wallet-by-wallet matching is not switched on for this account.',
    no_entries: 'There is nothing to record.',
  },
  networkError: 'Network error',
  entriesHeading: 'Recorded entries',
  entriesHelp: 'Oldest first. Entries are never edited or removed.',
  noEntries: 'Nothing recorded yet.',
  colWallet: 'Wallet or account',
  colMethod: 'Which units',
  colEffective: 'Takes effect',
  colRecorded: 'Recorded (server time)',
  colNote: 'Note',
  colExchange: 'Exchange',
  colTimestamp: 'Bitcoin timestamp',
  exchangeStatus: { not_needed: 'Not needed', not_confirmed: 'Recorded here, not confirmed with the exchange', confirmed: 'You marked it confirmed' },
  markConfirmed: 'I confirmed this with the exchange',
  stampStatus: { unstamped: 'Waiting for a timestamp server; will retry', pending: 'Submitted; waiting for a Bitcoin block', confirmed: 'Confirmed' },
  stampConfirmed: (height, time) => (time ? `Confirmed in Bitcoin block ${height}, ${time}` : `Confirmed in Bitcoin block ${height}`),
  stampMeaning: 'A timestamp shows this entry existed unchanged no later than the time of the Bitcoin block. It shows nothing else.',
  downloadProof: 'Download proof',
  retryStamps: 'Check timestamps now',
  reconcileHeading: 'Sales and the identification behind them',
  reconcileHelp:
    'For each sale: whether an identification recorded before it was in force, or the sale used the earliest-acquired default for its wallet. Sales before 2025 are matched in one pool per coin and are not part of this.',
  yearLabel: 'Year',
  reconcileBefore2025: 'Sales before 2025 are not matched wallet by wallet, so identifications do not apply to them.',
  reconcileNone: 'No sales this year.',
  reconcileCounts: (covered, total) => `${covered} of ${total} ${total === 1 ? 'sale was' : 'sales were'} covered by an identification recorded before ${total === 1 ? 'it' : 'them'}`,
  colDate: 'Sale date',
  colAsset: 'Coin',
  colQty: 'Units',
  colRule: 'Rule used',
  ruleIdentified: (method, recorded) => `${method}, identification recorded ${recorded}`,
  ruleDefault: 'Earliest acquired (default; no identification in force)',
  promptTitle: 'How should sales from this wallet pick units?',
  promptUse: (method) => `Use ${method} for this wallet too`,
  promptDifferent: 'Choose a different method',
  promptSkip: 'Skip for now',
  promptSetOne: 'Choose how sales pick units',
  promptBody:
    'Until you record a choice, sales from this wallet use the earliest-acquired units. A choice is a dated record made at the moment you click; it is never backdated.',
  promptSkipNote: 'Skipping leaves this wallet on earliest acquired. The button stays on its row until you decide.',
  openPage: 'Open the page',
};

const es: IdentificationsLocale = {
  lang: 'es',
  pageTitle: 'Qué unidades usa una venta',
  heading: 'Qué unidades usa una venta',
  intro:
    'Un registro de la elección que haces, wallet por wallet, sobre qué unidades usa una venta: las adquiridas primero, las adquiridas al final o las de mayor costo. Cada entrada tiene fecha, no se puede editar y se sella en Bitcoin al registrarla. Cambiar de idea es una entrada nueva. Una venta usa la entrada vigente en su fecha y hora, y solo cuenta una entrada registrada antes de la venta. Sin ninguna, la venta usa las unidades adquiridas primero en su propio wallet.',
  disclaimer:
    'Esto es un registro y una estimación, no asesoría fiscal ni software de impuestos. Si un registro así es suficiente lo deciden tú y tu profesional de impuestos.',
  notEnabled: 'La conciliación wallet por wallet no está activada para esta cuenta, así que aquí no hay nada que registrar.',
  methods: { earliest: 'Adquiridas primero', latest: 'Adquiridas al final', highest_basis: 'Mayor costo' },
  methodHelp: {
    earliest: 'Las ventas usan las unidades que adquiriste primero (lo predeterminado).',
    latest: 'Las ventas usan las unidades que adquiriste al final, según la fecha original de adquisición.',
    highest_basis: 'Las ventas usan las unidades con mayor costo por unidad.',
  },
  defaultLabel: 'Adquiridas primero (lo predeterminado)',
  chooseHeading: 'Registrar una elección',
  methodLabel: 'Qué unidades usa una venta',
  noteLabel: 'Nota (opcional)',
  notePlaceholder: 'Por ejemplo: elección permanente para todas las ventas desde ahora',
  applyAll: 'Aplicar a todas',
  applyAllHelp: 'Registra una entrada con fecha para cada wallet y cuenta de exchange de abajo, todas en el mismo momento.',
  undecidedCount: (n, total) => `${n} de ${total} ${total === 1 ? 'wallet o cuenta aún no tiene' : 'wallets y cuentas aún no tienen'} identificación`,
  allDecided: 'Cada wallet y cuenta tiene una identificación.',
  exchangeWarningHeading: 'Para monedas que tiene un exchange',
  exchangeWarning:
    'Registrar una elección aquí no se lo comunica al exchange. Para las monedas que tiene un exchange, también debes indicarle qué unidades vender; una orden permanente cuenta (Treas. Reg. 1.1012-1(j)(3)(ii)). Algunos exchanges solo admiten ciertos métodos. Hasta que marques una entrada como confirmada, aparece como registrada aquí, no confirmada con el exchange. Almstins no lo consulta con el exchange.',
  walletsHeading: 'Wallets y cuentas',
  noWallets: 'Aún no hay wallets ni cuentas de exchange.',
  ownerPrefix: 'Titular',
  notDecided: 'Aún sin identificación: las ventas usan las adquiridas primero (lo predeterminado)',
  currentPrefix: 'Última entrada',
  chooseButton: 'Elegir cómo las ventas escogen unidades',
  keepDefault: 'Mantener adquiridas primero (lo predeterminado)',
  record: 'Registrar',
  cancel: 'Cancelar',
  recording: 'Registrando…',
  recorded: 'Registrado.',
  errors: {
    method_invalid: 'Elige qué unidades usa una venta.',
    effective_before_recorded: 'Una entrada no puede entrar en vigor antes del momento en que se registra.',
    note_too_long: 'La nota es demasiado larga.',
    wallet_unknown: 'Ese wallet o cuenta no está en tu lista.',
    not_enabled: 'La conciliación wallet por wallet no está activada para esta cuenta.',
    no_entries: 'No hay nada que registrar.',
  },
  networkError: 'Error de red',
  entriesHeading: 'Entradas registradas',
  entriesHelp: 'La más antigua primero. Las entradas nunca se editan ni se eliminan.',
  noEntries: 'Aún no hay nada registrado.',
  colWallet: 'Wallet o cuenta',
  colMethod: 'Qué unidades',
  colEffective: 'Entra en vigor',
  colRecorded: 'Registrada (hora del servidor)',
  colNote: 'Nota',
  colExchange: 'Exchange',
  colTimestamp: 'Sello de Bitcoin',
  exchangeStatus: { not_needed: 'No hace falta', not_confirmed: 'Registrada aquí, no confirmada con el exchange', confirmed: 'La marcaste como confirmada' },
  markConfirmed: 'Lo confirmé con el exchange',
  stampStatus: { unstamped: 'Esperando un servidor de sellos; se reintentará', pending: 'Enviado; esperando un bloque de Bitcoin', confirmed: 'Confirmado' },
  stampConfirmed: (height, time) => (time ? `Confirmado en el bloque ${height} de Bitcoin, ${time}` : `Confirmado en el bloque ${height} de Bitcoin`),
  stampMeaning: 'Un sello muestra que esta entrada existía sin cambios a más tardar en la hora del bloque de Bitcoin. No muestra nada más.',
  downloadProof: 'Descargar prueba',
  retryStamps: 'Revisar sellos ahora',
  reconcileHeading: 'Ventas y la identificación detrás de ellas',
  reconcileHelp:
    'Para cada venta: si había una identificación registrada antes y vigente, o si la venta usó lo predeterminado (adquiridas primero) de su wallet. Las ventas anteriores a 2025 se concilian en un solo conjunto por moneda y no forman parte de esto.',
  yearLabel: 'Año',
  reconcileBefore2025: 'Las ventas anteriores a 2025 no se concilian wallet por wallet, así que las identificaciones no se aplican a ellas.',
  reconcileNone: 'No hay ventas este año.',
  reconcileCounts: (covered, total) => `${covered} de ${total} ${total === 1 ? 'venta estaba cubierta' : 'ventas estaban cubiertas'} por una identificación registrada antes`,
  colDate: 'Fecha de venta',
  colAsset: 'Moneda',
  colQty: 'Unidades',
  colRule: 'Regla usada',
  ruleIdentified: (method, recorded) => `${method}, identificación registrada ${recorded}`,
  ruleDefault: 'Adquiridas primero (predeterminado; sin identificación vigente)',
  promptTitle: '¿Cómo deben escoger unidades las ventas de este wallet?',
  promptUse: (method) => `Usar ${method} también para este wallet`,
  promptDifferent: 'Elegir otro método',
  promptSkip: 'Omitir por ahora',
  promptSetOne: 'Elegir cómo las ventas escogen unidades',
  promptBody:
    'Hasta que registres una elección, las ventas de este wallet usan las unidades adquiridas primero. Una elección es un registro con fecha hecho en el momento en que haces clic; nunca se antedata.',
  promptSkipNote: 'Omitir deja este wallet en adquiridas primero. El botón sigue en su fila hasta que decidas.',
  openPage: 'Abrir la página',
};

const fr: IdentificationsLocale = {
  lang: 'fr',
  pageTitle: 'Quelles unités une vente utilise',
  heading: 'Quelles unités une vente utilise',
  intro:
    "Un registre du choix que vous faites, wallet par wallet, sur les unités qu'une vente utilise : les plus anciennes, les plus récentes ou celles au coût le plus élevé. Chaque entrée est datée, non modifiable, et horodatée sur Bitcoin à l'enregistrement. Changer d'avis crée une nouvelle entrée. Une vente utilise l'entrée en vigueur à sa date et heure, et seule une entrée enregistrée avant la vente compte. Sans entrée, la vente utilise les unités les plus anciennes de son propre wallet.",
  disclaimer:
    "Ceci est un registre et une estimation, pas un conseil fiscal ni un logiciel de déclaration. Savoir si un tel registre est suffisant, c'est à vous et à votre professionnel fiscal d'en décider.",
  notEnabled: "Le rapprochement wallet par wallet n'est pas activé pour ce compte : il n'y a rien à enregistrer ici.",
  methods: { earliest: 'Les plus anciennes', latest: 'Les plus récentes', highest_basis: 'Coût le plus élevé' },
  methodHelp: {
    earliest: 'Les ventes utilisent les unités acquises en premier (par défaut).',
    latest: "Les ventes utilisent les unités acquises en dernier, selon la date d'acquisition d'origine.",
    highest_basis: 'Les ventes utilisent les unités au coût unitaire le plus élevé.',
  },
  defaultLabel: 'Les plus anciennes (par défaut)',
  chooseHeading: 'Enregistrer un choix',
  methodLabel: "Quelles unités une vente utilise",
  noteLabel: 'Note (facultative)',
  notePlaceholder: 'Par exemple : choix permanent pour toutes les ventes à partir de maintenant',
  applyAll: 'Appliquer à tous',
  applyAllHelp: 'Enregistre une entrée datée pour chaque wallet et compte d’exchange ci-dessous, toutes au même instant.',
  undecidedCount: (n, total) => `${n} sur ${total} ${total === 1 ? 'wallet ou compte n’a' : 'wallets et comptes n’ont'} pas encore d’identification`,
  allDecided: 'Chaque wallet et chaque compte a une identification.',
  exchangeWarningHeading: 'Pour les cryptos détenues par un exchange',
  exchangeWarning:
    "Enregistrer un choix ici ne le communique pas à l'exchange. Pour les cryptos qu'un exchange détient, vous devez aussi lui indiquer quelles unités vendre ; un ordre permanent compte (Treas. Reg. 1.1012-1(j)(3)(ii)). Certains exchanges ne prennent en charge que certaines méthodes. Tant que vous n'avez pas marqué une entrée comme confirmée, elle apparaît comme enregistrée ici, non confirmée auprès de l'exchange. Almstins ne vérifie pas auprès de l'exchange.",
  walletsHeading: 'Wallets et comptes',
  noWallets: "Aucun wallet ni compte d'exchange pour l'instant.",
  ownerPrefix: 'Titulaire',
  notDecided: "Pas encore d'identification : les ventes utilisent les plus anciennes (par défaut)",
  currentPrefix: 'Dernière entrée',
  chooseButton: 'Choisir comment les ventes prennent les unités',
  keepDefault: 'Garder les plus anciennes (par défaut)',
  record: 'Enregistrer',
  cancel: 'Annuler',
  recording: 'Enregistrement…',
  recorded: 'Enregistré.',
  errors: {
    method_invalid: "Choisissez quelles unités une vente utilise.",
    effective_before_recorded: "Une entrée ne peut pas prendre effet avant l'instant où elle est enregistrée.",
    note_too_long: 'La note est trop longue.',
    wallet_unknown: "Ce wallet ou ce compte n'est pas dans votre liste.",
    not_enabled: "Le rapprochement wallet par wallet n'est pas activé pour ce compte.",
    no_entries: "Il n'y a rien à enregistrer.",
  },
  networkError: 'Erreur réseau',
  entriesHeading: 'Entrées enregistrées',
  entriesHelp: 'La plus ancienne en premier. Les entrées ne sont jamais modifiées ni supprimées.',
  noEntries: 'Rien enregistré pour l’instant.',
  colWallet: 'Wallet ou compte',
  colMethod: 'Quelles unités',
  colEffective: 'Prend effet',
  colRecorded: 'Enregistrée (heure du serveur)',
  colNote: 'Note',
  colExchange: 'Exchange',
  colTimestamp: 'Horodatage Bitcoin',
  exchangeStatus: { not_needed: 'Inutile', not_confirmed: "Enregistrée ici, non confirmée auprès de l'exchange", confirmed: 'Vous l’avez marquée confirmée' },
  markConfirmed: "Je l'ai confirmé auprès de l'exchange",
  stampStatus: { unstamped: "En attente d'un serveur d'horodatage ; nouvel essai à venir", pending: 'Envoyé ; en attente d’un bloc Bitcoin', confirmed: 'Confirmé' },
  stampConfirmed: (height, time) => (time ? `Confirmé dans le bloc Bitcoin ${height}, ${time}` : `Confirmé dans le bloc Bitcoin ${height}`),
  stampMeaning: "Un horodatage montre que cette entrée existait, inchangée, au plus tard à l'heure du bloc Bitcoin. Il ne montre rien d'autre.",
  downloadProof: 'Télécharger la preuve',
  retryStamps: 'Vérifier les horodatages maintenant',
  reconcileHeading: 'Les ventes et l’identification derrière elles',
  reconcileHelp:
    "Pour chaque vente : si une identification enregistrée avant elle était en vigueur, ou si la vente a suivi la règle par défaut (les plus anciennes) de son wallet. Les ventes d'avant 2025 sont rapprochées dans un seul ensemble par crypto et n'en font pas partie.",
  yearLabel: 'Année',
  reconcileBefore2025: "Les ventes d'avant 2025 ne sont pas rapprochées wallet par wallet : les identifications ne s'y appliquent pas.",
  reconcileNone: 'Aucune vente cette année.',
  reconcileCounts: (covered, total) => `${covered} sur ${total} ${total === 1 ? 'vente était couverte' : 'ventes étaient couvertes'} par une identification enregistrée avant`,
  colDate: 'Date de vente',
  colAsset: 'Crypto',
  colQty: 'Unités',
  colRule: 'Règle suivie',
  ruleIdentified: (method, recorded) => `${method}, identification enregistrée ${recorded}`,
  ruleDefault: 'Les plus anciennes (par défaut ; aucune identification en vigueur)',
  promptTitle: 'Comment les ventes de ce wallet doivent-elles prendre les unités ?',
  promptUse: (method) => `Utiliser « ${method} » aussi pour ce wallet`,
  promptDifferent: 'Choisir une autre méthode',
  promptSkip: 'Passer pour l’instant',
  promptSetOne: 'Choisir comment les ventes prennent les unités',
  promptBody:
    "Tant que vous n'enregistrez pas de choix, les ventes de ce wallet utilisent les unités les plus anciennes. Un choix est un enregistrement daté, fait à l'instant du clic ; il n'est jamais antidaté.",
  promptSkipNote: 'Passer laisse ce wallet sur les plus anciennes. Le bouton reste sur sa ligne tant que vous ne décidez pas.',
  openPage: 'Ouvrir la page',
};

const MAP: Record<Lang, IdentificationsLocale> = { en, es, fr };

export function getIdentifications(lang: Lang): IdentificationsLocale {
  return MAP[lang] ?? en;
}
