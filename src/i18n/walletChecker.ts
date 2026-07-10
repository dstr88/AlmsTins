export interface WalletCheckerLocale {
  lang: 'en' | 'es' | 'fr';
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
    loginCta: string;
    loginNote: string;
    orPaste: string;
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
  checker: {
    dateLocale: string;
    inputLabel: string;
    placeholder: string;
    scanQr: string;
    scanAria: string;
    checkWallet: string;
    checking: string;
    checkFailed: string;
    networkError: string;
    scanTitle: string;
    scanPrivacy: string;
    cancel: string;
    scanUnsupported: string;
    scanDenied: string;
    scanNoCamera: string;
    scanGeneric: string;
    chains: { evm: string; sui: string; solana: string; bitcoin: string; litecoin: string; tron: string; xrp: string; dogecoin: string; cardano: string; cosmos: string; unknown: string };
    chainNote: { evm: string; sui: string; solana: string; bitcoin: string; litecoin: string; tron: string; xrp: string; dogecoin: string; cardano: string; cosmos: string; unknown: string };
    ens: string;
    cached: string;
    reportBadgeOne: string;
    reportBadgeMany: string;
    flaggedFor: string;
    resultsDisclaimer: string;
    scamRiskScore: string;
    scamClean: string;
    scamCaution: string;
    scamHigh: string;
    scamLimited: string;
    limitedCoverageTitle: string;
    limitedCoverageBody: string;
    checksUnavailableTitle: string;
    checksRan: string;
    checksUnavailable: string;
    reported: string;
    clear: string;
    tabs: { safety: string; holdings: string; activity: string; honeypot: string; funding: string; multisig: string };
    identification: string;
    visit: string;
    flags: {
      blacklisted: string; phishing: string; sanctioned: string; stealing: string;
      honeypotRelated: string; cybercrime: string; darkweb: string; moneyLaundering: string;
      financialCrime: string; blackmail: string; mixer: string;
    };
    chainabuseOne: string;
    chainabuseMany: string;
    chainabuseNone: string;
    safetySource: string;
    holdingsEvmSuiOnly: string;
    noCoinBalances: string;
    noErc20: string;
    noTrc20: string;
    ethBalanceRow: string;
    trxBalanceRow: string;
    holdingsSourceSui: string;
    holdingsSourceEvm: string;
    holdingsSourceTron: string;
    firstSeen: string;
    lastActivity: string;
    suiBalance: string;
    ethBalance: string;
    txCount: string;
    newWallet: string;
    newWalletRest: string;
    activitySource: string;
    honeypotEvmOnly: string;
    honeypotUnavailable: string;
    honeypotDetected: string;
    honeypotSellable: string;
    honeypotExplain: string;
    honeypotSource: string;
    fundingNone: string;
    fundingExplain: string;
    fundingEvmOnly: string;
    multisigUnknown: string;
    multisigYes: string;
    multisigNo: string;
    multisigWhatLabel: string;
    multisigWhat: string;
    multisigWarning: string;
    multisigEvmOnly: string;
    verifiedTitle: string;
    verifiedBody: string;
    verifiedMerchant: string;
    verifiedVia: string;
    verifiedSub: string;
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
    title: 'Scan a QR before you trust it',
    sub: 'Point your camera at any payment or wallet QR and we\'ll check the address or link it contains against the major scam, phishing, and sanctions databases — before you send a thing. No wallet connection, ever.',
    loginCta: 'Log in or sign up',
    loginNote: 'Scanning is free — no account needed. Create a free account to save your checks.',
    orPaste: 'or paste an address or URL below',
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
      { q: 'What is the dApp / Website checker?', a: 'It\'s a free tool that takes any URL or domain and checks it against 7 independent security databases — MetaMask\'s own phishing blocklist, ScamSniffer, GoPlus, URLScan.io, OpenPhish, Google Safe Browsing, and VirusTotal. It returns a red, yellow, or green result based on what those databases report. We do not make our own determination — we surface what the security community has already flagged.' },
      { q: 'Do you store the wallet addresses or websites I check?', a: 'No — not in readable form. The checker needs no account and no wallet connection. To keep it fast, a repeated check of the same address or URL is served from a short-lived cache, but that cache is keyed to an irreversible one-way fingerprint of what you entered, not the address or URL itself. The usage counter records only that same fingerprint. There is no way to work backward from what we store to what you checked — consistent with our rule that Almstins never links an address to a person.' },
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
      { q: 'What happens if I send crypto to the wrong chain?', a: 'It depends on the mistake. Sending to an address on the wrong blockchain — ETH to a Bitcoin address, or BTC to a Solana address — means those funds are gone. The two networks have no way to communicate and no one can reverse an on-chain transaction. The most common version on EVM chains is sending on the wrong network: an Ethereum address and a Polygon address look identical (both start with 0x), so ETH sent to the right address on the wrong network is inaccessible unless you or the recipient can access the wallet on that other chain. Always confirm the chain before sending, not after.' },
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
  checker: {
    dateLocale: 'en-US',
    inputLabel: 'Wallet Address',
    placeholder: 'Paste any wallet address — Ethereum, Bitcoin, Solana, Litecoin, Sui...',
    scanQr: '📷 Scan QR',
    scanAria: 'Scan a QR code with your camera',
    checkWallet: '🔍 Check Wallet',
    checking: 'Checking…',
    checkFailed: 'Check failed. Please try again.',
    networkError: 'Network error. Please try again.',
    scanTitle: 'Point your camera at a wallet or payment QR code',
    scanPrivacy: 'The code is read on your device. Nothing is sent until you run the check.',
    cancel: 'Cancel',
    scanUnsupported: 'Camera isn’t available on this browser — paste the address instead.',
    scanDenied: 'Camera permission was denied. Allow camera access and try again.',
    scanNoCamera: 'No camera was found on this device.',
    scanGeneric: 'Couldn’t start the camera. The page must be served over HTTPS.',
    chains: { evm: 'Ethereum / EVM', sui: 'Sui', solana: 'Solana', bitcoin: 'Bitcoin', litecoin: 'Litecoin', tron: 'TRON', xrp: 'XRP', dogecoin: 'Dogecoin', cardano: 'Cardano', cosmos: 'Cosmos', unknown: 'Unknown chain' },
    chainNote: {
      evm:      'Valid on Ethereum, Polygon, Avalanche, and other EVM chains. Confirm you and the recipient are on the same network before sending.',
      sui:      'Sui address. Do not send ETH, BTC, SOL, or other non-Sui assets to this address.',
      solana:   'Solana address. Do not send ETH, BTC, or other non-Solana assets to this address.',
      bitcoin:  'Bitcoin address. Do not send ETH, SOL, or other non-Bitcoin assets to this address.',
      litecoin: 'Litecoin address. Do not send ETH, SOL, or other non-Litecoin assets to this address.',
      tron:     'TRON address. Do not send ETH, BTC, SOL, or other non-TRON assets to this address.',
      xrp:      'XRP address. No safety data yet — checks for EVM, Solana, Bitcoin, and Litecoin only.',
      dogecoin: 'Dogecoin address. No safety data yet — checks for EVM, Solana, Bitcoin, and Litecoin only.',
      cardano:  'Cardano address. No safety data yet — checks for EVM, Solana, Bitcoin, and Litecoin only.',
      cosmos:   'Cosmos address. No safety data yet — checks for EVM, Solana, Bitcoin, and Litecoin only.',
      unknown:  '',
    },
    ens: 'ENS',
    cached: '⚡ Cached',
    reportBadgeOne: '🚨 {n} community report',
    reportBadgeMany: '🚨 {n} community reports',
    flaggedFor: 'Flagged for:',
    resultsDisclaimer: 'Results sourced from public scam databases (GoPlus, Etherscan, honeypot.is). Reported, not legally confirmed. Not financial or legal advice.',
    scamRiskScore: 'Scam Risk Score',
    scamClean: '✅ No known risks detected',
    scamCaution: '⚠️ Exercise caution',
    scamHigh: '🚨 High risk — likely a scam',
    scamLimited: '⚠️ Limited check — not a clean bill',
    limitedCoverageTitle: 'Limited check for {chain}',
    limitedCoverageBody: 'We could not run the main scam databases for {chain}, so the absence of a flag here is not a clean bill of health. Verify the address independently before you send.',
    checksUnavailableTitle: 'Some checks were unavailable',
    checksRan: 'Checked',
    checksUnavailable: 'Unavailable',
    reported: '🚨 Reported',
    clear: '✅ Clear',
    tabs: { safety: '🛡 Safety Report', holdings: '💰 Holdings', activity: '📊 Activity', honeypot: '🍯 Honeypot', funding: '🔗 Funding', multisig: '🔑 Multi-sig' },
    identification: 'identification',
    visit: 'Visit ↗',
    flags: {
      blacklisted: 'Blacklisted address',
      phishing: 'Phishing activity',
      sanctioned: 'Sanctioned (OFAC/etc)',
      stealing: 'Stealing / drainer',
      honeypotRelated: 'Honeypot-related',
      cybercrime: 'Cybercrime involvement',
      darkweb: 'Dark web transactions',
      moneyLaundering: 'Money laundering',
      financialCrime: 'Financial crime',
      blackmail: 'Blackmail / extortion',
      mixer: 'Mixer / Tornado Cash use',
    },
    chainabuseOne: '🚨 {n} community scam report on Chainabuse',
    chainabuseMany: '🚨 {n} community scam reports on Chainabuse',
    chainabuseNone: '✅ No Chainabuse community reports',
    safetySource: 'Source: GoPlus Security (ETH, BSC, Polygon) + Chainabuse community reports. Results are reported, not legally confirmed.',
    holdingsEvmSuiOnly: 'Token balance lookup is only available for EVM, Sui, and TRON addresses.',
    noCoinBalances: 'No coin balances found.',
    noErc20: 'No ERC-20 token holdings found.',
    noTrc20: 'No TRC-20 token holdings found.',
    ethBalanceRow: 'ETH Balance',
    trxBalanceRow: 'TRX Balance',
    holdingsSourceSui: 'Data via Sui RPC · All coin balances shown · SUI price via CoinGecko',
    holdingsSourceEvm: 'Data via Alchemy · Ethereum Mainnet only · Top 10 tokens shown',
    holdingsSourceTron: 'Data via TronGrid · Top 20 TRC-20 tokens shown · TRX price via CoinGecko',
    firstSeen: 'First seen',
    lastActivity: 'Last activity',
    suiBalance: 'SUI balance',
    ethBalance: 'ETH balance',
    txCount: 'Tx count',
    newWallet: 'New wallet',
    newWalletRest: ' — created less than 30 days ago. Scam wallets are often brand new.',
    activitySource: 'Activity data via Etherscan · Ethereum Mainnet only',
    honeypotEvmOnly: 'Honeypot detection is only available for EVM addresses.',
    honeypotUnavailable: 'Honeypot check unavailable.',
    honeypotDetected: '🚨 Honeypot detected — tokens CANNOT be sold',
    honeypotSellable: '✅ Tokens appear sellable',
    honeypotExplain: 'A honeypot is a token that can be bought but never sold. Scammers use them to steal funds — you send ETH in, your tokens are locked, they keep the ETH.',
    honeypotSource: 'Source: honeypot.is',
    fundingNone: 'No mixer or high-risk funding source detected via GoPlus flags.',
    fundingExplain: 'Scammers often fund their wallets through mixers like Tornado Cash to hide where the ETH came from. Mixer use is a significant red flag even without other scam indicators.',
    fundingEvmOnly: 'Detailed funding source tracing only available for EVM addresses.',
    multisigUnknown: '— Multi-sig status unknown (EOA or check unavailable)',
    multisigYes: '⚠️ This is a multi-sig contract wallet',
    multisigNo: '✅ Standard EOA wallet — not a multi-sig',
    multisigWhatLabel: 'What is multi-sig?',
    multisigWhat: ' A multi-sig wallet requires multiple private keys to approve transactions. While legitimate protocols use them, scammers sometimes use multi-sig setups to create the illusion that funds are secure — while they control all the keys.',
    multisigWarning: '⚠️ Legitimate investments never ask you to deposit into their wallet. If someone is asking you to send tokens to any address — multi-sig or not — it is very likely a scam.',
    multisigEvmOnly: 'Multi-sig detection only available for EVM addresses.',
    verifiedTitle: 'Verified publisher',
    verifiedBody: '{domain} proved control of its domain and lists this as one of its own receiving addresses.',
    verifiedMerchant: 'A verified Almstins member registered this address as “{name}”.',
    verifiedVia: ' · verified via {domain}',
    verifiedSub: 'This confirms who published the address — not that any payment is safe. Still confirm the amount and that you meant to pay this business.',
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
    title: 'Escanea un QR antes de confiar',
    sub: 'Apunta tu cámara a cualquier QR de pago o de billetera y comprobaremos la dirección o el enlace que contiene en las principales bases de datos de estafas, phishing y sanciones — antes de que envíes nada. Sin conectar la billetera, nunca.',
    loginCta: 'Inicia sesión o regístrate',
    loginNote: 'Escanear es gratis — no necesitas cuenta. Crea una cuenta gratis para guardar tus comprobaciones.',
    orPaste: 'o pega una dirección o URL abajo',
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
      { q: '¿Qué es el verificador de dApp / sitio web?', a: 'Es una herramienta gratuita que toma cualquier URL o dominio y lo verifica contra 7 bases de datos de seguridad independientes — la propia lista de bloqueo de phishing de MetaMask, ScamSniffer, GoPlus, URLScan.io, OpenPhish, Google Safe Browsing y VirusTotal. Devuelve un resultado rojo, amarillo o verde según lo que reportan esas bases de datos. No hacemos nuestra propia determinación — mostramos lo que la comunidad de seguridad ya ha señalado.' },
      { q: '¿Almacenan las direcciones de billetera o los sitios web que verifico?', a: 'No — no en forma legible. El verificador no requiere cuenta ni conexión de billetera. Para mantenerlo rápido, una verificación repetida de la misma dirección o URL se sirve desde una caché de corta duración, pero esa caché se indexa mediante una huella unidireccional e irreversible de lo que ingresaste, no la dirección o URL en sí. El contador de uso registra solo esa misma huella. No hay forma de retroceder desde lo que almacenamos hasta lo que verificaste — coherente con nuestra regla de que Almstins nunca vincula una dirección a una persona.' },
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
      { q: '¿Qué pasa si envío criptomonedas a la cadena incorrecta?', a: 'Depende del error. Enviar a una dirección en una blockchain diferente — ETH a una dirección Bitcoin, o BTC a una dirección Solana — significa que esos fondos se pierden. Las dos redes no tienen forma de comunicarse y nadie puede revertir una transacción en cadena. La versión más común en cadenas EVM es enviar en la red incorrecta: una dirección Ethereum y una de Polygon son visualmente idénticas (ambas empiezan con 0x), por lo que el ETH enviado a la dirección correcta en la red incorrecta es inaccesible a menos que tú o el destinatario puedan acceder a la billetera en esa otra cadena. Siempre confirma la cadena antes de enviar, no después.' },
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
  checker: {
    dateLocale: 'es-ES',
    inputLabel: 'Dirección de billetera',
    placeholder: 'Pega cualquier dirección de billetera — Ethereum, Bitcoin, Solana, Litecoin, Sui...',
    scanQr: '📷 Escanear QR',
    scanAria: 'Escanear un código QR con tu cámara',
    checkWallet: '🔍 Verificar billetera',
    checking: 'Verificando…',
    checkFailed: 'La verificación falló. Inténtalo de nuevo.',
    networkError: 'Error de red. Inténtalo de nuevo.',
    scanTitle: 'Apunta tu cámara a un QR de billetera o de pago',
    scanPrivacy: 'El código se lee en tu dispositivo. No se envía nada hasta que ejecutes la verificación.',
    cancel: 'Cancelar',
    scanUnsupported: 'La cámara no está disponible en este navegador — pega la dirección en su lugar.',
    scanDenied: 'Se denegó el permiso de cámara. Permite el acceso a la cámara e inténtalo de nuevo.',
    scanNoCamera: 'No se encontró ninguna cámara en este dispositivo.',
    scanGeneric: 'No se pudo iniciar la cámara. La página debe servirse por HTTPS.',
    chains: { evm: 'Ethereum / EVM', sui: 'Sui', solana: 'Solana', bitcoin: 'Bitcoin', litecoin: 'Litecoin', tron: 'TRON', xrp: 'XRP', dogecoin: 'Dogecoin', cardano: 'Cardano', cosmos: 'Cosmos', unknown: 'Cadena desconocida' },
    chainNote: {
      evm:      'Válida en Ethereum, Polygon, Avalanche y otras cadenas EVM. Confirma que tú y el destinatario estén en la misma red antes de enviar.',
      sui:      'Dirección Sui. No envíes ETH, BTC, SOL ni otros activos no-Sui a esta dirección.',
      solana:   'Dirección Solana. No envíes ETH, BTC ni otros activos no-Solana a esta dirección.',
      bitcoin:  'Dirección Bitcoin. No envíes ETH, SOL ni otros activos no-Bitcoin a esta dirección.',
      litecoin: 'Dirección Litecoin. No envíes ETH, SOL ni otros activos no-Litecoin a esta dirección.',
      tron:     'Dirección TRON. No envíes ETH, BTC, SOL ni otros activos no-TRON a esta dirección.',
      xrp:      'Dirección XRP. Sin datos de seguridad aún — las verificaciones aplican solo a EVM, Solana, Bitcoin y Litecoin.',
      dogecoin: 'Dirección Dogecoin. Sin datos de seguridad aún — las verificaciones aplican solo a EVM, Solana, Bitcoin y Litecoin.',
      cardano:  'Dirección Cardano. Sin datos de seguridad aún — las verificaciones aplican solo a EVM, Solana, Bitcoin y Litecoin.',
      cosmos:   'Dirección Cosmos. Sin datos de seguridad aún — las verificaciones aplican solo a EVM, Solana, Bitcoin y Litecoin.',
      unknown:  '',
    },
    ens: 'ENS',
    cached: '⚡ En caché',
    reportBadgeOne: '🚨 {n} reporte de la comunidad',
    reportBadgeMany: '🚨 {n} reportes de la comunidad',
    flaggedFor: 'Señalado por:',
    resultsDisclaimer: 'Resultados obtenidos de bases de datos públicas de estafas (GoPlus, Etherscan, honeypot.is). Reportados, no confirmados legalmente. No es asesoramiento financiero ni legal.',
    scamRiskScore: 'Puntuación de riesgo de estafa',
    scamClean: '✅ No se detectaron riesgos conocidos',
    scamCaution: '⚠️ Procede con precaución',
    scamHigh: '🚨 Alto riesgo — probablemente una estafa',
    scamLimited: '⚠️ Comprobación limitada — no es garantía',
    limitedCoverageTitle: 'Comprobación limitada para {chain}',
    limitedCoverageBody: 'No pudimos consultar las principales bases de datos de fraude para {chain}, así que la ausencia de una alerta aquí no es una garantía de seguridad. Verifica la dirección de forma independiente antes de enviar.',
    checksUnavailableTitle: 'Algunas comprobaciones no estuvieron disponibles',
    checksRan: 'Comprobado',
    checksUnavailable: 'No disponible',
    reported: '🚨 Reportado',
    clear: '✅ Limpio',
    tabs: { safety: '🛡 Informe de seguridad', holdings: '💰 Tenencias', activity: '📊 Actividad', honeypot: '🍯 Honeypot', funding: '🔗 Financiación', multisig: '🔑 Multi-firma' },
    identification: 'identificación',
    visit: 'Visitar ↗',
    flags: {
      blacklisted: 'Dirección en lista negra',
      phishing: 'Actividad de phishing',
      sanctioned: 'Sancionado (OFAC/etc)',
      stealing: 'Robo / drainer',
      honeypotRelated: 'Relacionado con honeypot',
      cybercrime: 'Implicación en cibercrimen',
      darkweb: 'Transacciones en la dark web',
      moneyLaundering: 'Lavado de dinero',
      financialCrime: 'Delito financiero',
      blackmail: 'Chantaje / extorsión',
      mixer: 'Uso de mixer / Tornado Cash',
    },
    chainabuseOne: '🚨 {n} reporte de estafa de la comunidad en Chainabuse',
    chainabuseMany: '🚨 {n} reportes de estafa de la comunidad en Chainabuse',
    chainabuseNone: '✅ Sin reportes de la comunidad en Chainabuse',
    safetySource: 'Fuente: GoPlus Security (ETH, BSC, Polygon) + reportes de la comunidad de Chainabuse. Los resultados son reportados, no confirmados legalmente.',
    holdingsEvmSuiOnly: 'La consulta de saldo de tokens solo está disponible para direcciones EVM, Sui y TRON.',
    noCoinBalances: 'No se encontraron saldos de monedas.',
    noErc20: 'No se encontraron tenencias de tokens ERC-20.',
    noTrc20: 'No se encontraron tenencias de tokens TRC-20.',
    ethBalanceRow: 'Saldo de ETH',
    trxBalanceRow: 'Saldo de TRX',
    holdingsSourceSui: 'Datos vía Sui RPC · Se muestran todos los saldos de monedas · Precio de SUI vía CoinGecko',
    holdingsSourceEvm: 'Datos vía Alchemy · Solo Ethereum Mainnet · Se muestran los 10 tokens principales',
    holdingsSourceTron: 'Datos vía TronGrid · Se muestran los 20 principales tokens TRC-20 · Precio de TRX vía CoinGecko',
    firstSeen: 'Visto por primera vez',
    lastActivity: 'Última actividad',
    suiBalance: 'Saldo de SUI',
    ethBalance: 'Saldo de ETH',
    txCount: 'Nº de transacciones',
    newWallet: 'Billetera nueva',
    newWalletRest: ' — creada hace menos de 30 días. Las billeteras de estafa suelen ser totalmente nuevas.',
    activitySource: 'Datos de actividad vía Etherscan · Solo Ethereum Mainnet',
    honeypotEvmOnly: 'La detección de honeypot solo está disponible para direcciones EVM.',
    honeypotUnavailable: 'Verificación de honeypot no disponible.',
    honeypotDetected: '🚨 Honeypot detectado — los tokens NO se pueden vender',
    honeypotSellable: '✅ Los tokens parecen vendibles',
    honeypotExplain: 'Un honeypot es un token que se puede comprar pero nunca vender. Los estafadores los usan para robar fondos — envías ETH, tus tokens quedan bloqueados y ellos se quedan con el ETH.',
    honeypotSource: 'Fuente: honeypot.is',
    fundingNone: 'No se detectó ningún mixer ni fuente de financiación de alto riesgo mediante las señales de GoPlus.',
    fundingExplain: 'Los estafadores a menudo financian sus billeteras a través de mixers como Tornado Cash para ocultar de dónde vino el ETH. El uso de mixers es una señal de alerta importante incluso sin otros indicadores de estafa.',
    fundingEvmOnly: 'El rastreo detallado de la fuente de financiación solo está disponible para direcciones EVM.',
    multisigUnknown: '— Estado de multi-firma desconocido (EOA o verificación no disponible)',
    multisigYes: '⚠️ Esta es una billetera de contrato multi-firma',
    multisigNo: '✅ Billetera EOA estándar — no es multi-firma',
    multisigWhatLabel: '¿Qué es multi-firma?',
    multisigWhat: ' Una billetera multi-firma requiere varias claves privadas para aprobar transacciones. Aunque los protocolos legítimos las usan, los estafadores a veces usan configuraciones multi-firma para crear la ilusión de que los fondos están seguros — mientras ellos controlan todas las claves.',
    multisigWarning: '⚠️ Las inversiones legítimas nunca te piden depositar en su billetera. Si alguien te pide enviar tokens a cualquier dirección — multi-firma o no — es muy probable que sea una estafa.',
    multisigEvmOnly: 'La detección de multi-firma solo está disponible para direcciones EVM.',
    verifiedTitle: 'Comercio verificado',
    verifiedBody: '{domain} demostró el control de su dominio y figura esta como una de sus propias direcciones de cobro.',
    verifiedMerchant: 'Un miembro verificado de Almstins registró esta dirección como «{name}».',
    verifiedVia: ' · verificado vía {domain}',
    verifiedSub: 'Esto confirma quién publicó la dirección — no que un pago sea seguro. Confirma igualmente el importe y que querías pagar a este negocio.',
  },
};

export const fr: WalletCheckerLocale = {
  lang: 'fr',
  meta: {
    title: 'Vérificateur d’arnaques de portefeuille crypto — Cette adresse est-elle sûre ?',
    description: 'Collez n’importe quelle adresse de portefeuille Ethereum, Solana ou Sui pour vérifier instantanément les arnaques connues, le phishing, les honeypots, l’activité du dark web et l’usage de mixers. Gratuit, sans inscription.',
  },
  jsonld: {
    appName: 'Vérificateur d’arnaques de portefeuille crypto',
    appUrl: 'https://almstins.com/wallet-checker/fr',
    appDescription: 'Outil gratuit pour vérifier toute adresse de portefeuille crypto : arnaques connues, phishing, honeypots, activité du dark web et usage de mixers. Prend en charge Ethereum, Solana et Sui.',
    featureList: [
      'Détection d’adresses d’arnaque connues',
      'Identification des portefeuilles de phishing',
      'Détection de tokens honeypot',
      'Signalement des transactions du dark web',
      'Détection de mixers / Tornado Cash',
      'Identification des contrats multi-signatures',
      'Consultation du solde de tokens',
      'Âge du portefeuille et historique d’activité',
    ],
  },
  nav: {
    ariaLabel: 'Navigation du site Almstins',
    brandAriaLabel: 'Accueil Almstins',
    tagline: 'Suivi de portefeuille crypto et outil de comptabilité',
    langLabel: '🇬🇧 In English',
    langHref: '/wallet-checker',
    langAriaLabel: 'View in English',
    login: 'Se connecter',
    signup: 'Inscription gratuite',
  },
  hero: {
    eyebrow: 'Gratuit · Sans inscription · Résultats en quelques secondes',
    title: 'Scannez un QR avant de faire confiance',
    sub: 'Pointez votre caméra vers n’importe quel QR de paiement ou de portefeuille et nous vérifierons l’adresse ou le lien qu’il contient dans les principales bases de données d’arnaques, de phishing et de sanctions — avant que vous n’envoyiez quoi que ce soit. Aucune connexion de portefeuille, jamais.',
    loginCta: 'Connexion ou inscription',
    loginNote: 'Le scan est gratuit — aucun compte requis. Créez un compte gratuit pour enregistrer vos vérifications.',
    orPaste: 'ou collez une adresse ou une URL ci-dessous',
  },
  cards: {
    site: {
      title: 'Collez votre URL ici',
      cta: 'Qu’est-ce que c’est ? →',
      placeholder: 'Collez une URL ou un domaine…',
      button: 'Vérifier le site',
    },
    wallet: {
      title: 'Collez une adresse de portefeuille',
      cta: 'Qu’est-ce que c’est ? →',
      placeholder: 'Collez une adresse de portefeuille…',
      button: 'Vérifier le portefeuille',
    },
    approval: {
      title: 'Vol par approbation de tokens',
      cta: 'Qu’est-ce que c’est ? →',
      desc: 'Ces outils communautaires vous montrent instantanément quels contrats ont mis la main sur votre crypto — et vous permettent de les révoquer.',
    },
  },
  modal: { close: 'Fermer' },
  modals: {
    phishing: {
      title: 'Se connecter à un site malveillant',
      subtitle: 'Drainers de portefeuille et dApps de phishing',
      p1: 'Les arnaqueurs créent des copies quasi parfaites de dApps légitimes — faux mints de NFT, fausses réclamations de tokens, fausses pages d’airdrop. Le site semble réel. L’URL est proche mais légèrement différente (<code>blur-io.xyz</code> au lieu de <code>blur.io</code>). Quand vous connectez votre MetaMask et signez ce qui ressemble à une transaction de routine, vous accordez en réalité la permission de vider tous les tokens de votre portefeuille en une seule fois.',
      example: '💸 <strong>Exemple réel :</strong> en 2023, une fausse page d’airdrop Blur.io a vidé plus de <strong>1,2 million de dollars</strong> aux détenteurs de NFT en quelques heures après son lancement. La plupart des victimes affirmaient avoir « bien vérifié l’URL » mais avaient raté un seul caractère.',
      p2: 'Ces sites apparaissent sous forme de liens dans les DM Discord, les réponses Twitter/X, les groupes Telegram et même les publicités payantes. L’attaquant paie une annonce Google pour apparaître au-dessus du vrai site.',
      tip: '✅ <strong>Comment notre vérificateur de dApp vous protège :</strong> collez l’URL avant de vous connecter. Nous interrogeons 7 bases de données de sécurité — dont la liste de blocage anti-phishing de MetaMask et la base de 345 000 domaines de ScamSniffer — et renvoyons un verdict en quelques secondes. <strong>Règle d’or : ne cliquez jamais sur un lien de portefeuille envoyé en DM.</strong>',
    },
    scam: {
      title: 'Investir dans une arnaque connue',
      subtitle: 'Pig butchering, honeypots et rug pulls',
      p1: 'Les arnaques de <strong>pig-butchering</strong> bâtissent la confiance sur des semaines ou des mois — un nouveau contact sur une appli de rencontre ou un réseau social vous présente peu à peu une « excellente opportunité d’investissement ». L’adresse de portefeuille qu’ils envoient a souvent déjà été signalée. Les <strong>tokens honeypot</strong> vous laissent acheter mais vous empêchent de vendre — le contrat est codé pour piéger vos fonds pendant que le développeur vide le pool de liquidité.',
      example: '💸 <strong>Exemple réel :</strong> le Centre de plaintes contre la criminalité sur Internet (IC3) du FBI a signalé <strong>3,3 milliards de dollars</strong> de fraude à l’investissement crypto rien qu’en 2023 — la catégorie de fraude qui croît le plus vite. La plupart des victimes n’avaient jamais entendu parler du « pig butchering » avant d’en être victimes.',
      p2: 'Un rug pull ressemble au lancement d’un token légitime. Les développeurs font le buzz autour du projet, la liquidité afflue, puis l’équipe retire tout du jour au lendemain et le token tombe à zéro.',
      tip: '✅ <strong>Comment notre vérificateur de portefeuille vous protège :</strong> avant d’envoyer des fonds à un portefeuille, collez l’adresse ici. Nous la comparons à la liste noire mondiale d’arnaques de GoPlus Security, recherchons des schémas de honeypot dans les tokens associés et signalons l’usage de mixers révélateur de blanchiment. Si quelqu’un vous presse d’envoyer de la crypto rapidement — c’est l’arnaque.',
    },
    approval: {
      title: 'Vol par approbation de tokens',
      subtitle: 'Approbations illimitées et drains silencieux',
      p1: 'Chaque fois que vous cliquez sur « Approuver » lors d’un échange de tokens ou d’un mint de NFT, vous signez un message de contrat intelligent qui dit <em>« ce contrat peut dépenser mes tokens »</em>. La plupart des dApps utilisent par défaut une <strong>approbation illimitée</strong> — elles peuvent prendre la totalité de votre solde de ce token, à tout moment, pour toujours, jusqu’à ce que vous la révoquiez explicitement. Ces permissions survivent longtemps après que vous avez oublié l’existence du site.',
      example: '💸 <strong>Exemple réel :</strong> lors de l’exploitation du pont Multichain en 2023, les attaquants ont utilisé d’<strong>anciennes approbations</strong> accordées par les utilisateurs des mois plus tôt pour dérober <strong>125 millions de dollars</strong>. Beaucoup de victimes n’avaient pas utilisé le pont depuis plus d’un an.',
      p2: 'Une dApp compromise, un rug pull ou une faille zero-day peut déclencher ces approbations dès son lancement — sans aucune signature supplémentaire de votre part.',
      tip: '✅ <strong>Comment vous protéger :</strong> rendez-vous sur <a href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="color:#a5b4fc">revoke.cash</a> pour voir toutes les approbations actives de votre portefeuille et révoquer celles que vous ne reconnaissez pas. Définissez toujours des montants exacts plutôt qu’illimités quand votre portefeuille vous en laisse le choix — et révoquez après chaque interaction terminée.',
    },
  },
  tabs: {
    ariaLabel: 'Type de vérification',
    wallet: '🔍 Adresse de portefeuille',
    dapp: '🌐 dApp / Site web',
  },
  dappPanel: {
    placeholder: 'https://dapp-suspecte.xyz  ou collez simplement le domaine',
    button: 'Vérifier le site',
    loading: 'Vérification des bases de données de sécurité…',
  },
  cta: {
    ariaLabel: 'À propos d’Almstins',
    headline: 'Vous voulez suivre tout ce que vous possédez ?',
    sub: 'Almstins réunit vos portefeuilles, positions DeFi et comptes d’échange au même endroit — et suit automatiquement vos plus-values, vos avoirs et vos gains réalisés.',
    button: 'Commencer gratuitement →',
  },
  signals: {
    title: 'Ce que nous vérifions',
    walletSub: '🔍 Vérificateur d’adresse de portefeuille',
    walletCards: [
      { icon: '🚨', label: 'Bases de données d’arnaques connues', body: 'Comparé à la liste noire mondiale de GoPlus Security des portefeuilles signalés pour arnaque, phishing et drain.' },
      { icon: '🍯', label: 'Détection de honeypot', body: 'Vérifie si les tokens associés à cette adresse peuvent réellement être vendus — ou s’ils sont conçus pour piéger vos fonds.' },
      { icon: '🌑', label: 'Activité du dark web', body: 'Signale les adresses ayant des liens connus avec des marchés du dark web et des schémas de transactions illicites.' },
      { icon: '🔀', label: 'Mixer / Tornado Cash', body: 'Détecte l’usage de mixers crypto comme Tornado Cash — un moyen courant pour les arnaqueurs de blanchir des fonds avant un rug pull.' },
      { icon: '📅', label: 'Âge du portefeuille', body: 'Les nouveaux portefeuilles (< 30 jours) sont un signal d’alerte majeur. Les arnaqueurs créent de nouvelles adresses pour chaque opération.' },
      { icon: '💰', label: 'Avoirs en tokens', body: 'Montre ce qui se trouve réellement dans le portefeuille. Les portefeuilles d’arnaque contiennent souvent des tokens sans valeur conçus pour paraître précieux.' },
      { icon: '⚖️', label: 'Vérification des sanctions', body: 'Vérifie les listes de sanctions de l’OFAC et internationales pour les adresses impliquées dans la criminalité financière.' },
      { icon: '🔑', label: 'Détection multi-signature', body: 'Identifie si l’adresse est un contrat multi-signature. Les investissements légitimes ne vous demandent jamais de déposer dans le leur.' },
    ],
    dappSub: '🌐 Vérificateur de dApp / site web',
    dappCards: [
      { icon: '🦊', label: 'Liste de blocage MetaMask', body: 'Comparé à la liste eth-phishing-detect de MetaMask — plus de 198 000 domaines de phishing crypto maintenus par l’équipe de sécurité de MetaMask.' },
      { icon: '🕵️', label: 'Base de données ScamSniffer', body: 'La plus grande liste de domaines de phishing web3 disponible, avec plus de 345 000 sites signalés. Mise à jour quotidiennement par l’équipe de sécurité ScamSniffer.' },
      { icon: '🛡️', label: 'GoPlus Security', body: 'Consultation en temps réel via l’API de phishing web3 en direct de GoPlus — le même moteur utilisé par MetaMask, Trust Wallet et d’autres grands portefeuilles.' },
      { icon: '🔬', label: 'URLScan.io', body: 'Recherche les analyses antérieures de chercheurs en sécurité sur le domaine pour faire remonter tout verdict malveillant de la communauté mondiale de la sécurité.' },
      { icon: '🎣', label: 'Flux OpenPhish', body: 'Comparé à la liste activement maintenue d’URL de phishing en direct d’OpenPhish, mise à jour en temps réel.' },
      { icon: '🔍', label: 'Google Safe Browsing', body: 'Lorsqu’il est configuré, interroge la base de menaces de Google — l’un des plus grands référentiels d’URL de phishing et de malwares au monde.' },
      { icon: '🦠', label: 'VirusTotal', body: 'Lorsqu’il est configuré, vérifie l’URL auprès de plus de 70 moteurs antivirus et de sécurité simultanément pour un verdict complet.' },
      { icon: '⚠️', label: 'Attribution, pas verdict', body: 'Nous rapportons ce que disent les bases de données tierces. Nous ne déclarons jamais nous-mêmes qu’un site est une arnaque. Vérifiez toujours avant de connecter votre portefeuille.' },
    ],
  },
  approvals: {
    title: 'Votre portefeuille est-il connecté à quelque chose qu’il ne devrait pas ?',
    intro: 'Chaque fois que vous connectez MetaMask (ou tout portefeuille) à une dApp et approuvez une transaction, vous accordez à ce contrat la permission de déplacer des tokens en votre nom — parfois sans limite de dépense ni date d’expiration. Ces approbations restent actives même après que vous avez cessé d’utiliser le site. Une dApp compromise ou malveillante peut vider votre portefeuille des mois plus tard grâce à une permission que vous avez oubliée.',
    whatTitle: '⚠️ Ce que signifie réellement une approbation',
    whatP1: 'Quand vous cliquez sur « Approuver » lors d’un échange de tokens ou d’un mint de NFT, vous signez un appel de contrat intelligent qui dit <em>« ce contrat peut dépenser X tokens m’appartenant »</em>. De nombreuses dApps utilisent par défaut une <strong>approbation illimitée</strong> — ce qui signifie qu’elles peuvent prendre tout ce que vous possédez de ce token, à tout moment, pour toujours, jusqu’à ce que vous la révoquiez.',
    whatP2: 'Si cette dApp est ensuite exploitée, victime d’un rug pull, ou se révèle malveillante depuis le début, l’attaquant peut utiliser votre approbation existante pour vider votre portefeuille — sans seconde signature.',
    howTitle: '🔍 Comment voir et révoquer vos approbations',
    howIntro: 'Ces outils gratuits se connectent à votre portefeuille (en lecture seule) et affichent toutes les approbations actives sur toutes les chaînes — puis vous permettent de révoquer celles que vous ne reconnaissez pas ou dont vous n’avez plus besoin.',
    tools: [
      { badge: 'Le plus fiable', desc: 'La référence. Multi-chaîne, distingue les approbations illimitées et limitées, révocation en un clic. Aucun compte requis.' },
      { desc: 'Le vérificateur d’approbations officiel d’Etherscan. Collez votre adresse pour voir toutes les permissions ouvertes sur Ethereum — sans connexion de portefeuille.' },
    ],
    tipsTitle: 'Bonnes pratiques',
    tips: [
      { icon: '✂️', title: 'Révoquez après chaque interaction', body: 'Une fois que vous en avez fini avec une dApp, révoquez son approbation. Aucun inconvénient — vous pourrez la réapprouver la prochaine fois.' },
      { icon: '🔢', title: 'Définissez des montants exacts, pas illimités', body: 'Lors de l’approbation d’un échange, certains portefeuilles permettent de définir un montant personnalisé. N’approuvez que ce dont vous avez besoin pour cette transaction.' },
      { icon: '🗓️', title: 'Auditez vos approbations régulièrement', body: 'Lancez une vérification revoke.cash tous les quelques mois — surtout après toute annonce d’exploitation DeFi, car les attaquants ciblent souvent les anciennes approbations.' },
      { icon: '🦊', title: 'Lisez ce que MetaMask demande réellement', body: 'Avant de cliquer sur Confirmer, dépliez les détails de la transaction. S’il est indiqué « Illimité » à côté d’un montant de token — c’est un signal d’alerte qui mérite une pause.' },
    ],
  },
  faq: {
    title: 'Questions fréquentes et schémas d’arnaque',
    items: [
      { q: 'Qu’est-ce que le vérificateur de dApp / site web ?', a: 'C’est un outil gratuit qui prend n’importe quelle URL ou domaine et le vérifie auprès de 7 bases de données de sécurité indépendantes — la liste de blocage anti-phishing de MetaMask, ScamSniffer, GoPlus, URLScan.io, OpenPhish, Google Safe Browsing et VirusTotal. Il renvoie un résultat rouge, jaune ou vert selon ce que rapportent ces bases. Nous ne portons pas notre propre jugement — nous faisons remonter ce que la communauté de la sécurité a déjà signalé.' },
      { q: 'Conservez-vous les adresses de portefeuille ou les sites web que je vérifie ?', a: 'Non — pas sous une forme lisible. Le vérificateur ne demande aucun compte ni connexion de portefeuille. Pour rester rapide, une vérification répétée de la même adresse ou URL est servie depuis un cache de courte durée, mais ce cache est indexé par une empreinte unidirectionnelle et irréversible de ce que vous avez saisi, et non l’adresse ou l’URL elle-même. Le compteur d’utilisation n’enregistre que cette même empreinte. Il n’existe aucun moyen de remonter de ce que nous stockons vers ce que vous avez vérifié — conforme à notre règle selon laquelle Almstins ne relie jamais une adresse à une personne.' },
      { q: 'Que signifie un résultat rouge pour un site web ?', a: 'Cela signifie qu’une ou plusieurs des bases de données que nous interrogeons ont signalé ce domaine. Cela ne veut pas dire que nous le qualifions d’arnaque — ce jugement vient de la base de données tierce. Traitez un résultat rouge comme un avertissement sérieux, faites vos propres recherches supplémentaires et ne connectez pas votre portefeuille tant que vous n’êtes pas certain que le site est légitime.' },
      { q: 'Que signifie un résultat jaune ?', a: 'Le jaune signifie que le site n’est dans aucune liste de blocage, mais qu’il a peu ou pas d’historique d’analyse de sécurité — il n’y a donc pas assez de données pour lui donner un feu vert. Les sites récents, les domaines obscurs ou les adresses récemment enregistrées affichent souvent du jaune. Procédez avec prudence et vérifiez le site par des canaux officiels avant de vous connecter.' },
      { q: 'Puis-je faire confiance à un site juste parce qu’il est vert ?', a: 'Non. Un résultat vert signifie que le site n’a été signalé à aucune des bases que nous vérifions — pas qu’il est définitivement sûr. Les sites de phishing tout neufs disposent de quelques heures avant d’être ajoutés aux listes de blocage. Vérifiez toujours l’URL exacte dans la barre de votre navigateur, cherchez les comptes officiels sur les réseaux sociaux, et ne connectez jamais un portefeuille à partir d’un lien envoyé en DM ou par e-mail.' },
      { q: 'Comment fonctionnent les sites drainers de portefeuille ?', a: 'Un drainer de portefeuille est un site web qui imite une dApp légitime — un faux mint de NFT, une fausse réclamation de token ou un faux airdrop. Quand vous connectez votre MetaMask et signez une transaction, vous signez en réalité une permission qui permet à l’attaquant de transférer tous les tokens hors de votre portefeuille en une seule fois. La totalité du solde peut disparaître en quelques secondes. Le site disparaît souvent en quelques heures.' },
      { q: 'Qu’est-ce qu’une arnaque honeypot ?', a: 'Un honeypot est un token que vous pouvez acheter mais jamais vendre. L’arnaqueur en fait la promotion, vous achetez, le prix semble monter — mais quand vous essayez de vendre, le contrat vous bloque. L’arnaqueur vide alors la liquidité et disparaît avec votre ETH.' },
      { q: 'À quoi ressemble vraiment le « trop beau pour être vrai » en crypto ?', a: 'Des rendements quotidiens garantis de 1 à 10 %, « stakez simplement vos tokens dans notre portefeuille », des réclamations d’airdrop qui exigent d’envoyer des tokens d’abord, ou quelqu’un en DM proposant de doubler votre crypto. Si le rendement semble impossible dans la finance traditionnelle, c’est une arnaque en crypto.' },
      { q: 'Pourquoi un portefeuille utiliserait-il Tornado Cash ?', a: 'Tornado Cash est un mixer qui rompt le lien on-chain entre les adresses de portefeuille. Si certains utilisateurs tiennent à leur vie privée, il est largement utilisé par les arnaqueurs et les hackers pour cacher l’origine de fonds volés avant de les retirer.' },
      { q: 'Dois-je faire confiance à un portefeuille juste parce qu’il a un gros solde ?', a: 'Non. Les arnaqueurs garnissent souvent les portefeuilles de tokens sans valeur ou de soldes « sur le papier » gonflés pour donner une apparence de légitimité. Vérifiez toujours si ces tokens peuvent réellement être vendus et ce qu’ils valent vraiment.' },
      { q: "Un nouveau portefeuille est-il toujours suspect ?", a: "Pas toujours — mais dans le contexte de quelqu’un qui propose un investissement, un portefeuille créé au cours des 30 derniers jours est un signal d’alerte majeur. Les protocoles et entreprises légitimes ont un historique on-chain établi." },
      { q: "Que dois-je faire si cet outil signale une adresse de portefeuille ?", a: "N’envoyez pas de fonds. Faites une capture d’écran des résultats. Si quelqu’un vous presse d’envoyer de la crypto à une adresse signalée, cette pression fait elle-même partie de l’arnaque. Signalez l’adresse sur chainabuse.com et partez." },
      { q: "Que dois-je faire si le vérificateur de dApp signale un site web ?", a: "Ne connectez pas votre portefeuille. Fermez l’onglet. Trouvez le projet officiel via une source fiable — son compte Twitter/X vérifié ou un agrégateur reconnu comme DeFiLlama ou CoinGecko. Signalez le site à la base de phishing de MetaMask sur github.com/MetaMask/eth-phishing-detect." },
      { q: "Que se passe-t-il si j’envoie des cryptos vers la mauvaise chaîne ?", a: "Cela dépend de l’erreur. Envoyer vers une adresse sur la mauvaise blockchain — de l’ETH vers une adresse Bitcoin, ou du BTC vers une adresse Solana — signifie que ces fonds sont perdus. Les deux réseaux ne peuvent pas communiquer et personne ne peut annuler une transaction en chaîne. La version la plus courante sur les chaînes EVM est d’envoyer sur le mauvais réseau : une adresse Ethereum et une adresse Polygon sont visuellement identiques (toutes deux commencent par 0x), donc de l’ETH envoyé à la bonne adresse sur le mauvais réseau est inaccessible, sauf si vous ou le destinataire pouvez accéder au portefeuille sur cette autre chaîne. Confirmez toujours la chaîne avant d’envoyer, pas après." },
    ],
  },
  disclaimer: {
    text: "Les résultats de vérification de portefeuille proviennent de bases de données publiques dont GoPlus Security, Etherscan, Alchemy et honeypot.is. Les résultats dApp / site web proviennent de MetaMask eth-phishing-detect, ScamSniffer, GoPlus Security, URLScan.io et OpenPhish. Tous les constats sont rapportés depuis des bases de données tierces et ne sont pas vérifiés indépendamment par Almstins. Cet outil ne constitue pas un conseil financier ou juridique. Faites toujours vos propres recherches.",
    link: "Un outil gratuit d’Almstins — suivi de portefeuille crypto et outil de comptabilité.",
  },
  js: {
    warmupHint: "Le serveur se réveille après une période d’inactivité. Patientez — les résultats arrivent…",
    warmupRetry: "Le serveur se réveille après une période d’inactivité — nouvelle tentative dans un instant…",
    checkFailed: "Échec de la vérification",
    tryAgain: "Réessayer",
    verdictDanger: "DANGER — Ne connectez pas votre portefeuille",
    verdictCaution: "PRUDENCE — Impossible de confirmer que ce site est sûr",
    verdictSafe: "SEMBLE SÛR — Aucune menace détectée",
    tipRed: "🛑 Une ou plusieurs bases de données de sécurité ont signalé ce site. Ce n’est pas nous qui portons ce jugement — vérifiez toujours de façon indépendante. NE connectez PAS votre portefeuille et ne signez aucune transaction tant que vous n’êtes pas certain.",
    tipYellow: "⚠️ Ce site a un historique d’analyse limité. Ne connectez votre portefeuille qu’à des sites que vous avez trouvés vous-même — jamais via un lien en DM ou par e-mail.",
    tipGreen: "✅ Aucune menace détectée sur l’ensemble des sources. Vérifiez toujours l’URL dans la barre de votre navigateur avant de signer une transaction — même les sites d’apparence sûre peuvent être victimes de typosquatting.",
  },
  checker: {
    dateLocale: "fr-FR",
    inputLabel: "Adresse de portefeuille",
    placeholder: "Collez n’importe quelle adresse de portefeuille — Ethereum, Bitcoin, Solana, Litecoin, Sui...",
    scanQr: "📷 Scanner un QR",
    scanAria: "Scanner un code QR avec votre caméra",
    checkWallet: "🔍 Vérifier le portefeuille",
    checking: "Vérification…",
    checkFailed: "La vérification a échoué. Veuillez réessayer.",
    networkError: "Erreur réseau. Veuillez réessayer.",
    scanTitle: "Pointez votre caméra vers un QR de portefeuille ou de paiement",
    scanPrivacy: "Le code est lu sur votre appareil. Rien n’est envoyé tant que vous ne lancez pas la vérification.",
    cancel: "Annuler",
    scanUnsupported: "La caméra n’est pas disponible sur ce navigateur — collez plutôt l’adresse.",
    scanDenied: "L’autorisation de la caméra a été refusée. Autorisez l’accès à la caméra et réessayez.",
    scanNoCamera: "Aucune caméra n’a été trouvée sur cet appareil.",
    scanGeneric: "Impossible de démarrer la caméra. La page doit être servie en HTTPS.",
    chains: { evm: "Ethereum / EVM", sui: "Sui", solana: "Solana", bitcoin: "Bitcoin", litecoin: "Litecoin", tron: "TRON", xrp: "XRP", dogecoin: "Dogecoin", cardano: "Cardano", cosmos: "Cosmos", unknown: "Chaîne inconnue" },
    chainNote: {
      evm:      "Valide sur Ethereum, Polygon, Avalanche et autres chaînes EVM. Confirmez que vous et le destinataire êtes sur le même réseau avant d’envoyer.",
      sui:      "Adresse Sui. N’envoyez pas d’ETH, BTC, SOL ou autres actifs non-Sui à cette adresse.",
      solana:   "Adresse Solana. N’envoyez pas d’ETH, BTC ou autres actifs non-Solana à cette adresse.",
      bitcoin:  "Adresse Bitcoin. N’envoyez pas d’ETH, SOL ou autres actifs non-Bitcoin à cette adresse.",
      litecoin: "Adresse Litecoin. N’envoyez pas d’ETH, SOL ou autres actifs non-Litecoin à cette adresse.",
      tron:     "Adresse TRON. N'envoyez pas d'ETH, BTC, SOL ou autres actifs non-TRON à cette adresse.",
      xrp:      "Adresse XRP. Pas encore de données de sécurité — les vérifications couvrent EVM, Solana, Bitcoin et Litecoin uniquement.",
      dogecoin: "Adresse Dogecoin. Pas encore de données de sécurité — les vérifications couvrent EVM, Solana, Bitcoin et Litecoin uniquement.",
      cardano:  "Adresse Cardano. Pas encore de données de sécurité — les vérifications couvrent EVM, Solana, Bitcoin et Litecoin uniquement.",
      cosmos:   "Adresse Cosmos. Pas encore de données de sécurité — les vérifications couvrent EVM, Solana, Bitcoin et Litecoin uniquement.",
      unknown:  "",
    },
    ens: "ENS",
    cached: "⚡ En cache",
    reportBadgeOne: "🚨 {n} signalement de la communauté",
    reportBadgeMany: "🚨 {n} signalements de la communauté",
    flaggedFor: "Signalé pour :",
    resultsDisclaimer: "Résultats issus de bases de données publiques d’arnaques (GoPlus, Etherscan, honeypot.is). Rapportés, non confirmés légalement. Ni conseil financier ni juridique.",
    scamRiskScore: "Score de risque d’arnaque",
    scamClean: "✅ Aucun risque connu détecté",
    scamCaution: "⚠️ Faites preuve de prudence",
    scamHigh: "🚨 Risque élevé — probablement une arnaque",
    scamLimited: "⚠️ Vérification limitée — pas une garantie",
    limitedCoverageTitle: "Vérification limitée pour {chain}",
    limitedCoverageBody: "Nous n’avons pas pu interroger les principales bases de données d’arnaques pour {chain} ; l’absence de signalement ici n’est donc pas un gage de sécurité. Vérifiez l’adresse de manière indépendante avant d’envoyer.",
    checksUnavailableTitle: "Certaines vérifications étaient indisponibles",
    checksRan: "Vérifié",
    checksUnavailable: "Indisponible",
    reported: "🚨 Signalé",
    clear: "✅ Clean",
    tabs: { safety: "🛡 Rapport de sécurité", holdings: "💰 Avoirs", activity: "📊 Activité", honeypot: "🍯 Honeypot", funding: "🔗 Financement", multisig: "🔑 Multi-signature" },
    identification: "identification",
    visit: "Visiter ↗",
    flags: {
      blacklisted: "Adresse sur liste noire",
      phishing: "Activité de phishing",
      sanctioned: "Sous sanctions (OFAC/etc)",
      stealing: "Vol / drainer",
      honeypotRelated: "Lié à un honeypot",
      cybercrime: "Implication dans la cybercriminalité",
      darkweb: "Transactions sur le dark web",
      moneyLaundering: "Blanchiment d’argent",
      financialCrime: "Criminalité financière",
      blackmail: "Chantage / extorsion",
      mixer: "Usage de mixer / Tornado Cash",
    },
    chainabuseOne: "🚨 {n} signalement d’arnaque de la communauté sur Chainabuse",
    chainabuseMany: "🚨 {n} signalements d’arnaque de la communauté sur Chainabuse",
    chainabuseNone: "✅ Aucun signalement de la communauté sur Chainabuse",
    safetySource: "Source : GoPlus Security (ETH, BSC, Polygon) + signalements de la communauté Chainabuse. Les résultats sont rapportés, non confirmés légalement.",
    holdingsEvmSuiOnly: "La consultation du solde de tokens n’est disponible que pour les adresses EVM, Sui et TRON.",
    noCoinBalances: "Aucun solde de pièce trouvé.",
    noErc20: "Aucun avoir en tokens ERC-20 trouvé.",
    noTrc20: "Aucun avoir en tokens TRC-20 trouvé.",
    ethBalanceRow: "Solde ETH",
    trxBalanceRow: "Solde TRX",
    holdingsSourceSui: "Données via Sui RPC · Tous les soldes de pièces affichés · Prix du SUI via CoinGecko",
    holdingsSourceEvm: "Données via Alchemy · Ethereum Mainnet uniquement · 10 principaux tokens affichés",
    holdingsSourceTron: "Données via TronGrid · 20 principaux tokens TRC-20 affichés · Prix du TRX via CoinGecko",
    firstSeen: "Première apparition",
    lastActivity: "Dernière activité",
    suiBalance: "Solde SUI",
    ethBalance: "Solde ETH",
    txCount: "Nb de transactions",
    newWallet: "Nouveau portefeuille",
    newWalletRest: " — créé il y a moins de 30 jours. Les portefeuilles d’arnaque sont souvent tout neufs.",
    activitySource: "Données d’activité via Etherscan · Ethereum Mainnet uniquement",
    honeypotEvmOnly: "La détection de honeypot n’est disponible que pour les adresses EVM.",
    honeypotUnavailable: "Vérification de honeypot indisponible.",
    honeypotDetected: "🚨 Honeypot détecté — les tokens NE PEUVENT PAS être vendus",
    honeypotSellable: "✅ Les tokens semblent vendables",
    honeypotExplain: "Un honeypot est un token que l’on peut acheter mais jamais vendre. Les arnaqueurs s’en servent pour voler des fonds — vous envoyez de l’ETH, vos tokens sont bloqués, ils gardent l’ETH.",
    honeypotSource: "Source : honeypot.is",
    fundingNone: "Aucun mixer ni source de financement à haut risque détecté via les signaux de GoPlus.",
    fundingExplain: "Les arnaqueurs financent souvent leurs portefeuilles via des mixers comme Tornado Cash pour cacher d’où vient l’ETH. L’usage d’un mixer est un signal d’alerte important, même sans autres indicateurs d’arnaque.",
    fundingEvmOnly: "Le traçage détaillé de la source de financement n’est disponible que pour les adresses EVM.",
    multisigUnknown: "— Statut multi-signature inconnu (EOA ou vérification indisponible)",
    multisigYes: "⚠️ Ceci est un portefeuille à contrat multi-signature",
    multisigNo: "✅ Portefeuille EOA standard — pas un multi-signature",
    multisigWhatLabel: "Qu’est-ce que le multi-signature ?",
    multisigWhat: " Un portefeuille multi-signature exige plusieurs clés privées pour approuver les transactions. Bien que les protocoles légitimes les utilisent, les arnaqueurs s’en servent parfois pour donner l’illusion que les fonds sont sécurisés — alors qu’ils contrôlent toutes les clés.",
    multisigWarning: "⚠️ Les investissements légitimes ne vous demandent jamais de déposer dans leur portefeuille. Si quelqu’un vous demande d’envoyer des tokens à une adresse — multi-signature ou non — c’est très probablement une arnaque.",
    multisigEvmOnly: "La détection multi-signature n’est disponible que pour les adresses EVM.",
    verifiedTitle: "Émetteur vérifié",
    verifiedBody: "{domain} a prouvé le contrôle de son domaine et inscrit celle-ci comme l’une de ses propres adresses de réception.",
    verifiedMerchant: "Un membre vérifié d’Almstins a enregistré cette adresse sous « {name} ».",
    verifiedVia: " · vérifié via {domain}",
    verifiedSub: "Cela confirme qui a publié l’adresse — pas qu’un paiement soit sûr. Vérifiez tout de même le montant et que vous vouliez bien payer cette entreprise.",
  },
};
