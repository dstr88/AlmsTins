export interface WalletCheckerLocale {
  lang: 'en' | 'es';
  meta: { title: string; description: string };
  jsonld: {
    appName: string;
    appUrl: string;
    appDescription: string;
    featureList: string[];
  };
  nav: {
    ariaLabel: string;
    brandAriaLabel: string;
    tagline: string;
    langLabel: string;
    langHref: string;
    langAriaLabel: string;
    login: string;
    signup: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    sub: string;
  };
  cards: {
    site:     { title: string; cta: string; placeholder: string; button: string };
    wallet:   { title: string; cta: string; placeholder: string; button: string };
    approval: { title: string; cta: string; desc: string };
  };
  modal: { close: string };
  modals: {
    phishing: { title: string; subtitle: string; p1: string; example: string; p2: string; tip: string };
    scam:     { title: string; subtitle: string; p1: string; example: string; p2: string; tip: string };
    approval: { title: string; subtitle: string; p1: string; example: string; p2: string; tip: string };
  };
  tabs: { ariaLabel: string; wallet: string; dapp: string };
  dappPanel: { placeholder: string; button: string; loading: string };
  cta: { ariaLabel: string; headline: string; sub: string; button: string };
  signals: {
    title: string;
    walletSub: string;
    walletCards: Array<{ icon: string; label: string; body: string }>;
    dappSub: string;
    dappCards: Array<{ icon: string; label: string; body: string }>;
  };
  approvals: {
    title: string;
    intro: string;
    whatTitle: string;
    whatP1: string;
    whatP2: string;
    howTitle: string;
    howIntro: string;
    tools: Array<{ badge?: string; desc: string }>;
    tipsTitle: string;
    tips: Array<{ icon: string; title: string; body: string }>;
  };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  disclaimer: { text: string; link: string };
  js: {
    warmupHint: string;
    warmupRetry: string;
    checkFailed: string;
    tryAgain: string;
    verdictDanger: string;
    verdictCaution: string;
    verdictSafe: string;
    tipRed: string;
    tipYellow: string;
    tipGreen: string;
  };
}

