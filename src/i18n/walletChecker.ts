/**
 * Wallet-checker copy dictionary.
 *
 * Single source of truth for every user-facing string on the wallet-checker
 * page across all languages. The markup, CSS and behaviour live ONCE in
 * `src/components/WalletCheckerPage.astro`; this file supplies the words.
 *
 * To add a language: add one entry to `copy` below and a thin route file
 * (`src/pages/wallet-checker/<lang>.astro`) that renders
 * `<WalletCheckerPage lang="<lang>" />`. Nothing else needs to change.
 *
 * HTML-bearing fields (modal bodies, disclaimer, etc.) contain inline markup
 * and are rendered with `set:html` in the component.
 */

export type Lang = 'en' | 'es' | 'fr';

/** Order in which language toggles render in the top nav. */
export const LANGS: { code: Lang; href: string; toggle: string; toggleAria: string }[] = [
  { code: 'en', href: '/wallet-checker',    toggle: '🇺🇸 In English',  toggleAria: 'View in English' },
  { code: 'es', href: '/wallet-checker/es', toggle: '🇪🇸 En Español',  toggleAria: 'Ver en español' },
  { code: 'fr', href: '/wallet-checker/fr', toggle: '🇫🇷 En Français', toggleAria: 'Voir en français' },
];

export interface SignalCard { icon: string; label: string; body: string }
export interface FaqItem { q: string; a: string }
export interface TipItem { icon: string; title: string; body: string }

export interface WalletCheckerCopy {
  /** Canonical absolute URL of this localized page (for JSON-LD). */
  url: string;
  meta: { title: string; description: string };
  /** JSON-LD WebApplication schema text. */
  ld: { name: string; description: string; featureList: string[] };
  nav: {
    aria: string;
    brandAria: string;
    tagline: string;
    login: string;
    signup: string;
  };
  hero: { eyebrow: string; title: string; sub: string };
  cards: {
    dapp: { title: string; cta: string; placeholder: string; btn: string };
    wallet: { title: string; cta: string; placeholder: string; btn: string };
    approval: { title: string; cta: string; desc: string };
  };
  modalClose: string;
  modals: {
    phishing: { title: string; subtitle: string; bodyHtml: string };
    scam: { title: string; subtitle: string; bodyHtml: string };
    approval: { title: string; subtitle: string; bodyHtml: string };
  };
  tablistAria: string;
  tabs: { wallet: string; dapp: string };
  dapp: { placeholder: string; btn: string };
  /** VirusTotal pending notice. `{n}` is replaced by the live countdown <strong>. */
  vtPending: { msgHtml: string; recheck: string };
  checkQueue: {
    metamask: string;
    scamsniffer: string;
    openphish: string;
    goplus: string;
    urlscan: string;
    gsb: string;
    virustotal: string;
  };
  cta: { aria: string; headline: string; sub: string; btn: string };
  signals: {
    title: string;
    walletSub: string;
    dappSub: string;
    wallet: SignalCard[];
    dapp: SignalCard[];
  };
  approvals: {
    title: string;
    intro: string;
    whatTitle: string;
    whatHtml: string;
    howTitle: string;
    howIntro: string;
    tools: { name: string; badge?: string; desc: string; href: string }[];
    tipsTitle: string;
    tips: TipItem[];
  };
  faq: { title: string; items: FaqItem[] };
  disclaimer: { text: string; link: string };
  /** Strings consumed by the client behaviour script (injected as a JSON blob). */
  js: {
    checking: string;
    reported: string;
    pending: string;
    noneFound: string;
    noData: string;
    verdict: { red: string; yellow: string; green: string };
    safety: { red: string; yellow: string; green: string };
    warmup: string;
    timeoutRetry: string;
    checkFailedPrefix: string;
    checkFailedSuffix: string;
    unknownError: string;
    checkFailedGeneric: string;
  };
}

