// DemoTutorial component — tour bar + step copy (EN · ES · FR).
//
// Crypto jargon stays English: wallet, DeFi, SOL, ETH, Aave, Lido, CSV,
// Coinbase, Kraken, Gemini, Exodus, Robinhood, P&L, on-chain.
// "Tin/Tins" is a product term — kept in EN.
// ES/FR string values use double quotes (apostrophes break single-quote delimiters).

import type { Lang } from '@/lib/i18n/locale';

export interface DemoTutorialStep {
  title: string;
  body: string;
  nextLabel?: string;
}

export interface DemoTutorialLabels {
  step: string;
  of: string;
  back: string;
  next: string;
  finish: string;
}

export interface DemoTutorialLocale {
  /** Tour bar teaser text. */
  barCopy: string;
  /** Tour bar CTA button. */
  barCta: string;
  /** Step array — 9 steps; positions MUST match across all languages. */
  steps: DemoTutorialStep[];
  /** Navigation labels. */
  labels: DemoTutorialLabels;
  /** Shown when exactly 2 wallets added — prompt for the last one. */
  addLastWalletMsg: string;
  /** Next button label when exactly 2 wallets added. */
  addLastWalletBtn: string;
}

// ─── English ────────────────────────────────────────────────────────────────

const en: DemoTutorialLocale = {
  barCopy: "First time here? See everything you can do.",
  barCta: "Take the tour →",
  steps: [
    {
      title: "Notepad",
      body: "Keep quick notes here — like \"sent sis 0.05 ETH\" or \"staked on Lido.\" Private to you, visible only on your vault.",
    },
    {
      title: "Portfolio & Sync",
      body: "Your total value and P&L across every wallet and exchange. Hit the Sync button to pull fresh balances from the chain.",
    },
    {
      title: "Add a Wallet",
      body: "You're already tracking wallet 1. → Add wallet 2 to see SOL and → wallet 3 to see DeFi — then follow the tour. Or paste your own public wallet address to see more.",
    },
    {
      title: "Sample Wallets",
      body: "Add → wallet 2 (SOL) and → wallet 3 (DeFi) to continue the tour. Or paste your own address — the tour ends and you'll explore your real portfolio.",
      nextLabel: "Add both wallets ↑",
    },
    {
      title: "Smart Import",
      body: "Drop in a CSV from any exchange — Coinbase, Kraken, Gemini, Exodus, and more. If the format isn't recognized, you'll get a clear error message so you can try the right file.",
    },
    {
      title: "Centralized Exchanges",
      body: "Coinbase, Kraken, Gemini, Robinhood, and more — import your full transaction history via CSV export from each platform.",
    },
    {
      title: "Wallet Tins",
      body: "It's now open — look inside: each row shows the token symbol, current price, days held, and unrealized gain or loss. That's your full on-chain picture at a glance.",
    },
    {
      title: "DeFi Loan Health",
      body: "Notice the \"Health\" score visible on the DeFi strip — before opening it. A number above 1 means your collateral is safe; below 1 and the protocol can liquidate your position.",
    },
    {
      title: "Your Aave Loan",
      body: "Inside you can see your deposited collateral, total debt, and net position across chains. Track your DeFi exposure at a glance so you're never caught off guard by a price drop.",
    },
    {
      title: "Track your transactions",
      body: "The bookkeeping page pulls in every transaction from all your wallets and exchanges in one place. Log in to get started — the same page creates your account if you don't have one yet.",
    },
  ],
  labels: { step: "Step", of: "of", back: "← Back", next: "Next →", finish: "Log in →" },
  addLastWalletMsg: "Nice. Now add the other sample wallet to continue the tour.",
  addLastWalletBtn: "Add the last wallet ↑",
};

// ─── Spanish ─────────────────────────────────────────────────────────────────

