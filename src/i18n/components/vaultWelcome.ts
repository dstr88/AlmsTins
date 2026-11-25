// VaultWelcome: the welcome card and the four-step tour an empty Vault shows (EN · ES · FR).
//
// Rendered by src/components/dashboard/VaultWelcome.astro for an account the first-run rule
// (src/lib/vaultFirstRun.ts) says has nothing in it yet. The English card text is Donnie's,
// approved Nov 25, 2026; change it only on his word.
//
// Crypto jargon stays English, as in the demo tour: wallet, CSV, exchange, Sync. ES/FR are
// first-pass and have not been read by a native speaker. ES/FR string values use double quotes
// (apostrophes break single-quote delimiters).
//
// Tour steps: four, in the order of VAULT_TOUR_SELECTORS (src/lib/vaultFirstRun.ts). Positions
// MUST match across all languages; tests/vault/welcome.test.ts checks that they do.

import type { Lang } from '@/lib/i18n/locale';

export interface VaultTourStep {
  title: string;
  body: string;
}

export interface VaultTourLabels {
  step: string;
  of: string;
  back: string;
  next: string;
  /** The last step's button: it ends the tour with the cursor in the address field. */
  finish: string;
}

export interface VaultWelcomeLocale {
  lang: Lang;
  /** aria-label of the card's region. */
  regionLabel: string;
  title: string;
  /** The card's paragraphs, in order. */
  paragraphs: string[];
  tourQuestion: string;
  yes: string;
  notNow: string;
  steps: VaultTourStep[];
  labels: VaultTourLabels;
}

// ─── English ────────────────────────────────────────────────────────────────

export const en: VaultWelcomeLocale = {
  lang: 'en',
  regionLabel: 'Welcome to Almstins',
  title: 'Thanks so much for trying Almstins.',
  paragraphs: [
    "Our goal is to give you the tools to track your crypto: what you own, what you paid for it and what you've sold. Almstins reads public data only, so there's nothing to connect.",
    "To get started, paste the public address of a wallet you hold yourself into the Add field, and Almstins will work out which chain it's on. If your crypto is on an exchange, upload the CSV file the exchange lets you download, from Coinbase, Kraken or any of the others listed below.",
  ],
  tourQuestion: 'Want a quick tour of this page first?',
  yes: 'Yes, show me',
  notNow: 'Not now',
  steps: [
    {
      title: 'Add a wallet',
      body: "Paste the public address of a wallet you hold yourself here. Almstins works out which chain it's on and reads its balances and history from public data. There's nothing to connect.",
    },
    {
      title: 'Upload an exchange CSV',
      body: "Most exchanges let you download your transaction history as a CSV file. Drop it here, or press Browse files, and Almstins works out which exchange it came from. If it can't read the file, it tells you.",
    },
    {
      title: 'Your exchanges',
      body: 'Each exchange has its own card here, and what you import from it shows on that card. Coinbase and Crypto.com are always shown; the others are under More exchanges.',
    },
    {
      title: 'Portfolio',
      body: "Once you've added a wallet or a CSV, your total value and gains show here. Press Sync Tins to refresh your balances.",
    },
  ],
  labels: { step: 'Step', of: 'of', back: '← Back', next: 'Next →', finish: 'Add my first wallet' },
};

// ─── Spanish ─────────────────────────────────────────────────────────────────