export const en: WalletCheckerLocale = {
  lang: 'en',
  meta: {
    title: 'Crypto Wallet Scam Checker — Is This Address Safe?',
    description: 'Paste any Ethereum, Solana, or Sui wallet address to instantly check for known scams, phishing, honeypots, dark web activity, and mixer use. Free, no login required.',
  },
  jsonld: {
    appName: 'Crypto Wallet Scam Checker',
    appUrl: 'https://almstins.com/wallet-checker',
    appDescription: 'Free tool to check any crypto wallet address for known scams, phishing, honeypots, dark web activity, and mixer use. Supports Ethereum, Solana, and Sui.',
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
    ariaLabel: 'Almstins site navigation',
    brandAriaLabel: 'Almstins home',
    tagline: 'Crypto portfolio tracker & bookkeeping tool',
    langLabel: '🇪🇸 En Español',
    langHref: '/wallet-checker/es',
    langAriaLabel: 'Ver en español',
    login: 'Log in',
    signup: 'Sign up free',
  },
  hero: {
    eyebrow: 'Free · No login required · Results in seconds',
    title: 'Crypto Wallet Scam Checker',
    sub: 'Been offered a deal that sounds too good to be true? Before you send a single token, paste the wallet address below. We\'ll check it against public scam databases, honeypot detectors, and on-chain data — instantly.',
  },
  cards: {
    site: {
      title: 'Paste your URL here',
      cta: 'What is this? →',
      placeholder: 'Paste a URL or domain…',
      button: 'Check site',
    },
    wallet: {
      title: 'Paste a wallet address',
      cta: 'What is this? →',
      placeholder: 'Paste a wallet address…',
      button: 'Check wallet',
    },
    approval: {
      title: 'Token approval theft',
      cta: 'What is this? →',
      desc: 'These community-driven tools show you instantly which contracts have their claws in your crypto — and let you revoke them.',
    },
  },
  modal: { close: 'Close' },
  modals: {
    phishing: {
      title: 'Connecting to a malicious site',
      subtitle: 'Wallet drainers & phishing dApps',
      p1: 'Scammers build near-perfect copies of legitimate dApps — fake NFT mints, fake token claims, fake airdrop pages. The site looks real. The URL is close but slightly off (<code>blur-io.xyz</code> instead of <code>blur.io</code>). When you connect your MetaMask and sign what looks like a routine transaction, you\'re actually handing over permission to drain every token from your wallet in one move.',
      example: '💸 <strong>Real example:</strong> In 2023 a fake Blur.io airdrop page drained over <strong>$1.2 million</strong> from NFT holders within hours of launch. Most victims said they "double-checked the URL" but missed a single character.',
      p2: 'These sites appear as links in Discord DMs, Twitter/X replies, Telegram groups, and even paid ads. The attacker pays for a Google ad to appear above the real site.',
      tip: '✅ <strong>How our dApp checker protects you:</strong> Paste the URL before connecting. We query 7 security databases — including MetaMask\'s own phishing blocklist and ScamSniffer\'s 345,000-domain database — and return a verdict in seconds. <strong>Golden rule: never click a wallet link sent in a DM.</strong>',
    },
    scam: {
      title: 'Investing in a known scam',
      subtitle: 'Pig butchering, honeypots & rug pulls',
      p1: '<strong>Pig-butchering</strong> scams build trust over weeks or months — a new contact on a dating app or social media gradually introduces you to a "great investment opportunity." The wallet address they send has often already been reported. <strong>Honeypot tokens</strong> let you buy but block you from selling — the contract is coded to trap your funds while the developer drains the liquidity pool.',
      example: '💸 <strong>Real example:</strong> The FBI\'s Internet Crime Complaint Center (IC3) reported <strong>$3.3 billion</strong> in crypto investment fraud in 2023 alone — the fastest-growing fraud category. Most victims had never heard of "pig butchering" before it happened to them.',
      p2: 'A rug pull looks like a legitimate token launch. Developers hype the project, liquidity pours in, then the team withdraws everything overnight and the token goes to zero.',
      tip: '✅ <strong>How our wallet checker protects you:</strong> Before sending funds to any wallet, paste the address here. We check it against GoPlus Security\'s global scam blacklist, look for honeypot patterns in associated tokens, and flag mixer use that indicates money laundering. If someone is pressuring you to send crypto quickly — that\'s the scam.',
    },
    approval: {
      title: 'Token approval theft',
      subtitle: 'Unlimited approvals & silent drains',
      p1: 'Every time you click "Approve" on a token swap or NFT mint, you sign a smart-contract message that says <em>"this contract can spend my tokens."</em> Most dApps default to <strong>unlimited approval</strong> — they can take your entire balance of that token, any time, forever, until you explicitly revoke it. These permissions survive long after you\'ve forgotten the site existed.',
      example: '💸 <strong>Real example:</strong> When the Multichain bridge was exploited in 2023, attackers used <strong>old approvals</strong> users had granted months earlier to drain <strong>$125 million</strong>. Many victims hadn\'t used the bridge in over a year.',
      p2: 'A compromised dApp, a rug pull, or a zero-day exploit can trigger those approvals the moment it launches — no additional signature from you required.',
      tip: '✅ <strong>How to protect yourself:</strong> Visit <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> to see every active approval on your wallet and revoke anything you don\'t recognise. Always set exact amounts instead of unlimited when a wallet gives you the choice — and revoke after every interaction you\'re done with.',
    },
  },
  tabs: {
    ariaLabel: 'Checker type',
    wallet: '🔍 Wallet Address',
    dapp: '🌐 dApp / Website',
  },
  dappPanel: {
    placeholder: 'https://suspicious-dapp.xyz  or just paste the domain',
    button: 'Check site',
    loading: 'Checking security databases…',
  },
  cta: {
    ariaLabel: 'About Almstins',
    headline: 'Want to track everything you own?',
    sub: 'Almstins connects your wallets, DeFi positions, and exchange accounts in one place — and automatically tracks your capital gains, holdings, and realized gains.',
    button: 'Get started free →',
  },
  signals: {
    title: 'What we check',
    walletSub: '🔍 Wallet Address checker',
    walletCards: [
      { icon: '🚨', label: 'Known scam databases',  body: 'Cross-referenced against GoPlus Security\'s global blacklist of reported scam, phishing, and drainer wallets.' },
      { icon: '🍯', label: 'Honeypot detection',    body: 'Checks whether tokens associated with this address can actually be sold — or if they\'re designed to trap your funds.' },
      { icon: '🌑', label: 'Dark web activity',     body: 'Flags addresses with known connections to dark web marketplaces and illicit transaction patterns.' },
      { icon: '🔀', label: 'Mixer / Tornado Cash',  body: 'Detects use of crypto mixers like Tornado Cash — a common way scammers launder funds before a rug pull.' },
      { icon: '📅', label: 'Wallet age',            body: 'New wallets (< 30 days old) are a major red flag. Scammers create fresh addresses for each operation.' },
      { icon: '💰', label: 'Token holdings',        body: 'Shows what\'s actually in the wallet. Scam wallets often hold worthless tokens designed to look valuable.' },
      { icon: '⚖️', label: 'Sanctions check',       body: 'Checks against OFAC and international sanctions lists for addresses involved in financial crime.' },
      { icon: '🔑', label: 'Multi-sig detection',   body: 'Identifies if the address is a multi-sig contract. Legitimate investments never ask you to deposit into theirs.' },
    ],
    dappSub: '🌐 dApp / Website checker',
    dappCards: [
      { icon: '🦊', label: 'MetaMask blocklist',     body: 'Checks against MetaMask\'s own eth-phishing-detect list — over 198,000 crypto phishing domains maintained by the MetaMask security team.' },
      { icon: '🕵️', label: 'ScamSniffer database',  body: 'The largest web3 phishing domain list available, with over 345,000 reported sites. Updated daily by the ScamSniffer security team.' },
      { icon: '🛡️', label: 'GoPlus Security',        body: 'Real-time lookup against GoPlus\'s live web3 phishing API — the same engine used by MetaMask, Trust Wallet, and other major wallets.' },
      { icon: '🔬', label: 'URLScan.io',             body: 'Searches prior security researcher scans of the domain to surface any malicious verdicts from the global security community.' },
      { icon: '🎣', label: 'OpenPhish feed',         body: 'Cross-references against OpenPhish\'s actively-maintained list of live phishing URLs updated in real time.' },
      { icon: '🔍', label: 'Google Safe Browsing',   body: 'When configured, queries Google\'s threat database — one of the largest phishing and malware URL repositories in the world.' },
      { icon: '🦠', label: 'VirusTotal',             body: 'When configured, checks the URL against 70+ antivirus and security engines simultaneously for a comprehensive verdict.' },
      { icon: '⚠️', label: 'Attribution, not verdict', body: 'We report what third-party databases say. We do not independently declare any site a scam. Always verify before connecting your wallet.' },
    ],
  },
  approvals: {
    title: 'Is your wallet connected to something it shouldn\'t be?',
    intro: 'Every time you connect MetaMask (or any wallet) to a dApp and approve a transaction, you\'re granting that contract permission to move tokens on your behalf — sometimes with no spending limit and no expiry date. These approvals stay active even after you stop using the site. A compromised or malicious dApp can drain your wallet months later using a permission you forgot you gave.',
    whatTitle: '⚠️ What an approval actually means',
    whatP1: 'When you click "Approve" on a token swap or NFT mint, you\'re signing a smart contract call that says <em>"this contract can spend X amount of my tokens."</em> Many dApps default to <strong>unlimited approval</strong> — meaning they can take everything you have of that token, any time, forever, until you revoke it.',
    whatP2: 'If that dApp is later exploited, rug-pulled, or turns out to have been malicious from the start, the attacker can use your existing approval to empty your wallet — no second signature required.',
    howTitle: '🔍 How to see and revoke your approvals',
    howIntro: 'These free tools connect to your wallet (read-only) and show every active approval across all chains — then let you revoke the ones you don\'t recognize or no longer need.',
    tools: [
      { badge: 'Most trusted', desc: 'The gold standard. Multi-chain, shows unlimited vs. limited approvals, one-click revoke. No account needed.' },
      { desc: 'Etherscan\'s official approval checker. Paste your address to see every open permission on Ethereum — no wallet connection required.' },
    ],
    tipsTitle: 'Best practices',
    tips: [
      { icon: '✂️', title: 'Revoke after every interaction',    body: 'Once you\'re done with a dApp, revoke its approval. There\'s no downside — you can re-approve the next time you use it.' },
      { icon: '🔢', title: 'Set exact amounts, not unlimited',  body: 'When approving a swap, some wallets let you set a custom amount. Always approve only what you need for that transaction.' },
      { icon: '🗓️', title: 'Audit your approvals regularly',   body: 'Run a revoke.cash check every few months — especially after any news of a DeFi exploit, since attackers often target old approvals.' },
      { icon: '🦊', title: 'Read what MetaMask is actually asking', body: 'Before clicking Confirm, expand the transaction details. If it says "Unlimited" next to a token amount — that\'s a red flag worth pausing on.' },
    ],
  },
  faq: {
    title: 'Common questions & scam patterns',
    items: [
      { q: 'What is the dApp / Website checker?', a: 'It\'s a free tool that takes any URL or domain and queries up to 7 independent security databases simultaneously — including MetaMask\'s own phishing blocklist, ScamSniffer, GoPlus, URLScan.io, and OpenPhish. It returns a red, yellow, or green result based on what those databases report. We do not make our own determination — we surface what the security community has already flagged.' },
      { q: 'What does a red result mean for a website?', a: 'It means one or more of the security databases we query has reported that domain. It does not mean we are calling it a scam — that determination comes from the third-party database. You should treat a red result as a serious warning, do your own additional research, and not connect your wallet until you are certain the site is legitimate.' },
      { q: 'What does a yellow result mean?', a: 'Yellow means the site is not in any blocklist, but it also has little or no security scan history — so there\'s not enough data to give a clean bill of health. New sites, obscure domains, or recently registered addresses often show yellow. Proceed with caution and verify the site through official channels before connecting.' },
      { q: 'Can I trust a site just because it shows green?', a: 'No. A green result means the site hasn\'t been reported to any of the databases we check — not that it\'s definitively safe. Brand-new phishing sites get a few hours before they\'re added to blocklists. Always double-check the exact URL in your browser bar, look for the official social media accounts, and never connect a wallet from a link sent in a DM or email.' },
      { q: 'How do wallet drainer sites work?', a: 'A wallet drainer is a website that mimics a legitimate dApp — a fake NFT mint, a fake token claim, or a fake airdrop. When you connect your MetaMask and sign a transaction, you\'re actually signing a permission that lets the attacker transfer every token out of your wallet in one move. The entire balance can be gone in seconds. The site often disappears within hours.' },
      { q: 'What is a honeypot scam?', a: 'A honeypot is a token you can buy but never sell. The scammer promotes it, you buy in, the price appears to rise — but when you try to sell, the contract blocks you. The scammer then drains the liquidity and disappears with your ETH.' },
      { q: 'What does "too good to be true" actually look like in crypto?', a: 'Guaranteed daily returns of 1–10%, "just stake your tokens in our wallet," airdrop claims that require sending tokens first, or someone in DMs offering to double your crypto. If the return sounds impossible in traditional finance, it\'s a scam in crypto.' },
      { q: 'Why would a wallet use Tornado Cash?', a: 'Tornado Cash is a mixer that breaks the on-chain link between wallet addresses. While some users value privacy, it\'s heavily used by scammers and hackers to hide the origin of stolen funds before cashing out.' },
      { q: 'Should I trust a wallet just because it has a large balance?', a: 'No. Scammers often seed wallets with worthless tokens or inflated "paper" balances to create the appearance of legitimacy. Always check if those tokens can actually be sold and what they\'re truly worth.' },
      { q: 'Is a new wallet always suspicious?', a: 'Not always — but in the context of someone pitching an investment, a wallet created in the last 30 days is a major red flag. Legitimate protocols and businesses have established on-chain history.' },
      { q: 'What should I do if this tool flags a wallet address?', a: 'Do not send funds. Screenshot the results. If someone is pressuring you to send crypto to a flagged address, that pressure itself is part of the scam. Report the address on chainabuse.com and walk away.' },
      { q: 'What should I do if the dApp checker flags a website?', a: 'Do not connect your wallet. Close the tab. Find the official project through a trusted source — their verified Twitter/X account or a well-known aggregator like DeFiLlama or CoinGecko. Report the site to MetaMask\'s phishing database at github.com/MetaMask/eth-phishing-detect.' },
    ],
  },
  disclaimer: {
    text: 'Wallet check results are sourced from public databases including GoPlus Security, Etherscan, Alchemy, and honeypot.is. dApp / website results are sourced from MetaMask eth-phishing-detect, ScamSniffer, GoPlus Security, URLScan.io, and OpenPhish. All findings are reported from third-party databases and are not independently verified by Almstins. This tool does not constitute financial or legal advice. Always do your own research.',
    link: 'A free tool by Almstins — crypto portfolio tracker & bookkeeping tool.',
  },
  js: {
    warmupHint: 'The server is waking up after a period of inactivity. Hang tight — results are on their way…',
    warmupRetry: 'The server is warming up after a period of inactivity — retrying in a moment…',
    checkFailed: 'Check failed',
    tryAgain: 'Try again',
    verdictDanger: 'DANGER — Do not connect your wallet',
    verdictCaution: 'CAUTION — Cannot confirm this site is safe',
    verdictSafe: 'LOOKS SAFE — No threats detected',
    tipRed: '🛑 One or more security databases have reported this site. We are not making that determination ourselves — always verify independently. Do NOT connect your wallet or sign any transactions until you are certain.',
    tipYellow: '⚠️ This site has limited scan history. Only connect your wallet to sites you found yourself — never through a link in a DM or email.',
    tipGreen: '✅ No threats detected across all sources. Always double-check the URL in your browser bar before signing any transaction — even safe-looking sites can be typosquatted.',
  },
};