const es: DemoTutorialLocale = {
  barCopy: "¿Primera vez aquí? Descubre todo lo que puedes hacer.",
  barCta: "Tomar el tour →",
  steps: [
    {
      title: "Bloc de notas",
      body: "Anota cosas rápidas aquí: \"envié 0.05 ETH a mi hermana\" o \"staking en Lido\". Solo tú lo ves — completamente privado.",
    },
    {
      title: "Portfolio y Sync",
      body: "Tu valor total y ganancias o pérdidas en todas tus wallets e intercambios. Usa el botón Sync para actualizar tus saldos.",
    },
    {
      title: "Agregar wallet",
      body: "Ya estás rastreando la wallet 1. → Agrega la wallet 2 para ver SOL y → la 3 para ver DeFi — y sigue el tour. O pega la clave pública de tu propia wallet para ver más.",
    },
    {
      title: "Wallets de muestra",
      body: "Agrega → wallet 2 (SOL) y → wallet 3 (DeFi) para continuar el tour. O pega tu propia dirección — el tour terminará y explorarás tu portafolio real.",
      nextLabel: "Agrega las wallets ↑",
    },
    {
      title: "Importación inteligente",
      body: "Arrastra un CSV de cualquier exchange — Coinbase, Kraken, Gemini, Exodus y más. Si el formato no se reconoce, verás un mensaje de error claro para que puedas intentar con el archivo correcto.",
    },
    {
      title: "Exchanges centralizados",
      body: "Coinbase, Kraken, Gemini, Robinhood y más — importa tu historial completo de transacciones con el CSV de cada plataforma.",
    },
    {
      title: "Tins de wallet",
      body: "Ya está expandido — mira dentro: cada fila muestra el símbolo del token, precio actual, días en cartera y ganancias no realizadas. Así de claro es tu portafolio on-chain.",
    },
    {
      title: "Salud del préstamo DeFi",
      body: "Fíjate en el número de \"Salud\" visible en la franja DeFi — sin abrir el tin. Un valor por encima de 1 significa que tu colateral está seguro; por debajo de 1 el protocolo puede liquidarte.",
    },
    {
      title: "Tu préstamo en Aave",
      body: "Dentro ves el colateral depositado, la deuda total y la posición neta por cadena. Monitorea tu exposición de un vistazo para no quedar desprevenido ante una caída de precios.",
    },
    {
      title: "Lleva tus transacciones",
      body: "La página de contabilidad registra cada transacción de todas tus wallets e intercambios en un solo lugar. Inicia sesión para empezar — la misma página crea tu cuenta si aún no tienes una.",
    },
  ],
  labels: { step: "Paso", of: "de", back: "← Atrás", next: "Siguiente →", finish: "Iniciar sesión →" },
  addLastWalletMsg: "Bien. Ahora agrega la otra wallet de muestra para continuar el tour.",
  addLastWalletBtn: "Agrega la última wallet ↑",
};

// ─── French ──────────────────────────────────────────────────────────────────

const fr: DemoTutorialLocale = {
  barCopy: "Première visite ? Découvrez tout ce que vous pouvez faire.",
  barCta: "Faire le tour →",
  steps: [
    {
      title: "Bloc-notes",
      body: "Notez rapidement des mémos ici — par exemple \"envoyé 0,05 ETH à ma soeur\" ou \"staking sur Lido\". Privé, visible uniquement sur votre coffre.",
    },
    {
      title: "Portfolio & Sync",
      body: "Votre valeur totale et votre P&L sur tous vos wallets et exchanges. Cliquez sur Sync pour récupérer les soldes les plus récents depuis la blockchain.",
    },
    {
      title: "Ajouter un wallet",
      body: "Vous suivez déjà le wallet 1. → Ajoutez le wallet 2 pour voir SOL et → le wallet 3 pour voir DeFi — puis suivez le tour. Ou collez votre propre adresse publique pour en voir plus.",
    },
    {
      title: "Wallets d'exemple",
      body: "Ajoutez → le wallet 2 (SOL) et → le wallet 3 (DeFi) pour continuer le tour. Ou collez votre propre adresse — le tour se terminera et vous explorerez votre vrai portfolio.",
      nextLabel: "Ajouter les deux wallets ↑",
    },
    {
      title: "Import intelligent",
      body: "Déposez un CSV de n'importe quel exchange — Coinbase, Kraken, Gemini, Exodus et plus encore. Si le format n'est pas reconnu, un message d'erreur clair vous indiquera quel fichier essayer.",
    },
    {
      title: "Exchanges centralisés",
      body: "Coinbase, Kraken, Gemini, Robinhood et plus — importez votre historique complet de transactions via l'export CSV de chaque plateforme.",
    },
    {
      title: "Wallet Tins",
      body: "Il est maintenant ouvert — regardez à l'intérieur : chaque ligne affiche le symbole du token, le prix actuel, les jours détenus et la plus-value ou moins-value latente. C'est votre photo on-chain en un coup d'oeil.",
    },
    {
      title: "Santé du prêt DeFi",
      body: "Remarquez le score \"Santé\" visible sur la bande DeFi — avant de l'ouvrir. Un nombre au-dessus de 1 signifie que votre garantie est sûre ; en dessous de 1, le protocole peut liquider votre position.",
    },
    {
      title: "Votre prêt Aave",
      body: "A l'intérieur, vous voyez votre garantie déposée, la dette totale et la position nette par chaîne. Suivez votre exposition DeFi d'un coup d'oeil pour ne jamais être surpris par une chute de prix.",
    },
    {
      title: "Suivez vos transactions",
      body: "La page de comptabilité regroupe chaque transaction de tous vos wallets et exchanges en un seul endroit. Connectez-vous pour commencer — la même page crée votre compte si vous n'en avez pas encore.",
    },
  ],
  labels: { step: "Étape", of: "sur", back: "← Retour", next: "Suivant →", finish: "Se connecter →" },
  addLastWalletMsg: "Bien. Ajoutez maintenant l'autre wallet d'exemple pour continuer le tour.",
  addLastWalletBtn: "Ajouter le dernier wallet ↑",
};

// ─── Selector ────────────────────────────────────────────────────────────────

const MAP: Record<Lang, DemoTutorialLocale> = { en, es, fr };

/** Select the DemoTutorial locale for a language, falling back to English. */
export function getDemoTutorial(lang: Lang): DemoTutorialLocale {
  return MAP[lang] ?? en;
}