export const copy: Record<Lang, WalletCheckerCopy> = {
  // ─────────────────────────────────────────────────────────── English ──
  en: {
    url: 'https://almstins.com/wallet-checker',
    meta: {
      title: 'Crypto Wallet Scam Checker — Is This Address Safe?',
      description:
        'Paste any Ethereum, Solana, or Sui wallet address to instantly check for known scams, phishing, honeypots, dark web activity, and mixer use. Free, no login required.',
    },
    ld: {
      name: 'Crypto Wallet Scam Checker',
      description:
        'Free tool to check any crypto wallet address for known scams, phishing, honeypots, dark web activity, and mixer use. Supports Ethereum, Solana, and Sui.',
      featureList: [
        'Known scam address detection',
        'Phishing wallet identification',
        'Honeypot token detection',
        'Dark web transaction flagging',
        'Mixer / Tornado Cash detection',
        'Multi-sig contract identification',
        'Token balance lookup',
        'Wallet age and activity history',
      ],
    },
    nav: {
      aria: 'Almstins site navigation',
      brandAria: 'Almstins home',
      tagline: 'Crypto portfolio tracker & bookkeeping tool',
      login: 'Log in',
      signup: 'Sign up free',
    },
    hero: {
      eyebrow: 'Free · No login required · Results in seconds',
      title: 'Crypto Wallet Scam Checker',
      sub: `Been offered a deal that sounds too good to be true? Before you send a single token, paste the wallet address below. We'll check it against public scam databases, honeypot detectors, and on-chain data — instantly.`,
    },
    cards: {
      dapp: { title: 'Paste your URL here', cta: 'What is this? →', placeholder: 'Paste a URL or domain…', btn: 'Check site' },
      wallet: { title: 'Paste a wallet address', cta: 'What is this? →', placeholder: 'Paste a wallet address…', btn: 'Check wallet' },
      approval: { title: 'Token approval theft', cta: 'What is this? →', desc: 'These community-driven tools show you instantly which contracts have their claws in your crypto — and let you revoke them.' },
    },
    modalClose: 'Close',
    modals: {
      phishing: {
        title: 'Connecting to a malicious site',
        subtitle: 'Wallet drainers & phishing dApps',
        bodyHtml: `<p>Scammers build near-perfect copies of legitimate dApps — fake NFT mints, fake token claims, fake airdrop pages. The site looks real. The URL is close but slightly off (<code>blur-io.xyz</code> instead of <code>blur.io</code>). When you connect your MetaMask and sign what looks like a routine transaction, you're actually handing over permission to drain every token from your wallet in one move.</p>
          <div class="threat-modal__example">💸 <strong>Real example:</strong> In 2023 a fake Blur.io airdrop page drained over <strong>$1.2 million</strong> from NFT holders within hours of launch. Most victims said they "double-checked the URL" but missed a single character.</div>
          <p>These sites appear as links in Discord DMs, Twitter/X replies, Telegram groups, and even paid ads. The attacker pays for a Google ad to appear above the real site.</p>
          <div class="threat-modal__tip">✅ <strong>How our dApp checker protects you:</strong> Paste the URL before connecting. We query 7 security databases — including MetaMask's own phishing blocklist and ScamSniffer's 345,000-domain database — and return a verdict in seconds. <strong>Golden rule: never click a wallet link sent in a DM.</strong></div>`,
      },
      scam: {
        title: 'Investing in a known scam',
        subtitle: 'Pig butchering, honeypots & rug pulls',
        bodyHtml: `<p><strong>Pig-butchering</strong> scams build trust over weeks or months — a new contact on a dating app or social media gradually introduces you to a "great investment opportunity." The wallet address they send has often already been reported. <strong>Honeypot tokens</strong> let you buy but block you from selling — the contract is coded to trap your funds while the developer drains the liquidity pool.</p>
          <div class="threat-modal__example">💸 <strong>Real example:</strong> The FBI's Internet Crime Complaint Center (IC3) reported <strong>$3.3 billion</strong> in crypto investment fraud in 2023 alone — the fastest-growing fraud category. Most victims had never heard of "pig butchering" before it happened to them.</div>
          <p>A rug pull looks like a legitimate token launch. Developers hype the project, liquidity pours in, then the team withdraws everything overnight and the token goes to zero.</p>
          <div class="threat-modal__tip">✅ <strong>How our wallet checker protects you:</strong> Before sending funds to any wallet, paste the address here. We check it against GoPlus Security's global scam blacklist, look for honeypot patterns in associated tokens, and flag mixer use that indicates money laundering. If someone is pressuring you to send crypto quickly — that's the scam.</div>`,
      },
      approval: {
        title: 'Token approval theft',
        subtitle: 'Unlimited approvals & silent drains',
        bodyHtml: `<p>Every time you click "Approve" on a token swap or NFT mint, you sign a smart-contract message that says <em>"this contract can spend my tokens."</em> Most dApps default to <strong>unlimited approval</strong> — they can take your entire balance of that token, any time, forever, until you explicitly revoke it. These permissions survive long after you've forgotten the site existed.</p>
          <div class="threat-modal__example">💸 <strong>Real example:</strong> When the Multichain bridge was exploited in 2023, attackers used <strong>old approvals</strong> users had granted months earlier to drain <strong>$125 million</strong>. Many victims hadn't used the bridge in over a year.</div>
          <p>A compromised dApp, a rug pull, or a zero-day exploit can trigger those approvals the moment it launches — no additional signature from you required.</p>
          <div class="threat-modal__tip">✅ <strong>How to protect yourself:</strong> Visit <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> to see every active approval on your wallet and revoke anything you don't recognise. Always set exact amounts instead of unlimited when a wallet gives you the choice — and revoke after every interaction you're done with.</div>`,
      },
    },
    tablistAria: 'Checker type',
    tabs: { wallet: '🔍 Wallet Address', dapp: '🌐 dApp / Website' },
    dapp: { placeholder: 'https://suspicious-dapp.xyz  or just paste the domain', btn: 'Check site' },
    vtPending: { msgHtml: `VirusTotal scan in progress — re-checking automatically in <strong id="vt-countdown">90</strong>s`, recheck: 'Re-check now' },
    checkQueue: {
      metamask: 'Phishing databases',
      scamsniffer: 'Scam domain lists',
      openphish: 'Active phishing feed',
      goplus: 'Live threat intelligence',
      urlscan: 'URL security history',
      gsb: 'Google Safe Browsing',
      virustotal: 'Malware scan',
    },
    cta: {
      aria: 'About Almstins',
      headline: 'Want to track everything you own?',
      sub: 'Almstins connects your wallets, DeFi positions, and exchange accounts in one place — and automatically tracks your capital gains, holdings, and realized gains.',
      btn: 'Get started free →',
    },
    signals: {
      title: 'What we check',
      walletSub: '🔍 Wallet Address checker',
      dappSub: '🌐 dApp / Website checker',
      wallet: [
        { icon: '🚨', label: 'Known scam databases', body: `Cross-referenced against GoPlus Security's global blacklist of reported scam, phishing, and drainer wallets.` },
        { icon: '🍯', label: 'Honeypot detection', body: `Checks whether tokens associated with this address can actually be sold — or if they're designed to trap your funds.` },
        { icon: '🌑', label: 'Dark web activity', body: 'Flags addresses with known connections to dark web marketplaces and illicit transaction patterns.' },
        { icon: '🔀', label: 'Mixer / Tornado Cash', body: 'Detects use of crypto mixers like Tornado Cash — a common way scammers launder funds before a rug pull.' },
        { icon: '📅', label: 'Wallet age', body: 'New wallets (< 30 days old) are a major red flag. Scammers create fresh addresses for each operation.' },
        { icon: '💰', label: 'Token holdings', body: `Shows what's actually in the wallet. Scam wallets often hold worthless tokens designed to look valuable.` },
        { icon: '⚖️', label: 'Sanctions check', body: 'Checks against OFAC and international sanctions lists for addresses involved in financial crime.' },
        { icon: '🔑', label: 'Multi-sig detection', body: 'Identifies if the address is a multi-sig contract. Legitimate investments never ask you to deposit into theirs.' },
      ],
      dapp: [
        { icon: '🦊', label: 'MetaMask blocklist', body: `Checks against MetaMask's own eth-phishing-detect list — over 198,000 crypto phishing domains maintained by the MetaMask security team.` },
        { icon: '🕵️', label: 'ScamSniffer database', body: 'The largest web3 phishing domain list available, with over 345,000 reported sites. Updated daily by the ScamSniffer security team.' },
        { icon: '🛡️', label: 'GoPlus Security', body: `Real-time lookup against GoPlus's live web3 phishing API — the same engine used by MetaMask, Trust Wallet, and other major wallets.` },
        { icon: '🔬', label: 'URLScan.io', body: 'Searches prior security researcher scans of the domain to surface any malicious verdicts from the global security community.' },
        { icon: '🎣', label: 'OpenPhish feed', body: `Cross-references against OpenPhish's actively-maintained list of live phishing URLs updated in real time.` },
        { icon: '🔍', label: 'Google Safe Browsing', body: `When configured, queries Google's threat database — one of the largest phishing and malware URL repositories in the world.` },
        { icon: '🦠', label: 'VirusTotal', body: 'When configured, checks the URL against 70+ antivirus and security engines simultaneously for a comprehensive verdict.' },
        { icon: '⚠️', label: 'Attribution, not verdict', body: 'We report what third-party databases say. We do not independently declare any site a scam. Always verify before connecting your wallet.' },
      ],
    },
    approvals: {
      title: `Is your wallet connected to something it shouldn't be?`,
      intro: `Every time you connect MetaMask (or any wallet) to a dApp and approve a transaction, you're granting that contract permission to move tokens on your behalf — sometimes with no spending limit and no expiry date. These approvals stay active even after you stop using the site. A compromised or malicious dApp can drain your wallet months later using a permission you forgot you gave.`,
      whatTitle: '⚠️ What an approval actually means',
      whatHtml: `<p>When you click "Approve" on a token swap or NFT mint, you're signing a smart contract call that says <em>"this contract can spend X amount of my tokens."</em> Many dApps default to <strong>unlimited approval</strong> — meaning they can take everything you have of that token, any time, forever, until you revoke it.</p>
        <p>If that dApp is later exploited, rug-pulled, or turns out to have been malicious from the start, the attacker can use your existing approval to empty your wallet — no second signature required.</p>`,
      howTitle: '🔍 How to see and revoke your approvals',
      howIntro: 'These free tools connect to your wallet (read-only) and show every active approval across all chains — then let you revoke the ones you don\'t recognize or no longer need.',
      tools: [
        { name: 'revoke.cash', badge: 'Most trusted', href: 'https://revoke.cash', desc: 'The gold standard. Multi-chain, shows unlimited vs. limited approvals, one-click revoke. No account needed.' },
        { name: 'etherscan.io/tokenapprovalchecker', href: 'https://etherscan.io/tokenapprovalchecker', desc: `Etherscan's official approval checker. Paste your address to see every open permission on Ethereum — no wallet connection required.` },
      ],
      tipsTitle: 'Best practices',
      tips: [
        { icon: '✂️', title: 'Revoke after every interaction', body: `Once you're done with a dApp, revoke its approval. There's no downside — you can re-approve the next time you use it.` },
        { icon: '🔢', title: 'Set exact amounts, not unlimited', body: 'When approving a swap, some wallets let you set a custom amount. Always approve only what you need for that transaction.' },
        { icon: '🗓️', title: 'Audit your approvals regularly', body: 'Run a revoke.cash check every few months — especially after any news of a DeFi exploit, since attackers often target old approvals.' },
        { icon: '🦊', title: 'Read what MetaMask is actually asking', body: 'Before clicking Confirm, expand the transaction details. If it says "Unlimited" next to a token amount — that\'s a red flag worth pausing on.' },
      ],
    },
    faq: {
      title: 'Common questions & scam patterns',
      items: [
        { q: 'What is the dApp / Website checker?', a: `It's a free tool that takes any URL or domain and queries up to 7 independent security databases simultaneously — including MetaMask's own phishing blocklist, ScamSniffer, GoPlus, URLScan.io, and OpenPhish. It returns a red, yellow, or green result based on what those databases report. We do not make our own determination — we surface what the security community has already flagged.` },
        { q: 'What does a red result mean for a website?', a: 'It means one or more of the security databases we query has reported that domain. It does not mean we are calling it a scam — that determination comes from the third-party database. You should treat a red result as a serious warning, do your own additional research, and not connect your wallet until you are certain the site is legitimate.' },
        { q: 'What does a yellow result mean?', a: `Yellow means the site is not in any blocklist, but it also has little or no security scan history — so there's not enough data to give a clean bill of health. New sites, obscure domains, or recently registered addresses often show yellow. Proceed with caution and verify the site through official channels before connecting.` },
        { q: 'Can I trust a site just because it shows green?', a: `No. A green result means the site hasn't been reported to any of the databases we check — not that it's definitively safe. Brand-new phishing sites get a few hours before they're added to blocklists. Always double-check the exact URL in your browser bar, look for the official social media accounts, and never connect a wallet from a link sent in a DM or email.` },
        { q: 'How do wallet drainer sites work?', a: `A wallet drainer is a website that mimics a legitimate dApp — a fake NFT mint, a fake token claim, or a fake airdrop. When you connect your MetaMask and sign a transaction, you're actually signing a permission that lets the attacker transfer every token out of your wallet in one move. The entire balance can be gone in seconds. The site often disappears within hours.` },
        { q: 'What is a honeypot scam?', a: 'A honeypot is a token you can buy but never sell. The scammer promotes it, you buy in, the price appears to rise — but when you try to sell, the contract blocks you. The scammer then drains the liquidity and disappears with your ETH.' },
        { q: 'What does "too good to be true" actually look like in crypto?', a: `Guaranteed daily returns of 1–10%, "just stake your tokens in our wallet," airdrop claims that require sending tokens first, or someone in DMs offering to double your crypto. If the return sounds impossible in traditional finance, it's a scam in crypto.` },
        { q: 'Why would a wallet use Tornado Cash?', a: `Tornado Cash is a mixer that breaks the on-chain link between wallet addresses. While some users value privacy, it's heavily used by scammers and hackers to hide the origin of stolen funds before cashing out.` },
        { q: 'Should I trust a wallet just because it has a large balance?', a: `No. Scammers often seed wallets with worthless tokens or inflated "paper" balances to create the appearance of legitimacy. Always check if those tokens can actually be sold and what they're truly worth.` },
        { q: 'Is a new wallet always suspicious?', a: 'Not always — but in the context of someone pitching an investment, a wallet created in the last 30 days is a major red flag. Legitimate protocols and businesses have established on-chain history.' },
        { q: 'What should I do if this tool flags a wallet address?', a: 'Do not send funds. Screenshot the results. If someone is pressuring you to send crypto to a flagged address, that pressure itself is part of the scam. Report the address on chainabuse.com and walk away.' },
        { q: 'What should I do if the dApp checker flags a website?', a: `Do not connect your wallet. Close the tab. Find the official project through a trusted source — their verified Twitter/X account or a well-known aggregator like DeFiLlama or CoinGecko. Report the site to MetaMask's phishing database at github.com/MetaMask/eth-phishing-detect.` },
      ],
    },
    disclaimer: {
      text: 'Wallet check results are sourced from public databases including GoPlus Security, Etherscan, Alchemy, and honeypot.is. dApp / website results are sourced from MetaMask eth-phishing-detect, ScamSniffer, GoPlus Security, URLScan.io, and OpenPhish. All findings are reported from third-party databases and are not independently verified by Almstins. This tool does not constitute financial or legal advice. Always do your own research.',
      link: 'A free tool by Almstins — crypto portfolio tracker & bookkeeping tool.',
    },
    js: {
      checking: 'Checking…',
      reported: 'Reported',
      pending: 'Pending…',
      noneFound: 'None found ✓',
      noData: 'No data',
      verdict: {
        red: 'DANGER — Do not connect your wallet',
        yellow: 'CAUTION — Cannot confirm this site is safe',
        green: 'NONE FOUND — Not in any security database',
      },
      safety: {
        red: '🛑 One or more security databases have reported this site. We are not making that determination ourselves — always verify independently. Do NOT connect your wallet or sign any transactions until you are certain.',
        yellow: '⚠️ This site has limited scan history. Only connect your wallet to sites you found yourself — never through a link in a DM or email.',
        green: '✅ No threats detected across all sources. Always double-check the URL in your browser bar before signing any transaction — even safe-looking sites can be typosquatted.',
      },
      warmup: 'The server is waking up after a period of inactivity. Hang tight — results are on their way…',
      timeoutRetry: 'The server is warming up after a period of inactivity — retrying in a moment…',
      checkFailedPrefix: 'Check failed: ',
      checkFailedSuffix: '. Try again.',
      unknownError: 'Unknown error',
      checkFailedGeneric: 'Check failed. Please try again.',
    },
  },

  // ─────────────────────────────────────────────────────────── Español ──
  es: {
    url: 'https://almstins.com/wallet-checker/es',
    meta: {
      title: 'Verificador de Estafas de Cripto — ¿Es Segura Esta Dirección?',
      description:
        'Pega cualquier dirección de billetera de Ethereum, Solana o Sui para verificar al instante si hay estafas conocidas, phishing, honeypots, actividad en la dark web y uso de mixers. Gratis, sin cuenta requerida.',
    },
    ld: {
      name: 'Verificador de Estafas de Cripto',
      description:
        'Herramienta gratuita para verificar cualquier dirección de billetera cripto en busca de estafas conocidas, phishing, honeypots, actividad en la dark web y uso de mixers. Compatible con Ethereum, Solana y Sui.',
      featureList: [
        'Detección de direcciones de estafa conocidas',
        'Identificación de billeteras de phishing',
        'Detección de tokens honeypot',
        'Marcado de transacciones en la dark web',
        'Detección de Mixer / Tornado Cash',
        'Identificación de contratos multi-sig',
        'Consulta de saldo de tokens',
        'Historial de actividad y antigüedad de la billetera',
      ],
    },
    nav: {
      aria: 'Navegación del sitio Almstins',
      brandAria: 'Inicio de Almstins',
      tagline: 'Rastreador de portafolio cripto y herramienta de contabilidad',
      login: 'Iniciar sesión',
      signup: 'Registrarse gratis',
    },
    hero: {
      eyebrow: 'Gratis · Sin cuenta · Resultados en segundos',
      title: 'Verificador de Estafas de Cripto',
      sub: '¿Te ofrecieron un trato que parece demasiado bueno para ser verdad? Antes de enviar un solo token, pega la dirección de la billetera aquí abajo. La verificaremos contra bases de datos públicas de estafas, detectores de honeypots y datos on-chain — al instante.',
    },
    cards: {
      dapp: { title: 'Conexión a sitio malicioso', cta: '¿Qué es esto? →', placeholder: 'Pega una URL o dominio…', btn: 'Verificar sitio' },
      wallet: { title: 'Invertir en una estafa conocida', cta: '¿Qué es esto? →', placeholder: 'Pega una dirección de billetera…', btn: 'Verificar billetera' },
      approval: { title: 'Robo por aprobación de tokens', cta: '¿Qué es esto? →', desc: 'Estas herramientas de la comunidad te muestran al instante qué contratos tienen acceso a tu cripto — y te permiten revocarlos.' },
    },
    modalClose: 'Cerrar',
    modals: {
      phishing: {
        title: 'Conectarse a un sitio malicioso',
        subtitle: 'Wallet drainers y dApps de phishing',
        bodyHtml: `<p>Los estafadores crean copias casi perfectas de dApps legítimas — mints falsos de NFTs, reclamaciones falsas de tokens, páginas falsas de airdrop. El sitio parece real. La URL es parecida pero ligeramente diferente (<code>blur-io.xyz</code> en lugar de <code>blur.io</code>). Cuando conectas tu MetaMask y firmas lo que parece una transacción rutinaria, en realidad estás otorgando permiso para vaciar todos los tokens de tu billetera en un solo movimiento.</p>
          <div class="threat-modal__example">💸 <strong>Ejemplo real:</strong> En 2023, una página falsa de airdrop de Blur.io drenó más de <strong>$1.2 millones</strong> de titulares de NFTs en pocas horas tras su lanzamiento. La mayoría de las víctimas dijeron que "verificaron la URL dos veces" pero no vieron un solo carácter diferente.</div>
          <p>Estos sitios aparecen como enlaces en mensajes directos de Discord, respuestas en Twitter/X, grupos de Telegram e incluso anuncios pagados. El atacante paga por un anuncio de Google para aparecer encima del sitio real.</p>
          <div class="threat-modal__tip">✅ <strong>Cómo te protege nuestro verificador de dApps:</strong> Pega la URL antes de conectarte. Consultamos 7 bases de datos de seguridad — incluyendo la propia lista de bloqueo de phishing de MetaMask y la base de datos de 345,000 dominios de ScamSniffer — y devolvemos un veredicto en segundos. <strong>Regla de oro: nunca hagas clic en un enlace de billetera enviado por mensaje directo.</strong></div>`,
      },
      scam: {
        title: 'Invertir en una estafa conocida',
        subtitle: 'Pig butchering, honeypots y rug pulls',
        bodyHtml: `<p>Las estafas de <strong>pig butchering</strong> construyen confianza durante semanas o meses — un nuevo contacto en una app de citas o redes sociales te va presentando gradualmente una "gran oportunidad de inversión". La dirección de billetera que te envían a menudo ya ha sido reportada. Los <strong>tokens honeypot</strong> te permiten comprar pero te bloquean para vender — el contrato está programado para atrapar tus fondos mientras el desarrollador vacía el pool de liquidez.</p>
          <div class="threat-modal__example">💸 <strong>Ejemplo real:</strong> El Centro de Quejas de Crímenes en Internet (IC3) del FBI reportó <strong>$3.3 mil millones</strong> en fraudes de inversión cripto solo en 2023 — la categoría de fraude de más rápido crecimiento. La mayoría de las víctimas nunca habían escuchado sobre el "pig butchering" antes de sufrirlo.</div>
          <p>Un rug pull parece un lanzamiento de token legítimo. Los desarrolladores generan hype del proyecto, entra liquidez, luego el equipo retira todo de la noche a la mañana y el token cae a cero.</p>
          <div class="threat-modal__tip">✅ <strong>Cómo te protege nuestro verificador de billeteras:</strong> Antes de enviar fondos a cualquier billetera, pega la dirección aquí. La verificamos contra la lista negra global de estafas de GoPlus Security, buscamos patrones honeypot en los tokens asociados y señalamos el uso de mixers que indica lavado de dinero. Si alguien te presiona para enviar cripto rápidamente — eso es la estafa.</div>`,
      },
      approval: {
        title: 'Robo por aprobación de tokens',
        subtitle: 'Aprobaciones ilimitadas y vaciados silenciosos',
        bodyHtml: `<p>Cada vez que haces clic en "Aprobar" en un swap de tokens o un mint de NFT, firmas un mensaje de contrato inteligente que dice <em>"este contrato puede gastar mis tokens"</em>. La mayoría de las dApps usan <strong>aprobación ilimitada</strong> por defecto — pueden tomar todo tu saldo de ese token, en cualquier momento, para siempre, hasta que lo revoques explícitamente. Estos permisos persisten mucho después de que hayas olvidado que el sitio existió.</p>
          <div class="threat-modal__example">💸 <strong>Ejemplo real:</strong> Cuando el puente Multichain fue explotado en 2023, los atacantes usaron <strong>aprobaciones antiguas</strong> que los usuarios habían otorgado meses antes para drenar <strong>$125 millones</strong>. Muchas víctimas no habían usado el puente en más de un año.</div>
          <p>Una dApp comprometida, un rug pull, o un exploit de día cero puede activar esas aprobaciones en el momento en que se lanza — sin necesidad de una segunda firma de tu parte.</p>
          <div class="threat-modal__tip">✅ <strong>Cómo protegerte:</strong> Visita <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> para ver cada aprobación activa en tu billetera y revocar todo lo que no reconozcas. Siempre establece montos exactos en lugar de ilimitados cuando tu billetera te dé esa opción — y revoca después de cada interacción que hayas terminado.</div>`,
      },
    },
    tablistAria: 'Tipo de verificación',
    tabs: { wallet: '🔍 Dirección de Billetera', dapp: '🌐 dApp / Sitio Web' },
    dapp: { placeholder: 'https://dapp-sospechosa.xyz  o simplemente pega el dominio', btn: 'Verificar sitio' },
    vtPending: { msgHtml: `Análisis de VirusTotal en curso — re-verificando automáticamente en <strong id="vt-countdown">90</strong>s`, recheck: 'Verificar de nuevo' },
    checkQueue: {
      metamask: 'Bases de datos de phishing',
      scamsniffer: 'Listas de dominios fraudulentos',
      openphish: 'Feed activo de phishing',
      goplus: 'Inteligencia de amenazas en vivo',
      urlscan: 'Historial de seguridad URL',
      gsb: 'Google Safe Browsing',
      virustotal: 'Análisis de malware',
    },
    cta: {
      aria: 'Acerca de Almstins',
      headline: '¿Quieres rastrear todo lo que tienes?',
      sub: 'Almstins conecta tus billeteras, posiciones DeFi y cuentas de exchanges en un solo lugar — y rastrea automáticamente tus ganancias de capital, tenencias y ganancias realizadas.',
      btn: 'Comenzar gratis →',
    },
    signals: {
      title: 'Qué verificamos',
      walletSub: '🔍 Verificador de dirección de billetera',
      dappSub: '🌐 Verificador de dApp / sitio web',
      wallet: [
        { icon: '🚨', label: 'Bases de datos de estafas conocidas', body: 'Cruzado contra la lista negra global de GoPlus Security de billeteras de estafa, phishing y vaciado reportadas.' },
        { icon: '🍯', label: 'Detección de honeypot', body: 'Verifica si los tokens asociados con esta dirección realmente pueden venderse — o si están diseñados para atrapar tus fondos.' },
        { icon: '🌑', label: 'Actividad en la dark web', body: 'Señala direcciones con conexiones conocidas a mercados de la dark web y patrones de transacciones ilícitas.' },
        { icon: '🔀', label: 'Mixer / Tornado Cash', body: 'Detecta el uso de mixers cripto como Tornado Cash — una forma común que usan los estafadores para lavar fondos antes de un rug pull.' },
        { icon: '📅', label: 'Antigüedad de la billetera', body: 'Las billeteras nuevas (< 30 días) son una gran señal de alerta. Los estafadores crean direcciones nuevas para cada operación.' },
        { icon: '💰', label: 'Tenencias de tokens', body: 'Muestra lo que realmente hay en la billetera. Las billeteras de estafa suelen contener tokens sin valor diseñados para parecer valiosos.' },
        { icon: '⚖️', label: 'Verificación de sanciones', body: 'Verifica contra las listas de sanciones de la OFAC e internacionales para direcciones involucradas en crímenes financieros.' },
        { icon: '🔑', label: 'Detección multi-sig', body: 'Identifica si la dirección es un contrato multi-sig. Las inversiones legítimas nunca te piden depositar en los suyos.' },
      ],
      dapp: [
        { icon: '🦊', label: 'Lista de bloqueo de MetaMask', body: 'Verifica contra la propia lista eth-phishing-detect de MetaMask — más de 198,000 dominios de phishing cripto mantenidos por el equipo de seguridad de MetaMask.' },
        { icon: '🕵️', label: 'Base de datos de ScamSniffer', body: 'La lista de dominios de phishing web3 más grande disponible, con más de 345,000 sitios reportados. Actualizada diariamente por el equipo de seguridad de ScamSniffer.' },
        { icon: '🛡️', label: 'GoPlus Security', body: 'Consulta en tiempo real contra la API de phishing web3 en vivo de GoPlus — el mismo motor usado por MetaMask, Trust Wallet y otras billeteras importantes.' },
        { icon: '🔬', label: 'URLScan.io', body: 'Busca escaneos previos de investigadores de seguridad del dominio para mostrar cualquier veredicto malicioso de la comunidad global de seguridad.' },
        { icon: '🎣', label: 'Feed de OpenPhish', body: 'Cruza contra la lista activamente mantenida de OpenPhish de URLs de phishing en vivo actualizada en tiempo real.' },
        { icon: '🔍', label: 'Google Safe Browsing', body: 'Cuando está configurado, consulta la base de datos de amenazas de Google — uno de los repositorios de URLs de phishing y malware más grandes del mundo.' },
        { icon: '🦠', label: 'VirusTotal', body: 'Cuando está configurado, verifica la URL contra más de 70 motores antivirus y de seguridad simultáneamente para un veredicto completo.' },
        { icon: '⚠️', label: 'Atribución, no veredicto', body: 'Reportamos lo que dicen las bases de datos de terceros. No declaramos de forma independiente que un sitio sea una estafa. Verifica siempre antes de conectar tu billetera.' },
      ],
    },
    approvals: {
      title: '¿Está tu billetera conectada a algo que no debería?',
      intro: 'Cada vez que conectas MetaMask (o cualquier billetera) a una dApp y apruebas una transacción, le estás otorgando a ese contrato permiso para mover tokens en tu nombre — a veces sin límite de gasto y sin fecha de vencimiento. Estas aprobaciones permanecen activas incluso después de que dejas de usar el sitio. Una dApp comprometida o maliciosa puede vaciar tu billetera meses después usando un permiso que olvidaste que otorgaste.',
      whatTitle: '⚠️ Lo que una aprobación realmente significa',
      whatHtml: `<p>Cuando haces clic en "Aprobar" en un swap de tokens o un mint de NFT, estás firmando una llamada a contrato inteligente que dice <em>"este contrato puede gastar X cantidad de mis tokens"</em>. Muchas dApps usan <strong>aprobación ilimitada</strong> por defecto — lo que significa que pueden tomar todo lo que tienes de ese token, en cualquier momento, para siempre, hasta que lo revoques.</p>
        <p>Si esa dApp es explotada después, hace un rug pull, o resulta haber sido maliciosa desde el principio, el atacante puede usar tu aprobación existente para vaciar tu billetera — sin necesidad de una segunda firma.</p>`,
      howTitle: '🔍 Cómo ver y revocar tus aprobaciones',
      howIntro: 'Estas herramientas gratuitas se conectan a tu billetera (solo lectura) y muestran cada aprobación activa en todas las cadenas — luego te permiten revocar las que no reconoces o ya no necesitas.',
      tools: [
        { name: 'revoke.cash', badge: 'Más confiable', href: 'https://revoke.cash', desc: 'El estándar de oro. Multi-cadena, muestra aprobaciones ilimitadas vs. limitadas, revocación con un clic. Sin cuenta necesaria.' },
        { name: 'etherscan.io/tokenapprovalchecker', href: 'https://etherscan.io/tokenapprovalchecker', desc: 'El verificador oficial de aprobaciones de Etherscan. Pega tu dirección para ver cada permiso abierto en Ethereum — sin necesidad de conectar tu billetera.' },
      ],
      tipsTitle: 'Mejores prácticas',
      tips: [
        { icon: '✂️', title: 'Revoca después de cada interacción', body: 'Una vez que termines con una dApp, revoca su aprobación. No hay desventaja — puedes volver a aprobarla la próxima vez que la uses.' },
        { icon: '🔢', title: 'Establece montos exactos, no ilimitados', body: 'Al aprobar un swap, algunas billeteras te permiten establecer un monto personalizado. Aprueba siempre solo lo que necesites para esa transacción.' },
        { icon: '🗓️', title: 'Audita tus aprobaciones regularmente', body: 'Haz una verificación en revoke.cash cada pocos meses — especialmente después de noticias de un exploit DeFi, ya que los atacantes a menudo apuntan a aprobaciones antiguas.' },
        { icon: '🦊', title: 'Lee lo que MetaMask realmente te pide', body: 'Antes de hacer clic en Confirmar, expande los detalles de la transacción. Si dice "Ilimitado" junto a una cantidad de token — esa es una señal de alerta que vale la pena pausar.' },
      ],
    },
    faq: {
      title: 'Preguntas frecuentes y patrones de estafa',
      items: [
        { q: '¿Qué es el verificador de dApp / sitio web?', a: 'Es una herramienta gratuita que toma cualquier URL o dominio y consulta hasta 7 bases de datos de seguridad independientes simultáneamente — incluyendo la propia lista de bloqueo de phishing de MetaMask, ScamSniffer, GoPlus, URLScan.io y OpenPhish. Devuelve un resultado rojo, amarillo o verde según lo que reportan esas bases de datos. No hacemos nuestra propia determinación — mostramos lo que la comunidad de seguridad ya ha señalado.' },
        { q: '¿Qué significa un resultado rojo para un sitio web?', a: 'Significa que una o más de las bases de datos de seguridad que consultamos ha reportado ese dominio. No significa que nosotros lo estemos llamando una estafa — esa determinación proviene de la base de datos de terceros. Debes tratar un resultado rojo como una advertencia seria, hacer tu propia investigación adicional y no conectar tu billetera hasta estar seguro de que el sitio es legítimo.' },
        { q: '¿Qué significa un resultado amarillo?', a: 'Amarillo significa que el sitio no está en ninguna lista de bloqueo, pero tampoco tiene poco o ningún historial de escaneos de seguridad — por lo que no hay suficientes datos para dar un certificado de salud limpio. Los sitios nuevos, dominios oscuros o direcciones registradas recientemente a menudo muestran amarillo. Procede con precaución y verifica el sitio a través de canales oficiales antes de conectarte.' },
        { q: '¿Puedo confiar en un sitio solo porque muestra verde?', a: 'No. Un resultado verde significa que el sitio no ha sido reportado a ninguna de las bases de datos que verificamos — no que sea definitivamente seguro. Los sitios de phishing nuevos tienen unas pocas horas antes de ser añadidos a las listas de bloqueo. Siempre verifica la URL exacta en la barra de tu navegador, busca las cuentas oficiales de redes sociales y nunca conectes una billetera desde un enlace enviado en un mensaje directo o correo electrónico.' },
        { q: '¿Cómo funcionan los sitios de wallet drainer?', a: 'Un wallet drainer es un sitio web que imita una dApp legítima — un mint falso de NFT, una reclamación falsa de token o un airdrop falso. Cuando conectas tu MetaMask y firmas una transacción, en realidad estás firmando un permiso que le permite al atacante transferir todos los tokens de tu billetera en un solo movimiento. Todo el saldo puede desaparecer en segundos. El sitio a menudo desaparece en pocas horas.' },
        { q: '¿Qué es una estafa honeypot?', a: 'Un honeypot es un token que puedes comprar pero nunca vender. El estafador lo promociona, compras, el precio parece subir — pero cuando intentas vender, el contrato te bloquea. El estafador luego drena la liquidez y desaparece con tu ETH.' },
        { q: '¿Cómo se ve "demasiado bueno para ser verdad" en cripto?', a: 'Rendimientos diarios garantizados del 1–10%, "solo pon tus tokens en nuestra billetera", reclamaciones de airdrop que requieren enviar tokens primero, o alguien en mensajes directos ofreciendo duplicar tu cripto. Si el retorno suena imposible en las finanzas tradicionales, es una estafa en cripto.' },
        { q: '¿Por qué usaría una billetera Tornado Cash?', a: 'Tornado Cash es un mixer que rompe el enlace on-chain entre direcciones de billetera. Aunque algunos usuarios valoran la privacidad, es ampliamente utilizado por estafadores y hackers para ocultar el origen de fondos robados antes de cobrarlos.' },
        { q: '¿Debo confiar en una billetera solo porque tiene un saldo grande?', a: 'No. Los estafadores a menudo cargan billeteras con tokens sin valor o saldos "de papel" inflados para crear apariencia de legitimidad. Verifica siempre si esos tokens pueden realmente venderse y cuánto valen realmente.' },
        { q: '¿Es una billetera nueva siempre sospechosa?', a: 'No siempre — pero en el contexto de alguien que ofrece una inversión, una billetera creada en los últimos 30 días es una gran señal de alerta. Los protocolos y negocios legítimos tienen historial on-chain establecido.' },
        { q: '¿Qué debo hacer si esta herramienta señala una dirección de billetera?', a: 'No envíes fondos. Toma una captura de pantalla de los resultados. Si alguien te presiona para enviar cripto a una dirección señalada, esa presión misma es parte de la estafa. Reporta la dirección en chainabuse.com y retírate.' },
        { q: '¿Qué debo hacer si el verificador de dApp señala un sitio web?', a: 'No conectes tu billetera. Cierra la pestaña. Encuentra el proyecto oficial a través de una fuente de confianza — su cuenta verificada de Twitter/X o un agregador reconocido como DeFiLlama o CoinGecko. Reporta el sitio a la base de datos de phishing de MetaMask en github.com/MetaMask/eth-phishing-detect.' },
      ],
    },
    disclaimer: {
      text: 'Los resultados de verificación de billeteras provienen de bases de datos públicas incluyendo GoPlus Security, Etherscan, Alchemy y honeypot.is. Los resultados de dApp / sitio web provienen de MetaMask eth-phishing-detect, ScamSniffer, GoPlus Security, URLScan.io y OpenPhish. Todos los hallazgos se reportan desde bases de datos de terceros y no son verificados independientemente por Almstins. Esta herramienta no constituye asesoramiento financiero ni legal. Haz siempre tu propia investigación.',
      link: 'Una herramienta gratuita de Almstins — rastreador de portafolio cripto y herramienta de contabilidad.',
    },
    js: {
      checking: 'Verificando…',
      reported: 'Reportado',
      pending: 'Pendiente…',
      noneFound: 'No encontrado ✓',
      noData: 'Sin datos',
      verdict: {
        red: 'PELIGRO — No conectes tu billetera',
        yellow: 'PRECAUCIÓN — No se puede confirmar que este sitio sea seguro',
        green: 'NO ENCONTRADO — Sin reportes en ninguna base de datos',
      },
      safety: {
        red: '🛑 Una o más bases de datos de seguridad han reportado este sitio. NO conectes tu billetera ni firmes transacciones hasta estar seguro.',
        yellow: '⚠️ Este sitio tiene historial de escaneo limitado. Solo conecta tu billetera a sitios que encontraste tú mismo.',
        green: '✅ No se detectaron amenazas. Verifica siempre la URL en tu navegador antes de firmar cualquier transacción.',
      },
      warmup: 'El servidor está despertando tras un período de inactividad. Espera un momento — los resultados están en camino…',
      timeoutRetry: 'El servidor está calentando tras un período de inactividad — reintentando en un momento…',
      checkFailedPrefix: 'Verificación fallida: ',
      checkFailedSuffix: '. Inténtalo de nuevo.',
      unknownError: 'Error desconocido',
      checkFailedGeneric: 'Verificación fallida. Inténtalo de nuevo.',
    },
  },

  // ──────────────────────────────────────────────────────────── Français ──
  fr: {
    url: 'https://almstins.com/wallet-checker/fr',
    meta: {
      title: "Vérificateur d'Arnaques Crypto — Cette Adresse Est-Elle Sûre ?",
      description:
        "Collez n'importe quelle adresse de portefeuille Ethereum, Solana ou Sui pour vérifier instantanément les arnaques connues, le phishing, les honeypots, l'activité sur le dark web et l'usage de mixers. Gratuit, sans compte.",
    },
    ld: {
      name: "Vérificateur d'Arnaques Crypto",
      description:
        "Outil gratuit pour vérifier toute adresse de portefeuille crypto contre les arnaques connues, le phishing, les honeypots, l'activité sur le dark web et l'usage de mixers. Compatible Ethereum, Solana et Sui.",
      featureList: [
        "Détection d'adresses d'arnaque connues",
        'Identification de portefeuilles de phishing',
        'Détection de tokens honeypot',
        'Signalement de transactions du dark web',
        'Détection de Mixer / Tornado Cash',
        'Identification de contrats multi-sig',
        'Consultation du solde de tokens',
        "Historique d'activité et ancienneté du portefeuille",
      ],
    },
    nav: {
      aria: 'Navigation du site Almstins',
      brandAria: "Accueil d'Almstins",
      tagline: 'Suivi de portefeuille crypto et outil de comptabilité',
      login: 'Se connecter',
      signup: 'Inscription gratuite',
    },
    hero: {
      eyebrow: 'Gratuit · Sans compte · Résultats en quelques secondes',
      title: "Vérificateur d'Arnaques Crypto",
      sub: "On vous propose une offre qui semble trop belle pour être vraie ? Avant d'envoyer le moindre token, collez l'adresse du portefeuille ci-dessous. Nous la vérifions contre des bases de données publiques d'arnaques, des détecteurs de honeypots et des données on-chain — instantanément.",
    },
    cards: {
      dapp: { title: 'Connexion à un site malveillant', cta: "Qu'est-ce que c'est ? →", placeholder: 'Collez une URL ou un domaine…', btn: 'Vérifier le site' },
      wallet: { title: 'Investir dans une arnaque connue', cta: "Qu'est-ce que c'est ? →", placeholder: 'Collez une adresse de portefeuille…', btn: 'Vérifier le portefeuille' },
      approval: { title: 'Vol par approbation de tokens', cta: "Qu'est-ce que c'est ? →", desc: 'Ces outils communautaires vous montrent instantanément quels contrats ont accès à vos cryptos — et vous permettent de les révoquer.' },
    },
    modalClose: 'Fermer',
    modals: {
      phishing: {
        title: 'Se connecter à un site malveillant',
        subtitle: 'Wallet drainers et dApps de phishing',
        bodyHtml: `<p>Les escrocs créent des copies quasi parfaites de dApps légitimes — faux mints de NFT, fausses réclamations de tokens, fausses pages d'airdrop. Le site a l'air vrai. L'URL est proche mais légèrement différente (<code>blur-io.xyz</code> au lieu de <code>blur.io</code>). Quand vous connectez votre MetaMask et signez ce qui ressemble à une transaction de routine, vous accordez en réalité la permission de vider tous les tokens de votre portefeuille en un seul mouvement.</p>
          <div class="threat-modal__example">💸 <strong>Exemple réel :</strong> En 2023, une fausse page d'airdrop de Blur.io a drainé plus de <strong>1,2 million de dollars</strong> à des détenteurs de NFT en quelques heures après son lancement. La plupart des victimes ont dit avoir « vérifié l'URL deux fois » mais n'ont pas vu un seul caractère différent.</div>
          <p>Ces sites apparaissent sous forme de liens dans des messages privés Discord, des réponses sur Twitter/X, des groupes Telegram et même des publicités payantes. L'attaquant paie une annonce Google pour apparaître au-dessus du vrai site.</p>
          <div class="threat-modal__tip">✅ <strong>Comment notre vérificateur de dApps vous protège :</strong> collez l'URL avant de vous connecter. Nous interrogeons 7 bases de données de sécurité — y compris la liste de blocage anti-phishing de MetaMask et la base de 345 000 domaines de ScamSniffer — et renvoyons un verdict en quelques secondes. <strong>Règle d'or : ne cliquez jamais sur un lien de portefeuille envoyé en message privé.</strong></div>`,
      },
      scam: {
        title: 'Investir dans une arnaque connue',
        subtitle: 'Pig butchering, honeypots et rug pulls',
        bodyHtml: `<p>Les arnaques de <strong>pig butchering</strong> construisent la confiance sur des semaines ou des mois — un nouveau contact sur une appli de rencontre ou un réseau social vous présente progressivement une « belle opportunité d'investissement ». L'adresse de portefeuille qu'on vous envoie a souvent déjà été signalée. Les <strong>tokens honeypot</strong> vous laissent acheter mais vous empêchent de vendre — le contrat est programmé pour piéger vos fonds pendant que le développeur vide le pool de liquidité.</p>
          <div class="threat-modal__example">💸 <strong>Exemple réel :</strong> le Centre de plaintes contre la criminalité sur Internet (IC3) du FBI a signalé <strong>3,3 milliards de dollars</strong> de fraudes à l'investissement crypto rien qu'en 2023 — la catégorie de fraude qui croît le plus vite. La plupart des victimes n'avaient jamais entendu parler du « pig butchering » avant d'en être victimes.</div>
          <p>Un rug pull ressemble à un lancement de token légitime. Les développeurs créent du hype autour du projet, la liquidité afflue, puis l'équipe retire tout du jour au lendemain et le token tombe à zéro.</p>
          <div class="threat-modal__tip">✅ <strong>Comment notre vérificateur de portefeuilles vous protège :</strong> avant d'envoyer des fonds à un portefeuille, collez l'adresse ici. Nous la vérifions contre la liste noire mondiale d'arnaques de GoPlus Security, recherchons des schémas de honeypot dans les tokens associés et signalons l'usage de mixers qui indique du blanchiment. Si quelqu'un vous presse d'envoyer des cryptos rapidement — c'est ça l'arnaque.</div>`,
      },
      approval: {
        title: 'Vol par approbation de tokens',
        subtitle: 'Approbations illimitées et vidages silencieux',
        bodyHtml: `<p>Chaque fois que vous cliquez sur « Approuver » lors d'un swap de tokens ou d'un mint de NFT, vous signez un message de contrat intelligent qui dit <em>« ce contrat peut dépenser mes tokens »</em>. La plupart des dApps utilisent l'<strong>approbation illimitée</strong> par défaut — elles peuvent prendre la totalité de votre solde de ce token, à tout moment, pour toujours, jusqu'à ce que vous la révoquiez explicitement. Ces permissions persistent longtemps après que vous ayez oublié que le site existait.</p>
          <div class="threat-modal__example">💸 <strong>Exemple réel :</strong> lorsque le pont Multichain a été exploité en 2023, les attaquants ont utilisé d'<strong>anciennes approbations</strong> que les utilisateurs avaient accordées des mois plus tôt pour drainer <strong>125 millions de dollars</strong>. Beaucoup de victimes n'avaient pas utilisé le pont depuis plus d'un an.</div>
          <p>Une dApp compromise, un rug pull ou un exploit zero-day peut activer ces approbations au moment où il est lancé — sans aucune seconde signature de votre part.</p>
          <div class="threat-modal__tip">✅ <strong>Comment vous protéger :</strong> rendez-vous sur <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> pour voir chaque approbation active sur votre portefeuille et révoquer tout ce que vous ne reconnaissez pas. Définissez toujours des montants exacts plutôt qu'illimités lorsque votre portefeuille vous le permet — et révoquez après chaque interaction terminée.</div>`,
      },
    },
    tablistAria: 'Type de vérification',
    tabs: { wallet: '🔍 Adresse de Portefeuille', dapp: '🌐 dApp / Site Web' },
    dapp: { placeholder: 'https://dapp-suspecte.xyz  ou collez simplement le domaine', btn: 'Vérifier le site' },
    vtPending: { msgHtml: `Analyse VirusTotal en cours — nouvelle vérification automatique dans <strong id="vt-countdown">90</strong>s`, recheck: 'Revérifier maintenant' },
    checkQueue: {
      metamask: 'Bases de données de phishing',
      scamsniffer: 'Listes de domaines frauduleux',
      openphish: 'Flux actif de phishing',
      goplus: 'Renseignement de menaces en direct',
      urlscan: 'Historique de sécurité des URL',
      gsb: 'Google Safe Browsing',
      virustotal: 'Analyse de malwares',
    },
    cta: {
      aria: "À propos d'Almstins",
      headline: 'Vous voulez suivre tout ce que vous détenez ?',
      sub: "Almstins réunit vos portefeuilles, positions DeFi et comptes d'exchange au même endroit — et suit automatiquement vos plus-values, vos avoirs et vos gains réalisés.",
      btn: 'Commencer gratuitement →',
    },
    signals: {
      title: 'Ce que nous vérifions',
      walletSub: "🔍 Vérificateur d'adresse de portefeuille",
      dappSub: '🌐 Vérificateur de dApp / site web',
      wallet: [
        { icon: '🚨', label: "Bases de données d'arnaques connues", body: "Recoupé avec la liste noire mondiale de GoPlus Security regroupant les portefeuilles d'arnaque, de phishing et de vidage signalés." },
        { icon: '🍯', label: 'Détection de honeypot', body: "Vérifie si les tokens associés à cette adresse peuvent réellement être vendus — ou s'ils sont conçus pour piéger vos fonds." },
        { icon: '🌑', label: 'Activité sur le dark web', body: 'Signale les adresses ayant des liens connus avec des marchés du dark web et des schémas de transactions illicites.' },
        { icon: '🔀', label: 'Mixer / Tornado Cash', body: "Détecte l'usage de mixers crypto comme Tornado Cash — une méthode courante des escrocs pour blanchir des fonds avant un rug pull." },
        { icon: '📅', label: 'Ancienneté du portefeuille', body: "Les portefeuilles récents (< 30 jours) sont un signal d'alerte majeur. Les escrocs créent une nouvelle adresse pour chaque opération." },
        { icon: '💰', label: 'Avoirs en tokens', body: "Montre ce que contient réellement le portefeuille. Les portefeuilles d'arnaque contiennent souvent des tokens sans valeur conçus pour paraître précieux." },
        { icon: '⚖️', label: 'Vérification des sanctions', body: "Vérifie contre les listes de sanctions de l'OFAC et internationales pour les adresses impliquées dans des crimes financiers." },
        { icon: '🔑', label: 'Détection multi-sig', body: "Identifie si l'adresse est un contrat multi-sig. Les investissements légitimes ne vous demandent jamais de déposer dans le leur." },
      ],
      dapp: [
        { icon: '🦊', label: 'Liste de blocage de MetaMask', body: "Vérifie contre la liste eth-phishing-detect de MetaMask — plus de 198 000 domaines de phishing crypto maintenus par l'équipe de sécurité de MetaMask." },
        { icon: '🕵️', label: 'Base de données ScamSniffer', body: "La plus grande liste de domaines de phishing web3 disponible, avec plus de 345 000 sites signalés. Mise à jour quotidiennement par l'équipe de sécurité de ScamSniffer." },
        { icon: '🛡️', label: 'GoPlus Security', body: "Interrogation en temps réel de l'API de phishing web3 en direct de GoPlus — le même moteur utilisé par MetaMask, Trust Wallet et d'autres portefeuilles majeurs." },
        { icon: '🔬', label: 'URLScan.io', body: 'Recherche les analyses antérieures du domaine par des chercheurs en sécurité pour afficher tout verdict malveillant de la communauté mondiale de sécurité.' },
        { icon: '🎣', label: 'Flux OpenPhish', body: "Recoupe avec la liste activement maintenue d'OpenPhish d'URLs de phishing en direct, mise à jour en temps réel." },
        { icon: '🔍', label: 'Google Safe Browsing', body: "Lorsqu'il est configuré, interroge la base de données de menaces de Google — l'un des plus grands référentiels d'URLs de phishing et de malware au monde." },
        { icon: '🦠', label: 'VirusTotal', body: "Lorsqu'il est configuré, vérifie l'URL contre plus de 70 moteurs antivirus et de sécurité simultanément pour un verdict complet." },
        { icon: '⚠️', label: 'Attribution, pas verdict', body: "Nous rapportons ce que disent les bases de données tierces. Nous ne déclarons pas de manière indépendante qu'un site est une arnaque. Vérifiez toujours avant de connecter votre portefeuille." },
      ],
    },
    approvals: {
      title: "Votre portefeuille est-il connecté à quelque chose qu'il ne devrait pas ?",
      intro: "Chaque fois que vous connectez MetaMask (ou n'importe quel portefeuille) à une dApp et approuvez une transaction, vous accordez à ce contrat la permission de déplacer des tokens en votre nom — parfois sans plafond de dépense et sans date d'expiration. Ces approbations restent actives même après que vous ayez cessé d'utiliser le site. Une dApp compromise ou malveillante peut vider votre portefeuille des mois plus tard en utilisant une permission que vous avez oublié avoir accordée.",
      whatTitle: "⚠️ Ce qu'une approbation signifie vraiment",
      whatHtml: `<p>Quand vous cliquez sur « Approuver » lors d'un swap de tokens ou d'un mint de NFT, vous signez un appel de contrat intelligent qui dit <em>« ce contrat peut dépenser X de mes tokens »</em>. Beaucoup de dApps utilisent l'<strong>approbation illimitée</strong> par défaut — ce qui signifie qu'elles peuvent prendre tout ce que vous détenez de ce token, à tout moment, pour toujours, jusqu'à ce que vous la révoquiez.</p>
        <p>Si cette dApp est ensuite exploitée, fait un rug pull, ou s'avère avoir été malveillante depuis le début, l'attaquant peut utiliser votre approbation existante pour vider votre portefeuille — sans aucune seconde signature.</p>`,
      howTitle: '🔍 Comment voir et révoquer vos approbations',
      howIntro: "Ces outils gratuits se connectent à votre portefeuille (en lecture seule) et affichent chaque approbation active sur toutes les chaînes — puis vous permettent de révoquer celles que vous ne reconnaissez pas ou dont vous n'avez plus besoin.",
      tools: [
        { name: 'revoke.cash', badge: 'Le plus fiable', href: 'https://revoke.cash', desc: 'La référence absolue. Multi-chaînes, affiche les approbations illimitées vs limitées, révocation en un clic. Aucun compte requis.' },
        { name: 'etherscan.io/tokenapprovalchecker', href: 'https://etherscan.io/tokenapprovalchecker', desc: "Le vérificateur d'approbations officiel d'Etherscan. Collez votre adresse pour voir chaque permission ouverte sur Ethereum — sans avoir à connecter votre portefeuille." },
      ],
      tipsTitle: 'Bonnes pratiques',
      tips: [
        { icon: '✂️', title: 'Révoquez après chaque interaction', body: "Une fois que vous en avez fini avec une dApp, révoquez son approbation. Aucun inconvénient — vous pourrez la ré-approuver la prochaine fois que vous l'utiliserez." },
        { icon: '🔢', title: 'Définissez des montants exacts, pas illimités', body: "En approuvant un swap, certains portefeuilles permettent de définir un montant personnalisé. N'approuvez toujours que ce dont vous avez besoin pour cette transaction." },
        { icon: '🗓️', title: 'Auditez vos approbations régulièrement', body: "Faites une vérification sur revoke.cash tous les quelques mois — surtout après l'annonce d'un exploit DeFi, car les attaquants visent souvent les anciennes approbations." },
        { icon: '🦊', title: 'Lisez ce que MetaMask vous demande vraiment', body: "Avant de cliquer sur Confirmer, déployez les détails de la transaction. S'il est écrit « Illimité » à côté d'une quantité de token — c'est un signal d'alerte qui mérite une pause." },
      ],
    },
    faq: {
      title: "Foire aux questions et schémas d'arnaque",
      items: [
        { q: "Qu'est-ce que le vérificateur de dApp / site web ?", a: "C'est un outil gratuit qui prend n'importe quelle URL ou domaine et interroge jusqu'à 7 bases de données de sécurité indépendantes simultanément — dont la liste de blocage anti-phishing de MetaMask, ScamSniffer, GoPlus, URLScan.io et OpenPhish. Il renvoie un résultat rouge, jaune ou vert selon ce que rapportent ces bases. Nous ne portons pas notre propre jugement — nous montrons ce que la communauté de sécurité a déjà signalé." },
        { q: 'Que signifie un résultat rouge pour un site web ?', a: "Cela signifie qu'une ou plusieurs des bases de données de sécurité que nous interrogeons ont signalé ce domaine. Cela ne veut pas dire que nous le qualifions d'arnaque — ce jugement provient de la base de données tierce. Vous devez traiter un résultat rouge comme un avertissement sérieux, faire vos propres recherches complémentaires et ne pas connecter votre portefeuille tant que vous n'êtes pas certain que le site est légitime." },
        { q: 'Que signifie un résultat jaune ?', a: "Jaune signifie que le site ne figure sur aucune liste de blocage, mais qu'il a aussi peu ou pas d'historique d'analyses de sécurité — il n'y a donc pas assez de données pour lui donner un certificat de bonne santé. Les sites récents, les domaines obscurs ou les adresses enregistrées récemment affichent souvent jaune. Procédez avec prudence et vérifiez le site via des canaux officiels avant de vous connecter." },
        { q: "Puis-je faire confiance à un site juste parce qu'il affiche vert ?", a: "Non. Un résultat vert signifie que le site n'a été signalé dans aucune des bases de données que nous vérifions — pas qu'il est définitivement sûr. Les nouveaux sites de phishing disposent de quelques heures avant d'être ajoutés aux listes de blocage. Vérifiez toujours l'URL exacte dans la barre de votre navigateur, cherchez les comptes officiels sur les réseaux sociaux, et ne connectez jamais un portefeuille depuis un lien envoyé par message privé ou e-mail." },
        { q: 'Comment fonctionnent les sites de wallet drainer ?', a: "Un wallet drainer est un site web qui imite une dApp légitime — un faux mint de NFT, une fausse réclamation de token ou un faux airdrop. Quand vous connectez votre MetaMask et signez une transaction, vous signez en réalité une permission qui autorise l'attaquant à transférer tous les tokens de votre portefeuille en un seul mouvement. Tout le solde peut disparaître en quelques secondes. Le site disparaît souvent en quelques heures." },
        { q: "Qu'est-ce qu'une arnaque honeypot ?", a: "Un honeypot est un token que vous pouvez acheter mais jamais revendre. L'escroc en fait la promotion, vous achetez, le prix semble monter — mais quand vous essayez de vendre, le contrat vous bloque. L'escroc draine ensuite la liquidité et disparaît avec votre ETH." },
        { q: "À quoi ressemble « trop beau pour être vrai » en crypto ?", a: "Des rendements quotidiens garantis de 1 à 10 %, « mettez simplement vos tokens dans notre portefeuille », des réclamations d'airdrop qui exigent d'envoyer des tokens d'abord, ou quelqu'un en message privé qui propose de doubler vos cryptos. Si le rendement paraît impossible dans la finance traditionnelle, c'est une arnaque en crypto." },
        { q: 'Pourquoi utiliserais-je un portefeuille Tornado Cash ?', a: "Tornado Cash est un mixer qui brise le lien on-chain entre les adresses de portefeuille. Bien que certains utilisateurs y voient une question de confidentialité, il est largement utilisé par les escrocs et les hackers pour masquer l'origine de fonds volés avant de les encaisser." },
        { q: "Dois-je faire confiance à un portefeuille juste parce qu'il a un gros solde ?", a: "Non. Les escrocs chargent souvent les portefeuilles de tokens sans valeur ou de soldes « sur le papier » gonflés pour donner une apparence de légitimité. Vérifiez toujours si ces tokens peuvent réellement être vendus et combien ils valent réellement." },
        { q: 'Un portefeuille récent est-il toujours suspect ?', a: "Pas toujours — mais dans le contexte de quelqu'un qui propose un investissement, un portefeuille créé au cours des 30 derniers jours est un signal d'alerte majeur. Les protocoles et entreprises légitimes ont un historique on-chain établi." },
        { q: 'Que dois-je faire si cet outil signale une adresse de portefeuille ?', a: "N'envoyez pas de fonds. Faites une capture d'écran des résultats. Si quelqu'un vous presse d'envoyer des cryptos vers une adresse signalée, cette pression fait elle-même partie de l'arnaque. Signalez l'adresse sur chainabuse.com et retirez-vous." },
        { q: 'Que dois-je faire si le vérificateur de dApp signale un site web ?', a: "Ne connectez pas votre portefeuille. Fermez l'onglet. Trouvez le projet officiel via une source fiable — son compte Twitter/X vérifié ou un agrégateur reconnu comme DeFiLlama ou CoinGecko. Signalez le site à la base de données de phishing de MetaMask sur github.com/MetaMask/eth-phishing-detect." },
      ],
    },
    disclaimer: {
      text: "Les résultats de vérification des portefeuilles proviennent de bases de données publiques dont GoPlus Security, Etherscan, Alchemy et honeypot.is. Les résultats dApp / site web proviennent de MetaMask eth-phishing-detect, ScamSniffer, GoPlus Security, URLScan.io et OpenPhish. Tous les constats sont rapportés depuis des bases de données tierces et ne sont pas vérifiés de manière indépendante par Almstins. Cet outil ne constitue ni un conseil financier ni un conseil juridique. Faites toujours vos propres recherches.",
      link: "Un outil gratuit d'Almstins — suivi de portefeuille crypto et outil de comptabilité.",
    },
    js: {
      checking: 'Vérification…',
      reported: 'Signalé',
      pending: 'En attente…',
      noneFound: 'Introuvable ✓',
      noData: 'Aucune donnée',
      verdict: {
        red: 'DANGER — Ne connectez pas votre portefeuille',
        yellow: 'PRUDENCE — Impossible de confirmer que ce site est sûr',
        green: 'INTROUVABLE — Absent de toute base de données de sécurité',
      },
      safety: {
        red: "🛑 Une ou plusieurs bases de données de sécurité ont signalé ce site. Ne connectez pas votre portefeuille et ne signez aucune transaction tant que vous n'êtes pas certain.",
        yellow: '⚠️ Ce site a un historique d\'analyse limité. Ne connectez votre portefeuille qu\'à des sites que vous avez trouvés vous-même.',
        green: "✅ Aucune menace détectée. Vérifiez toujours l'URL dans votre navigateur avant de signer une transaction.",
      },
      warmup: "Le serveur se réveille après une période d'inactivité. Patientez — les résultats arrivent…",
      timeoutRetry: "Le serveur redémarre après une période d'inactivité — nouvelle tentative dans un instant…",
      checkFailedPrefix: 'Échec de la vérification : ',
      checkFailedSuffix: '. Réessayez.',
      unknownError: 'Erreur inconnue',
      checkFailedGeneric: 'Échec de la vérification. Réessayez.',
    },
  },
};