export const es: WalletCheckerLocale = {
  lang: 'es',
  meta: {
    title: 'Verificador de Estafas de Cripto — ¿Es Segura Esta Dirección?',
    description: 'Pega cualquier dirección de billetera de Ethereum, Solana o Sui para verificar al instante si hay estafas conocidas, phishing, honeypots, actividad en la dark web y uso de mixers. Gratis, sin cuenta requerida.',
  },
  jsonld: {
    appName: 'Verificador de Estafas de Cripto',
    appUrl: 'https://almstins.com/wallet-checker/es',
    appDescription: 'Herramienta gratuita para verificar cualquier dirección de billetera cripto en busca de estafas conocidas, phishing, honeypots, actividad en la dark web y uso de mixers. Compatible con Ethereum, Solana y Sui.',
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
    ariaLabel: 'Navegación del sitio Almstins',
    brandAriaLabel: 'Inicio de Almstins',
    tagline: 'Rastreador de portafolio cripto y herramienta de contabilidad',
    langLabel: '🇺🇸 In English',
    langHref: '/wallet-checker',
    langAriaLabel: 'View in English',
    login: 'Iniciar sesión',
    signup: 'Registrarse gratis',
  },
  hero: {
    eyebrow: 'Gratis · Sin cuenta · Resultados en segundos',
    title: 'Verificador de Estafas de Cripto',
    sub: '¿Te ofrecieron un trato que parece demasiado bueno para ser verdad? Antes de enviar un solo token, pega la dirección de la billetera aquí abajo. La verificaremos contra bases de datos públicas de estafas, detectores de honeypots y datos on-chain — al instante.',
  },
  cards: {
    site: {
      title: 'Conexión a sitio malicioso',
      cta: '¿Qué es esto? →',
      placeholder: 'Pega una URL o dominio…',
      button: 'Verificar sitio',
    },
    wallet: {
      title: 'Invertir en una estafa conocida',
      cta: '¿Qué es esto? →',
      placeholder: 'Pega una dirección de billetera…',
      button: 'Verificar billetera',
    },
    approval: {
      title: 'Robo por aprobación de tokens',
      cta: '¿Qué es esto? →',
      desc: 'Estas herramientas de la comunidad te muestran al instante qué contratos tienen acceso a tu cripto — y te permiten revocarlos.',
    },
  },
  modal: { close: 'Cerrar' },
  modals: {
    phishing: {
      title: 'Conectarse a un sitio malicioso',
      subtitle: 'Wallet drainers y dApps de phishing',
      p1: 'Los estafadores crean copias casi perfectas de dApps legítimas — mints falsos de NFTs, reclamaciones falsas de tokens, páginas falsas de airdrop. El sitio parece real. La URL es parecida pero ligeramente diferente (<code>blur-io.xyz</code> en lugar de <code>blur.io</code>). Cuando conectas tu MetaMask y firmas lo que parece una transacción rutinaria, en realidad estás otorgando permiso para vaciar todos los tokens de tu billetera en un solo movimiento.',
      example: '💸 <strong>Ejemplo real:</strong> En 2023, una página falsa de airdrop de Blur.io drenó más de <strong>$1.2 millones</strong> de titulares de NFTs en pocas horas tras su lanzamiento. La mayoría de las víctimas dijeron que "verificaron la URL dos veces" pero no vieron un solo carácter diferente.',
      p2: 'Estos sitios aparecen como enlaces en mensajes directos de Discord, respuestas en Twitter/X, grupos de Telegram e incluso anuncios pagados. El atacante paga por un anuncio de Google para aparecer encima del sitio real.',
      tip: '✅ <strong>Cómo te protege nuestro verificador de dApps:</strong> Pega la URL antes de conectarte. Consultamos 7 bases de datos de seguridad — incluyendo la propia lista de bloqueo de phishing de MetaMask y la base de datos de 345,000 dominios de ScamSniffer — y devolvemos un veredicto en segundos. <strong>Regla de oro: nunca hagas clic en un enlace de billetera enviado por mensaje directo.</strong>',
    },
    scam: {
      title: 'Invertir en una estafa conocida',
      subtitle: 'Pig butchering, honeypots y rug pulls',
      p1: 'Las estafas de <strong>pig butchering</strong> construyen confianza durante semanas o meses — un nuevo contacto en una app de citas o redes sociales te va presentando gradualmente una "gran oportunidad de inversión". La dirección de billetera que te envían a menudo ya ha sido reportada. Los <strong>tokens honeypot</strong> te permiten comprar pero te bloquean para vender — el contrato está programado para atrapar tus fondos mientras el desarrollador vacía el pool de liquidez.',
      example: '💸 <strong>Ejemplo real:</strong> El Centro de Quejas de Crímenes en Internet (IC3) del FBI reportó <strong>$3.3 mil millones</strong> en fraudes de inversión cripto solo en 2023 — la categoría de fraude de más rápido crecimiento. La mayoría de las víctimas nunca habían escuchado sobre el "pig butchering" antes de sufrirlo.',
      p2: 'Un rug pull parece un lanzamiento de token legítimo. Los desarrolladores generan hype del proyecto, entra liquidez, luego el equipo retira todo de la noche a la mañana y el token cae a cero.',
      tip: '✅ <strong>Cómo te protege nuestro verificador de billeteras:</strong> Antes de enviar fondos a cualquier billetera, pega la dirección aquí. La verificamos contra la lista negra global de estafas de GoPlus Security, buscamos patrones honeypot en los tokens asociados y señalamos el uso de mixers que indica lavado de dinero. Si alguien te presiona para enviar cripto rápidamente — eso es la estafa.',
    },
    approval: {
      title: 'Robo por aprobación de tokens',
      subtitle: 'Aprobaciones ilimitadas y vaciados silenciosos',
      p1: 'Cada vez que haces clic en "Aprobar" en un swap de tokens o un mint de NFT, firmas un mensaje de contrato inteligente que dice <em>"este contrato puede gastar mis tokens"</em>. La mayoría de las dApps usan <strong>aprobación ilimitada</strong> por defecto — pueden tomar todo tu saldo de ese token, en cualquier momento, para siempre, hasta que lo revoques explícitamente. Estos permisos persisten mucho después de que hayas olvidado que el sitio existió.',
      example: '💸 <strong>Ejemplo real:</strong> Cuando el puente Multichain fue explotado en 2023, los atacantes usaron <strong>aprobaciones antiguas</strong> que los usuarios habían otorgado meses antes para drenar <strong>$125 millones</strong>. Muchas víctimas no habían usado el puente en más de un año.',
      p2: 'Una dApp comprometida, un rug pull, o un exploit de día cero puede activar esas aprobaciones en el momento en que se lanza — sin necesidad de una segunda firma de tu parte.',
      tip: '✅ <strong>Cómo protegerte:</strong> Visita <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> para ver cada aprobación activa en tu billetera y revocar todo lo que no reconozcas. Siempre establece montos exactos en lugar de ilimitados cuando tu billetera te dé esa opción — y revoca después de cada interacción que hayas terminado.',
    },
  },
  tabs: {
    ariaLabel: 'Tipo de verificación',
    wallet: '🔍 Dirección de Billetera',
    dapp: '🌐 dApp / Sitio Web',
  },
  dappPanel: {
    placeholder: 'https://dapp-sospechosa.xyz  o simplemente pega el dominio',
    button: 'Verificar sitio',
    loading: 'Consultando 7 bases de datos de seguridad…',
  },
  cta: {
    ariaLabel: 'Acerca de Almstins',
    headline: '¿Quieres rastrear todo lo que tienes?',
    sub: 'Almstins conecta tus billeteras, posiciones DeFi y cuentas de exchanges en un solo lugar — y rastrea automáticamente tus ganancias de capital, tenencias y ganancias realizadas.',
    button: 'Comenzar gratis →',
  },
  signals: {
    title: 'Qué verificamos',
    walletSub: '🔍 Verificador de dirección de billetera',
    walletCards: [
      { icon: '🚨', label: 'Bases de datos de estafas conocidas', body: 'Cruzado contra la lista negra global de GoPlus Security de billeteras de estafa, phishing y vaciado reportadas.' },
      { icon: '🍯', label: 'Detección de honeypot',              body: 'Verifica si los tokens asociados con esta dirección realmente pueden venderse — o si están diseñados para atrapar tus fondos.' },
      { icon: '🌑', label: 'Actividad en la dark web',           body: 'Señala direcciones con conexiones conocidas a mercados de la dark web y patrones de transacciones ilícitas.' },
      { icon: '🔀', label: 'Mixer / Tornado Cash',               body: 'Detecta el uso de mixers cripto como Tornado Cash — una forma común que usan los estafadores para lavar fondos antes de un rug pull.' },
      { icon: '📅', label: 'Antigüedad de la billetera',         body: 'Las billeteras nuevas (< 30 días) son una gran señal de alerta. Los estafadores crean direcciones nuevas para cada operación.' },
      { icon: '💰', label: 'Tenencias de tokens',                body: 'Muestra lo que realmente hay en la billetera. Las billeteras de estafa suelen contener tokens sin valor diseñados para parecer valiosos.' },
      { icon: '⚖️', label: 'Verificación de sanciones',          body: 'Verifica contra las listas de sanciones de la OFAC e internacionales para direcciones involucradas en crímenes financieros.' },
      { icon: '🔑', label: 'Detección multi-sig',                body: 'Identifica si la dirección es un contrato multi-sig. Las inversiones legítimas nunca te piden depositar en los suyos.' },
    ],
    dappSub: '🌐 Verificador de dApp / sitio web',
    dappCards: [
      { icon: '🦊', label: 'Lista de bloqueo de MetaMask',  body: 'Verifica contra la propia lista eth-phishing-detect de MetaMask — más de 198,000 dominios de phishing cripto mantenidos por el equipo de seguridad de MetaMask.' },
      { icon: '🕵️', label: 'Base de datos de ScamSniffer', body: 'La lista de dominios de phishing web3 más grande disponible, con más de 345,000 sitios reportados. Actualizada diariamente por el equipo de seguridad de ScamSniffer.' },
      { icon: '🛡️', label: 'GoPlus Security',              body: 'Consulta en tiempo real contra la API de phishing web3 en vivo de GoPlus — el mismo motor usado por MetaMask, Trust Wallet y otras billeteras importantes.' },
      { icon: '🔬', label: 'URLScan.io',                    body: 'Busca escaneos previos de investigadores de seguridad del dominio para mostrar cualquier veredicto malicioso de la comunidad global de seguridad.' },
      { icon: '🎣', label: 'Feed de OpenPhish',             body: 'Cruza contra la lista activamente mantenida de OpenPhish de URLs de phishing en vivo actualizada en tiempo real.' },
      { icon: '🔍', label: 'Google Safe Browsing',          body: 'Cuando está configurado, consulta la base de datos de amenazas de Google — uno de los repositorios de URLs de phishing y malware más grandes del mundo.' },
      { icon: '🦠', label: 'VirusTotal',                    body: 'Cuando está configurado, verifica la URL contra más de 70 motores antivirus y de seguridad simultáneamente para un veredicto completo.' },
      { icon: '⚠️', label: 'Atribución, no veredicto',     body: 'Reportamos lo que dicen las bases de datos de terceros. No declaramos de forma independiente que un sitio sea una estafa. Verifica siempre antes de conectar tu billetera.' },
    ],
  },
  approvals: {
    title: '¿Está tu billetera conectada a algo que no debería?',
    intro: 'Cada vez que conectas MetaMask (o cualquier billetera) a una dApp y apruebas una transacción, le estás otorgando a ese contrato permiso para mover tokens en tu nombre — a veces sin límite de gasto y sin fecha de vencimiento. Estas aprobaciones permanecen activas incluso después de que dejas de usar el sitio. Una dApp comprometida o maliciosa puede vaciar tu billetera meses después usando un permiso que olvidaste que otorgaste.',
    whatTitle: '⚠️ Lo que una aprobación realmente significa',
    whatP1: 'Cuando haces clic en "Aprobar" en un swap de tokens o un mint de NFT, estás firmando una llamada a contrato inteligente que dice <em>"este contrato puede gastar X cantidad de mis tokens"</em>. Muchas dApps usan <strong>aprobación ilimitada</strong> por defecto — lo que significa que pueden tomar todo lo que tienes de ese token, en cualquier momento, para siempre, hasta que lo revoques.',
    whatP2: 'Si esa dApp es explotada después, hace un rug pull, o resulta haber sido maliciosa desde el principio, el atacante puede usar tu aprobación existente para vaciar tu billetera — sin necesidad de una segunda firma.',
    howTitle: '🔍 Cómo ver y revocar tus aprobaciones',
    howIntro: 'Estas herramientas gratuitas se conectan a tu billetera (solo lectura) y muestran cada aprobación activa en todas las cadenas — luego te permiten revocar las que no reconoces o ya no necesitas.',
    tools: [
      { badge: 'Más confiable', desc: 'El estándar de oro. Multi-cadena, muestra aprobaciones ilimitadas vs. limitadas, revocación con un clic. Sin cuenta necesaria.' },
      { desc: 'El verificador oficial de aprobaciones de Etherscan. Pega tu dirección para ver cada permiso abierto en Ethereum — sin necesidad de conectar tu billetera.' },
    ],
    tipsTitle: 'Mejores prácticas',
    tips: [
      { icon: '✂️', title: 'Revoca después de cada interacción',    body: 'Una vez que termines con una dApp, revoca su aprobación. No hay desventaja — puedes volver a aprobarla la próxima vez que la uses.' },
      { icon: '🔢', title: 'Establece montos exactos, no ilimitados', body: 'Al aprobar un swap, algunas billeteras te permiten establecer un monto personalizado. Aprueba siempre solo lo que necesites para esa transacción.' },
      { icon: '🗓️', title: 'Audita tus aprobaciones regularmente',   body: 'Haz una verificación en revoke.cash cada pocos meses — especialmente después de noticias de un exploit DeFi, ya que los atacantes a menudo apuntan a aprobaciones antiguas.' },
      { icon: '🦊', title: 'Lee lo que MetaMask realmente te pide',  body: 'Antes de hacer clic en Confirmar, expande los detalles de la transacción. Si dice "Ilimitado" junto a una cantidad de token — esa es una señal de alerta que vale la pena pausar.' },
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
    warmupHint: 'El servidor se está iniciando tras un período de inactividad. Espera un momento — los resultados están en camino…',
    warmupRetry: 'El servidor se está iniciando tras un período de inactividad — reintentando en un momento…',
    checkFailed: 'Error al verificar',
    tryAgain: 'Inténtalo de nuevo',
    verdictDanger: 'PELIGRO — No conectes tu billetera',
    verdictCaution: 'PRECAUCIÓN — No se puede confirmar que este sitio sea seguro',
    verdictSafe: 'PARECE SEGURO — No se detectaron amenazas',
    tipRed: '🛑 Una o más bases de datos de seguridad han reportado este sitio. No somos nosotros quienes hacemos esa determinación — verifica siempre de forma independiente. NO conectes tu billetera ni firmes transacciones hasta estar seguro.',
    tipYellow: '⚠️ Este sitio tiene historial de análisis limitado. Conecta tu billetera solo a sitios que encontraste tú mismo — nunca a través de un enlace en un mensaje directo o correo electrónico.',
    tipGreen: '✅ No se detectaron amenazas en todas las fuentes. Siempre verifica la URL en la barra de tu navegador antes de firmar cualquier transacción — incluso los sitios que parecen seguros pueden ser typosquatted.',
  },
};