export const es: VaultWelcomeLocale = {
  lang: 'es',
  regionLabel: "Bienvenido a Almstins",
  title: "Muchas gracias por probar Almstins.",
  paragraphs: [
    "Nuestro objetivo es darte las herramientas para llevar el control de tus criptomonedas: lo que tienes, lo que pagaste por ellas y lo que has vendido. Almstins solo lee datos públicos, así que no hay nada que conectar.",
    "Para empezar, pega la dirección pública de una wallet que controlas tú mismo en el campo Agregar activo, y Almstins detectará en qué cadena está. Si tus criptomonedas están en un exchange, sube el archivo CSV que el exchange te permite descargar, de Coinbase, Kraken o cualquiera de los otros que aparecen abajo.",
  ],
  tourQuestion: "¿Quieres primero un recorrido rápido por esta página?",
  yes: "Sí, muéstrame",
  notNow: "Ahora no",
  steps: [
    {
      title: "Agregar una wallet",
      body: "Pega aquí la dirección pública de una wallet que controlas tú mismo. Almstins detecta en qué cadena está y lee sus saldos y su historial a partir de datos públicos. No hay nada que conectar.",
    },
    {
      title: "Subir un CSV de exchange",
      body: "La mayoría de los exchanges te permiten descargar tu historial de transacciones como archivo CSV. Suéltalo aquí, o pulsa Examinar archivos, y Almstins detecta de qué exchange viene. Si no puede leer el archivo, te lo dice.",
    },
    {
      title: "Tus exchanges",
      body: "Cada exchange tiene aquí su propia tarjeta, y lo que importes de él aparece en esa tarjeta. Coinbase y Crypto.com siempre aparecen; los demás están en Más exchanges.",
    },
    {
      title: "Portafolio",
      body: "Cuando hayas agregado una wallet o un CSV, tu valor total y tus ganancias aparecen aquí. Pulsa Sincronizar Tins para actualizar tus saldos.",
    },
  ],
  labels: { step: "Paso", of: "de", back: "← Atrás", next: "Siguiente →", finish: "Agregar mi primera wallet" },
};

// ─── French ──────────────────────────────────────────────────────────────────

export const fr: VaultWelcomeLocale = {
  lang: 'fr',
  regionLabel: "Bienvenue sur Almstins",
  title: "Merci beaucoup d'essayer Almstins.",
  paragraphs: [
    "Notre objectif est de vous donner les outils pour suivre vos cryptos : ce que vous possédez, ce que vous les avez payées et ce que vous avez vendu. Almstins ne lit que des données publiques, il n'y a donc rien à connecter.",
    "Pour commencer, collez l'adresse publique d'un wallet que vous détenez vous-même dans le champ Ajouter un actif, et Almstins trouvera sur quelle chaîne il se trouve. Si vos cryptos sont sur un exchange, importez le fichier CSV que l'exchange vous permet de télécharger, depuis Coinbase, Kraken ou l'un des autres listés plus bas.",
  ],
  tourQuestion: "Voulez-vous d'abord une visite rapide de cette page ?",
  yes: "Oui, montrez-moi",
  notNow: "Pas maintenant",
  steps: [
    {
      title: "Ajouter un wallet",
      body: "Collez ici l'adresse publique d'un wallet que vous détenez vous-même. Almstins trouve sur quelle chaîne il se trouve et lit ses soldes et son historique à partir de données publiques. Il n'y a rien à connecter.",
    },
    {
      title: "Importer un CSV d'exchange",
      body: "La plupart des exchanges vous permettent de télécharger votre historique de transactions en fichier CSV. Déposez-le ici, ou cliquez sur Parcourir les fichiers, et Almstins reconnaît l'exchange d'origine. S'il ne peut pas lire le fichier, il vous le dit.",
    },
    {
      title: "Vos exchanges",
      body: "Chaque exchange a ici sa propre carte, et ce que vous en importez s'affiche sur cette carte. Coinbase et Crypto.com sont toujours affichés ; les autres sont sous Plus d'exchanges.",
    },
    {
      title: "Portefeuille",
      body: "Une fois un wallet ou un CSV ajouté, votre valeur totale et vos gains s'affichent ici. Cliquez sur Sync Tins pour actualiser vos soldes.",
    },
  ],
  labels: { step: "Étape", of: "sur", back: "← Retour", next: "Suivant →", finish: "Ajouter mon premier wallet" },
};

// ─── Selector ────────────────────────────────────────────────────────────────

const MAP: Record<Lang, VaultWelcomeLocale> = { en, es, fr };

/** Select the VaultWelcome locale for a language, falling back to English. */
export function getVaultWelcome(lang: Lang): VaultWelcomeLocale {
  return MAP[lang] ?? en;
}
