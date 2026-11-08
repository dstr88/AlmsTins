/**
 * Copy for /learn: the public page that lays out everything Almstins offers, tool by tool, with a
 * link on every item, and ends with the tutorials, guides and demos that already exist.
 *
 * It is the brochure (AlmstinsMarketing/Brochures/Almstins-Brochure.html) as a web page, kept to the
 * same claims: every line describes something live on the site, priced as the prices page prices it.
 * Wording rules (tests/learn/learnPage.test.ts): Almstins verifies, warns and flags and the person
 * decides; nothing is called safe; no scores or ratings; no em dashes; American English. English
 * only for now; the shape is ready for es and fr.
 */

export interface LearnLink {
  readonly label: string;
  readonly href: string;
}

export interface LearnTool {
  /** Anchor id for the detail section, and the tile's target. */
  readonly id: string;
  readonly name: string;
  /** One line under the name on the tile. */
  readonly tagline: string;
  /** The price pill. */
  readonly price: string;
  /** Who it is for, one phrase. */
  readonly audience: string;
  /** The detail section's opening paragraph. */
  readonly what: string;
  readonly points: readonly string[];
  /** The closing line of the detail section: the limit, in plain words. */
  readonly limit: string;
  /** Where the tool opens. */
  readonly open: LearnLink;
  /** Pages that teach this tool, if any. */
  readonly learnMore: readonly LearnLink[];
}

export interface LearnPrinciple {
  readonly title: string;
  readonly body: string;
}

export interface LearnResource {
  readonly title: string;
  readonly body: string;
  readonly href: string;
  /** A short label for what kind of page it is: Guide, Demo, Tour, Docs, Reference. */
  readonly kind: string;
}

export interface LearnCopy {
  readonly lang: string;
  readonly canonical: string;
  readonly meta: { readonly title: string; readonly description: string };
  readonly nav: { readonly brand: string; readonly links: readonly LearnLink[] };
  readonly hero: {
    readonly eyebrow: string;
    readonly h1: string;
    readonly lede: string;
    readonly primary: LearnLink;
    readonly secondary: LearnLink;
    readonly stance: string;
  };
  readonly tools: { readonly heading: string; readonly lede: string; readonly items: readonly LearnTool[] };
  readonly principles: { readonly heading: string; readonly lede: string; readonly items: readonly LearnPrinciple[]; readonly quote: string };
  readonly pricing: {
    readonly heading: string;
    readonly lede: string;
    readonly rows: ReadonlyArray<{ readonly plan: string; readonly price: string; readonly body: string }>;
    readonly link: LearnLink;
    readonly note: string;
  };
  readonly not: { readonly heading: string; readonly items: readonly string[] };
  readonly resources: { readonly heading: string; readonly lede: string; readonly items: readonly LearnResource[] };
  readonly closing: { readonly heading: string; readonly body: string; readonly links: readonly LearnLink[] };
  readonly updated: string;
}

export const en: LearnCopy = {
  lang: 'en',
  canonical: 'https://almstins.com/learn',
  meta: {
    title: 'Learn Almstins: five tools for the moment before money moves',
    description:
      'What Almstins does, tool by tool: check an address before you send, keep your crypto books, prove your payment addresses, see whether an invoice is already financed, and keep a record of what your AI agents paid. Read-only, with a link to every page, guide and demo.',
  },
  nav: {
    brand: 'Almstins',
    links: [
      { label: 'Wallet Checker', href: '/wallet-checker' },
      { label: 'Pricing', href: '/prices' },
      { label: 'About', href: '/about' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  hero: {
    eyebrow: 'Learn',
    h1: 'Use crypto without the guesswork.',
    lede:
      'Almstins is five read-only tools for the moment before money moves: the second before you send, sign, or advance funds. This page lays out each one, what it does, what it costs, and where to learn it. Every item links to its page.',
    primary: { label: 'Try the free checker', href: '/wallet-checker' },
    secondary: { label: 'See pricing', href: '/prices' },
    stance: 'Read-only. No wallet connection, no keys, no custody. Almstins verifies, warns and flags; the decision is always yours.',
  },

  tools: {
    heading: 'The five tools',
    lede: 'Two for anyone who holds or sends crypto. Three for businesses, lenders and the people who run AI agents. Pick a tile to read how it works.',
    items: [
      {
        id: 'checker',
        name: 'Wallet & Site Checker',
        tagline: 'Check an address or a website before you send.',
        price: 'Free, no login',
        audience: 'Anyone about to send',
        what: 'Paste or scan any wallet address or website and check it against independent risk sources before you send a thing. Each source’s answer is shown, and a result that could not see enough says so instead of reading clean.',
        points: [
          'Scam, phishing, honeypot and sanctions checks',
          'Full scam checks on Ethereum, BNB Chain and Polygon; sanctions checks on Bitcoin, Litecoin, Solana, Tron and Sui',
          'Sources include GoPlus, Chainalysis sanctions screening, honeypot.is and the OFAC list',
          'Website checks against MetaMask, ScamSniffer, OpenPhish, Google Safe Browsing, VirusTotal and URLScan.io',
          'Red, yellow or green, with each source’s answer shown',
          'Scan a QR code with your phone camera; it is read on your device',
          'Wallet age and activity shown as plain facts, never as a verdict',
          'Shows when an address is a proven Verify destination',
        ],
        limit: 'Lookups only: a check sends the address or link and nothing about you, and never submits anything for scanning. A clean result means no listed source has flagged it yet.',
        open: { label: 'Open the checker', href: '/wallet-checker' },
        learnMore: [
          { label: 'How the signals read, on the checker page', href: '/wallet-checker' },
          { label: 'The checker in Spanish', href: '/wallet-checker/es' },
          { label: 'The checker in French', href: '/wallet-checker/fr' },
        ],
      },
      {
        id: 'watcher',
        name: 'Wallet Watcher',
        tagline: 'Everything you own, with cost basis and a tax breakdown.',
        price: 'Free up to 3 wallets',
        audience: 'Anyone with more than one wallet or exchange',
        what: 'Everything you own across wallets, exchanges and DeFi in one place, with cost basis, realized gains and a full tax breakdown. Read by public address; nothing to connect.',
        points: [
          'Wallets on Ethereum, Polygon, Avalanche, Bitcoin, Litecoin, Solana, Sui and Rootstock',
          'Aave and Sovryn DeFi positions',
          'Exchange imports: Coinbase, Kraken, Gemini, Crypto.com, Robinhood, Exodus, Cash App and Venmo',
          'Cost basis and realized gains (FIFO), short and long term',
          'A research desk for your own transactions that are missing a purchase record or cost basis',
          'AI Triage to sort unresolved transactions (paid plans)',
          'Price and Aave health-factor email alerts',
          'Signed, tamper-evident Year Summary PDF anyone can verify (Unlimited plan)',
        ],
        limit: 'Almstins organizes records; it does not file taxes or give tax advice. The accountants who help you can read the same records.',
        open: { label: 'Open the tracker', href: '/' },
        learnMore: [
          { label: 'Try the demo account, with guided tours', href: '/api/demo/start' },
          { label: 'Guide: proving when you bought crypto after a transfer', href: '/guides/crypto-holding-period-after-transfer' },
          { label: 'Verify a signed Year Summary', href: '/verify-record' },
        ],
      },
      {
        id: 'verify',
        name: 'Verify',
        tagline: 'Prove the payment addresses your business publishes are really yours.',
        price: 'Free during early access',
        audience: 'Businesses, platforms and exchanges',
        what: 'A business registers the receiving addresses and payment links it publishes and proves they are really its own, so a customer can check a QR code or address before paying and spot one that was swapped or faked.',
        points: [
          'Prove control with a tiny payment from the address to itself, a file or DNS record on your domain, or an encrypted address list',
          'Two public levels: Claimed, and Verified when backed by your own domain',
          '“Scan before you pay” page: customers check any sign or QR, no account needed',
          'Printable QR code for tables, registers and invoices that customers scan to check the address',
          'Ongoing checks of what you publish, with email alerts to you',
          'Only proven destinations are ever shown publicly',
          'Exchanges: let users confirm official deposit addresses before they send',
          'Developers and AI agents: a pre-send destination check API',
        ],
        limit: 'Free early access: up to 3 destinations (2 wallet addresses and 1 payment link or QR). Verify proves control and publication, not that a business is honest.',
        open: { label: 'Open Verify', href: '/verify' },
        learnMore: [
          { label: 'Verify sandbox: try a proof in the browser', href: '/artifacts/sandbox' },
          { label: 'The check API and its decision rule', href: '/agentics/docs' },
          { label: 'Verify, in Spanish and French', href: '/verify/es' },
        ],
      },
      {
        id: 'receivables',
        name: 'Receivables and milestone desks',
        tagline: 'A signed record of who financed an invoice, and of each milestone a tranche released against.',
        price: 'Free, one contract at a time',
        audience: 'Lenders and the businesses they finance',
        what: 'A shared, signed record for invoice financing. A business records a receivable, lenders record the financing they extend against it, and anyone holding the receivable’s ID can see what is already financed before advancing more. The milestone desk does the same for staged work: a sealed schedule, inspectors who attest each stage from a single-use link, the funder’s payment record, and a dated close.',
        points: [
          'Record a receivable once; each lender’s financing is added to the same record',
          'See how much of an invoice is already financed',
          '“Seen before?” check: ask whether an invoice is already on record before advancing',
          'Debtor confirmation through a single-use link, no account needed',
          'Every entry signed and time-stamped on Bitcoin',
          'Records age in the open: current, in grace, past due, or lapsed after six months',
          'Email reminders to lender and business as a record goes stale',
          'Automatic warnings for look-alike invoices',
          'Milestones: a sealed schedule, inspector attestations with photos and a signed form, the funder’s payment record, and a signed close',
          'Works for any invoice, crypto or not',
        ],
        limit: 'A voluntary record that helps lenders spot double financing. It shows what the parties themselves recorded, and it never moves money. Free holds one open contract at a time, a registered claim or a sealed project; Standard holds ten.',
        open: { label: 'Open the receivables desk', href: '/receivables' },
        learnMore: [
          { label: 'Receivables registry demo: two lenders, one invoice', href: '/artifacts/registry' },
          { label: 'Milestone desk demo', href: '/artifacts/cairn' },
          { label: 'A Bitcoin-anchored proof, explained', href: '/artifacts/proof' },
          { label: 'The user’s guide to the financing desk', href: '/verify/guide' },
          { label: 'Run sheet: one real receivable, end to end', href: '/verify/runsheet' },
          { label: 'Check any receivable ID, no login', href: '/verify/registry' },
        ],
      },
      {
        id: 'agentics',
        name: 'Agent Vault',
        tagline: 'Your AI agents ask before they pay. Every answer and every transfer on record.',
        price: 'Free, 3 agents',
        audience: 'People who run AI agents that pay',
        what: 'Register each agent, the wallets it pays from and the addresses it may pay. The agent asks before it sends, and the Vault keeps a dated record of every answer and every transfer, with a daily report you can download as a signed PDF.',
        points: [
          'Pre-send check API: one request, no login; the answer is proven, mismatch, unanchored or unknown',
          'An outage is never a pass; the rule for the agent is proceed only on proven',
          'Every address screened as you add it and at every keyed check: sanctions lists, scam screening, domain proofs',
          'Every direct transfer of an agent’s wallet on Ethereum, Polygon and Avalanche, in and out, with whether the other side was on your list',
          'A payment to an address not on the list, with no check before it, is marked unmatched and emailed to you at once',
          'Emails never show an address, a label or an amount',
          'A daily report as a signed PDF, and a History page of where your agents’ money came from',
          'Free plan: 3 agents, 15 addresses, 5 wallets per agent, 5,000 recorded checks per agent per day',
        ],
        limit: 'Agentics verifies, warns and flags; you decide. It never holds keys and is never in the payment path. Paid plans come later; nothing to buy today.',
        open: { label: 'Open Agentics', href: '/agentics' },
        learnMore: [
          { label: 'API docs: the pre-send check and the decision rule', href: '/agentics/docs' },
          { label: 'What changed, release by release', href: '/changelog' },
        ],
      },
    ],
  },

  principles: {
    heading: 'What we believe',
    lede: 'Trust you can check, not trust you have to take. Six principles shape every tool.',
    items: [
      { title: 'Read-only. No custody, ever.', body: 'Almstins reads public data and the files you choose to import. It never asks you to connect a wallet, never holds keys, and never moves funds, so there are no keys on our servers to steal.' },
      { title: 'The evidence, then your decision.', body: 'Every result shows which sources said what. Almstins warns and flags. It never makes the call for you, and nothing in it stands between you and your money.' },
      { title: 'Proof, not promises.', body: 'Year Summary exports, Agent Vault reports and receivables records are signed, so anyone can check them against our published key, and receivables records are also time-stamped on Bitcoin. We call it verifiable trust.' },
      { title: 'Private by design.', body: 'We never ask for your name to sign up. A check sends only the address or link being checked, never who you are. No ads, no selling data, and Almstins does not file scam or fraud reports about anyone.' },
      { title: 'Honest about limits.', body: 'No star ratings or reputation scores: popularity is not trust, and scammers can buy volume. When a check cannot see enough, it says so instead of showing a clean result.' },
      { title: 'Safety stays free.', body: 'The wallet and site checker costs nothing and needs no account, and every other tool starts free. You pay only when you want to track more, watch more or hold more open contracts.' },
    ],
    quote: 'Almstins sits above the payment rails. It does not move money; it helps people check where money is about to go, and keeps a record they can prove later.',
  },

  pricing: {
    heading: 'Start free. Pay only for more.',
    lede: 'Every tool has a free plan. The full table, with what each plan includes, is on the pricing page.',
    rows: [
      { plan: 'Wallet & Site Checker', price: '$0', body: 'Free checks, no login.' },
      { plan: 'Wallet Watcher', price: '$0 to $39/mo', body: 'Free up to 3 wallets. Starter $7, Pro $20, Unlimited $39 a month, or pay yearly.' },
      { plan: 'Verify', price: '$0', body: 'Early access: up to 3 destinations. Exchanges and larger operations: let’s talk.' },
      { plan: 'Agent Vault', price: '$0', body: '3 agents, 15 addresses, 5 wallets per agent, 5,000 recorded checks per agent per day. Paid plans come later.' },
      { plan: 'Receivables and milestone desks', price: '$0 or $95/mo', body: 'Free: one open contract at a time. Standard: ten, at $95 a month. Standard billing opens soon; until then, ask by email.' },
    ],
    link: { label: 'See the full pricing table', href: '/prices' },
    note: 'Prices in US dollars, as of November 2026. Verify is in early access.',
  },

  not: {
    heading: 'What Almstins is not',
    items: [
      'Not a wallet, exchange or custodian',
      'Not a payment rail: it never moves money',
      'Not tax, legal or financial advice',
      'Not a rating or reputation service',
      'Never connects to your wallet or asks for keys',
      'Never sells your data or shows ads',
    ],
  },

  resources: {
    heading: 'Tutorials, guides and demos',
    lede: 'Everything that already teaches Almstins, in one place. The demos run in your browser with no login. The tours run inside a demo account.',
    items: [
      { kind: 'Tour', title: 'Demo account with guided tours', body: 'A shared demo account with sample wallets. Guided tours walk the portfolio, the year-end review, lost transactions and the research desk.', href: '/api/demo/start' },
      { kind: 'Demo', title: 'Receivables registry', body: 'Can two lenders finance the same invoice? Try the duplicate-financing check live.', href: '/artifacts/registry' },
      { kind: 'Demo', title: 'A Bitcoin-anchored proof', body: 'See how a signed record earns a dated, tamper-evident timestamp on Bitcoin.', href: '/artifacts/proof' },
      { kind: 'Demo', title: 'Milestone desk', body: 'A sealed schedule, an inspector’s answer, a tranche released against it.', href: '/artifacts/cairn' },
      { kind: 'Demo', title: 'Verify sandbox', body: 'Prove a destination and see what the public scan page shows.', href: '/artifacts/sandbox' },
      { kind: 'Demo', title: 'Almstins Verify, walked through', body: 'The merchant’s side of Verify, step by step.', href: '/artifacts/demo' },
      { kind: 'Guide', title: 'Crypto records: the holding period after a transfer', body: 'How to prove when you bought crypto after you moved it, with the official sources.', href: '/guides/crypto-holding-period-after-transfer' },
      { kind: 'Guide', title: 'The financing desk, card by card', body: 'The user’s guide to the receivables desk: the words, the flow, the two links you send, and what the evidence proves.', href: '/verify/guide' },
      { kind: 'Guide', title: 'Run sheet', body: 'Run one real receivable end to end in about an hour. The page a financier keeps open during the first call.', href: '/verify/runsheet' },
      { kind: 'Docs', title: 'Agentics API docs', body: 'The pre-send destination check for software and AI agents, and the published decision rule: proceed only on proven.', href: '/agentics/docs' },
      { kind: 'Reference', title: 'Verify a signed record', body: 'Paste a Year Summary, an agent report or a receivables proof file and check its signature against the published key.', href: '/verify-record' },
      { kind: 'Reference', title: 'Public receivable check', body: 'Paste a receivable ID to see what is already claimed against it. No account.', href: '/verify/registry' },
      { kind: 'Reference', title: 'What changed', body: 'The release log for the whole site, and the separate build log for Almstins Verify.', href: '/changelog' },
      { kind: 'Reference', title: 'Almstins Verify build log', body: 'Every change to the receivables desks and Verify, dated.', href: '/verify/changelog' },
      { kind: 'Reference', title: 'Privacy policy and user agreement', body: 'What is stored, what is never stored, and what leaves the account.', href: '/privacy' },
    ],
  },

  closing: {
    heading: 'See it for yourself.',
    body: 'Try the free checker or a demo, no account needed. Questions and corrections are welcome at donnie@almstins.com.',
    links: [
      { label: 'Free checker', href: '/wallet-checker' },
      { label: 'Pricing', href: '/prices' },
      { label: 'About Almstins', href: '/about' },
    ],
  },
  updated: 'Page reflects the product as of November 8, 2026.',
};

/** The language switch every learn page shows. One entry per language that has a copy. */
export const LEARN_LANGS = [
  { code: 'en', label: 'EN', href: '/learn' },
  { code: 'es', label: 'ES', href: '/learn/es' },
  { code: 'fr', label: 'FR', href: '/learn/fr' },
] as const;

export const es: LearnCopy = {
  lang: 'es',
  canonical: 'https://almstins.com/learn/es',
  meta: {
    title: 'Conoce Almstins: cinco herramientas para el momento antes de que el dinero se mueva',
    description:
      'Qué hace Almstins, herramienta por herramienta: comprueba una dirección antes de enviar, lleva tus libros cripto, demuestra tus direcciones de pago, mira si una factura ya está financiada y guarda un registro de lo que pagaron tus agentes de IA. Solo lectura, con un enlace a cada página, guía y demo.',
  },
  nav: {
    brand: 'Almstins',
    links: [
      { label: 'Comprobador', href: '/wallet-checker/es' },
      { label: 'Precios', href: '/prices/es' },
      { label: 'Acerca de', href: '/about/es' },
      { label: 'Iniciar sesión', href: '/login' },
    ],
  },
  hero: {
    eyebrow: 'Aprende',
    h1: 'Usa cripto sin adivinar.',
    lede:
      'Almstins son cinco herramientas de solo lectura para el momento antes de que el dinero se mueva: el segundo antes de enviar, firmar o adelantar fondos. Esta página explica cada una, qué hace, cuánto cuesta y dónde aprenderla. Cada elemento enlaza a su página.',
    primary: { label: 'Prueba el comprobador gratis', href: '/wallet-checker/es' },
    secondary: { label: 'Ver precios', href: '/prices/es' },
    stance: 'Solo lectura. Sin conectar billeteras, sin claves, sin custodia. Almstins verifica, avisa y señala; la decisión siempre es tuya.',
  },

  tools: {
    heading: 'Las cinco herramientas',
    lede: 'Dos para cualquiera que tenga o envíe cripto. Tres para empresas, prestamistas y quienes operan agentes de IA. Elige una tarjeta para leer cómo funciona.',
    items: [
      {
        id: 'checker',
        name: 'Comprobador de billeteras y sitios',
        tagline: 'Comprueba una dirección o un sitio web antes de enviar.',
        price: 'Gratis, sin cuenta',
        audience: 'Cualquiera a punto de enviar',
        what: 'Pega o escanea cualquier dirección de billetera o sitio web y compruébalo contra fuentes de riesgo independientes antes de enviar nada. Se muestra la respuesta de cada fuente, y un resultado que no pudo ver lo suficiente lo dice en lugar de leerse limpio.',
        points: [
          'Comprobaciones de estafa, phishing, honeypot y sanciones',
          'Comprobación completa de estafas en Ethereum, BNB Chain y Polygon; comprobación de sanciones en Bitcoin, Litecoin, Solana, Tron y Sui',
          'Fuentes como GoPlus, el cribado de sanciones de Chainalysis, honeypot.is y la lista OFAC',
          'Sitios web comprobados contra MetaMask, ScamSniffer, OpenPhish, Google Safe Browsing, VirusTotal y URLScan.io',
          'Rojo, amarillo o verde, con la respuesta de cada fuente a la vista',
          'Escanea un código QR con la cámara del teléfono; se lee en tu dispositivo',
          'Antigüedad y actividad de la billetera como hechos simples, nunca como veredicto',
          'Indica cuándo una dirección es un destino probado en Verify',
        ],
        limit: 'Solo consultas: una comprobación envía la dirección o el enlace y nada sobre ti, y nunca envía nada a analizar. Un resultado limpio significa que ninguna fuente listada lo ha señalado todavía.',
        open: { label: 'Abrir el comprobador', href: '/wallet-checker/es' },
        learnMore: [
          { label: 'Cómo se leen las señales, en la página del comprobador', href: '/wallet-checker/es' },
          { label: 'El comprobador en inglés', href: '/wallet-checker' },
          { label: 'El comprobador en francés', href: '/wallet-checker/fr' },
        ],
      },
      {
        id: 'watcher',
        name: 'Wallet Watcher',
        tagline: 'Todo lo que tienes, con costo base y desglose fiscal.',
        price: 'Gratis hasta 3 billeteras',
        audience: 'Cualquiera con más de una billetera o exchange',
        what: 'Todo lo que tienes en billeteras, exchanges y DeFi en un solo lugar, con costo base, ganancias realizadas y un desglose fiscal completo. Se lee por dirección pública; nada que conectar.',
        points: [
          'Billeteras en Ethereum, Polygon, Avalanche, Bitcoin, Litecoin, Solana, Sui y Rootstock',
          'Posiciones DeFi en Aave y Sovryn',
          'Importaciones de exchanges: Coinbase, Kraken, Gemini, Crypto.com, Robinhood, Exodus, Cash App y Venmo',
          'Costo base y ganancias realizadas (FIFO), a corto y largo plazo',
          'Una mesa de investigación para tus propias transacciones sin registro de compra o sin costo base',
          'AI Triage para ordenar las transacciones sin resolver (planes de pago)',
          'Alertas por correo de precio y del factor de salud de Aave',
          'PDF de resumen anual firmado, a prueba de alteraciones, que cualquiera puede verificar (plan Unlimited)',
        ],
        limit: 'Almstins organiza registros; no presenta impuestos ni da asesoría fiscal. Los contadores que te ayudan pueden leer los mismos registros.',
        open: { label: 'Abrir el rastreador', href: '/es' },
        learnMore: [
          { label: 'Prueba la cuenta demo, con recorridos guiados', href: '/api/demo/start' },
          { label: 'Guía: probar cuándo compraste cripto después de una transferencia (en inglés)', href: '/guides/crypto-holding-period-after-transfer' },
          { label: 'Verificar un resumen anual firmado', href: '/verify-record' },
        ],
      },
      {
        id: 'verify',
        name: 'Verify',
        tagline: 'Demuestra que las direcciones de pago que publica tu negocio son realmente tuyas.',
        price: 'Gratis en acceso anticipado',
        audience: 'Negocios, plataformas y exchanges',
        what: 'Un negocio registra las direcciones de cobro y los enlaces de pago que publica y demuestra que son realmente suyos, para que un cliente pueda comprobar un código QR o una dirección antes de pagar y detectar uno sustituido o falsificado.',
        points: [
          'Demuestra el control con un pago mínimo de la dirección a sí misma, un archivo o registro DNS en tu dominio, o una lista de direcciones cifrada',
          'Dos niveles públicos: Reclamado, y Verificado cuando lo respalda tu propio dominio',
          'Página “Escanea antes de pagar”: los clientes comprueban cualquier letrero o QR sin cuenta',
          'Código QR imprimible para mesas, cajas y facturas que los clientes escanean para comprobar la dirección',
          'Comprobaciones continuas de lo que publicas, con alertas por correo para ti',
          'Solo los destinos probados se muestran en público',
          'Exchanges: deja que tus usuarios confirmen las direcciones de depósito oficiales antes de enviar',
          'Desarrolladores y agentes de IA: una API de comprobación de destino antes de enviar',
        ],
        limit: 'Acceso anticipado gratis: hasta 3 destinos (2 direcciones de billetera y 1 enlace de pago o QR). Verify prueba el control y la publicación, no que un negocio sea honesto.',
        open: { label: 'Abrir Verify', href: '/verify/es' },
        learnMore: [
          { label: 'Sandbox de Verify: prueba una demostración de control en el navegador', href: '/artifacts/sandbox' },
          { label: 'La API de comprobación y su regla de decisión (en inglés)', href: '/agentics/docs' },
          { label: 'Verify en inglés', href: '/verify' },
        ],
      },
      {
        id: 'receivables',
        name: 'Mesas de cuentas por cobrar y de hitos',
        tagline: 'Un registro firmado de quién financió una factura, y de cada hito contra el que se liberó un tramo.',
        price: 'Gratis, un contrato a la vez',
        audience: 'Prestamistas y las empresas que financian',
        what: 'Un registro compartido y firmado para el financiamiento de facturas. Una empresa registra una cuenta por cobrar, los prestamistas registran el financiamiento que otorgan contra ella, y cualquiera con el ID de la cuenta puede ver qué está ya financiado antes de adelantar más. La mesa de hitos hace lo mismo para obras por etapas: un cronograma sellado, inspectores que atestiguan cada etapa desde un enlace de un solo uso, el registro de pago del financiador y un cierre fechado.',
        points: [
          'Registra una cuenta por cobrar una vez; el financiamiento de cada prestamista se añade al mismo registro',
          'Mira cuánto de una factura está ya financiado',
          'Comprobación “¿Vista antes?”: pregunta si una factura ya está registrada antes de adelantar',
          'Confirmación del deudor mediante un enlace de un solo uso, sin cuenta',
          'Cada asiento firmado y sellado en el tiempo en Bitcoin',
          'Los registros envejecen a la vista: al día, en gracia, vencido, o caducado tras seis meses',
          'Recordatorios por correo al prestamista y a la empresa cuando un registro se queda sin actualizar',
          'Avisos automáticos de facturas parecidas',
          'Hitos: un cronograma sellado, atestaciones del inspector con fotos y un formulario firmado, el registro de pago del financiador y un cierre firmado',
          'Sirve para cualquier factura, cripto o no',
        ],
        limit: 'Un registro voluntario que ayuda a los prestamistas a detectar la doble financiación. Muestra lo que las propias partes registraron, y nunca mueve dinero. El plan gratis mantiene un contrato abierto a la vez, una reclamación registrada o un proyecto sellado; Standard mantiene diez.',
        open: { label: 'Abrir la mesa de cuentas por cobrar (en inglés)', href: '/receivables' },
        learnMore: [
          { label: 'Demo del registro: dos prestamistas, una factura', href: '/artifacts/registry' },
          { label: 'Demo de la mesa de hitos', href: '/artifacts/cairn' },
          { label: 'Una prueba anclada en Bitcoin, explicada', href: '/artifacts/proof' },
          { label: 'La guía del usuario de la mesa de financiamiento', href: '/verify/guide' },
          { label: 'Hoja de ruta: una cuenta por cobrar real, de principio a fin', href: '/verify/runsheet' },
          { label: 'Comprueba cualquier ID de cuenta por cobrar, sin cuenta', href: '/verify/registry' },
        ],
      },
      {
        id: 'agentics',
        name: 'Agent Vault',
        tagline: 'Tus agentes de IA preguntan antes de pagar. Cada respuesta y cada transferencia quedan registradas.',
        price: 'Gratis, 3 agentes',
        audience: 'Quienes operan agentes de IA que pagan',
        what: 'Registra cada agente, las billeteras desde las que paga y las direcciones a las que puede pagar. El agente pregunta antes de enviar, y el Vault guarda un registro fechado de cada respuesta y cada transferencia, con un informe diario que puedes descargar como PDF firmado.',
        points: [
          'API de comprobación antes de enviar: una petición, sin cuenta; la respuesta es probado, discrepancia, sin anclar o desconocido',
          'Una caída nunca es un visto bueno; la regla para el agente es seguir solo con probado',
          'Cada dirección se criba al añadirla y en cada comprobación con clave: listas de sanciones, cribado de estafas, pruebas de dominio',
          'Cada transferencia directa de la billetera de un agente en Ethereum, Polygon y Avalanche, de entrada y de salida, con si la otra parte estaba en tu lista',
          'Un pago a una dirección fuera de la lista, sin comprobación previa, se marca como sin correspondencia y se te envía por correo al instante',
          'Los correos nunca muestran una dirección, una etiqueta ni un importe',
          'Un informe diario como PDF firmado, y una página de Historial de dónde vino el dinero de tus agentes',
          'Plan gratis: 3 agentes, 15 direcciones, 5 billeteras por agente, 5,000 comprobaciones registradas por agente al día',
        ],
        limit: 'Agentics verifica, avisa y señala; tú decides. Nunca guarda claves y nunca está en la ruta del pago. Los planes de pago llegarán más adelante; hoy no hay nada que comprar.',
        open: { label: 'Abrir Agentics (en inglés)', href: '/agentics' },
        learnMore: [
          { label: 'Documentación de la API: la comprobación antes de enviar y la regla de decisión', href: '/agentics/docs' },
          { label: 'Qué cambió, versión por versión', href: '/changelog' },
        ],
      },
    ],
  },

  principles: {
    heading: 'En qué creemos',
    lede: 'Confianza que puedes comprobar, no confianza que tengas que aceptar. Seis principios dan forma a cada herramienta.',
    items: [
      { title: 'Solo lectura. Sin custodia, nunca.', body: 'Almstins lee datos públicos y los archivos que eliges importar. Nunca te pide conectar una billetera, nunca guarda claves y nunca mueve fondos, así que no hay claves en nuestros servidores que robar.' },
      { title: 'La evidencia, y luego tu decisión.', body: 'Cada resultado muestra qué dijo cada fuente. Almstins avisa y señala. Nunca toma la decisión por ti, y nada en él se interpone entre tú y tu dinero.' },
      { title: 'Pruebas, no promesas.', body: 'Los resúmenes anuales, los informes del Agent Vault y los registros de cuentas por cobrar están firmados, así que cualquiera puede comprobarlos contra nuestra clave publicada, y los registros de cuentas por cobrar también llevan sello de tiempo en Bitcoin. Lo llamamos confianza verificable.' },
      { title: 'Privado por diseño.', body: 'Nunca pedimos tu nombre para registrarte. Una comprobación envía solo la dirección o el enlace comprobado, nunca quién eres. Sin anuncios, sin venta de datos, y Almstins no presenta denuncias de estafa o fraude sobre nadie.' },
      { title: 'Honestos sobre los límites.', body: 'Sin estrellas ni puntuaciones de reputación: la popularidad no es confianza, y los estafadores pueden comprar volumen. Cuando una comprobación no puede ver lo suficiente, lo dice en lugar de mostrar un resultado limpio.' },
      { title: 'La seguridad sigue siendo gratis.', body: 'El comprobador de billeteras y sitios no cuesta nada y no necesita cuenta, y todas las demás herramientas empiezan gratis. Pagas solo cuando quieres seguir más, vigilar más o mantener más contratos abiertos.' },
    ],
    quote: 'Almstins está por encima de los rieles de pago. No mueve dinero; ayuda a las personas a comprobar a dónde está a punto de ir el dinero y guarda un registro que pueden probar después.',
  },

  pricing: {
    heading: 'Empieza gratis. Paga solo por más.',
    lede: 'Cada herramienta tiene un plan gratis. La tabla completa, con lo que incluye cada plan, está en la página de precios.',
    rows: [
      { plan: 'Comprobador de billeteras y sitios', price: '$0', body: 'Comprobaciones gratis, sin cuenta.' },
      { plan: 'Wallet Watcher', price: '$0 a $39/mes', body: 'Gratis hasta 3 billeteras. Starter $7, Pro $20, Unlimited $39 al mes, o paga por año.' },
      { plan: 'Verify', price: '$0', body: 'Acceso anticipado: hasta 3 destinos. Exchanges y operaciones mayores: hablemos.' },
      { plan: 'Agent Vault', price: '$0', body: '3 agentes, 15 direcciones, 5 billeteras por agente, 5,000 comprobaciones registradas por agente al día. Los planes de pago llegarán más adelante.' },
      { plan: 'Mesas de cuentas por cobrar y de hitos', price: '$0 o $95/mes', body: 'Gratis: un contrato abierto a la vez. Standard: diez, por $95 al mes. La facturación de Standard abre pronto; hasta entonces, pídelo por correo.' },
    ],
    link: { label: 'Ver la tabla de precios completa', href: '/prices/es' },
    note: 'Precios en dólares estadounidenses, a noviembre de 2026. Verify está en acceso anticipado.',
  },

  not: {
    heading: 'Lo que Almstins no es',
    items: [
      'No es una billetera, un exchange ni un custodio',
      'No es un riel de pago: nunca mueve dinero',
      'No es asesoría fiscal, legal ni financiera',
      'No es un servicio de calificación ni de reputación',
      'Nunca se conecta a tu billetera ni pide claves',
      'Nunca vende tus datos ni muestra anuncios',
    ],
  },

  resources: {
    heading: 'Tutoriales, guías y demos',
    lede: 'Todo lo que ya enseña Almstins, en un solo lugar. Las demos corren en tu navegador sin cuenta. Los recorridos corren dentro de una cuenta demo. Las páginas marcadas están en inglés.',
    items: [
      { kind: 'Recorrido', title: 'Cuenta demo con recorridos guiados', body: 'Una cuenta demo compartida con billeteras de ejemplo. Recorridos guiados por la cartera, la revisión de fin de año, las transacciones perdidas y la mesa de investigación.', href: '/api/demo/start' },
      { kind: 'Demo', title: 'Registro de cuentas por cobrar', body: '¿Pueden dos prestamistas financiar la misma factura? Prueba en vivo la comprobación de doble financiación.', href: '/artifacts/registry' },
      { kind: 'Demo', title: 'Una prueba anclada en Bitcoin', body: 'Mira cómo un registro firmado obtiene un sello de tiempo fechado y a prueba de alteraciones en Bitcoin.', href: '/artifacts/proof' },
      { kind: 'Demo', title: 'Mesa de hitos', body: 'Un cronograma sellado, la respuesta de un inspector, un tramo liberado contra ella.', href: '/artifacts/cairn' },
      { kind: 'Demo', title: 'Sandbox de Verify', body: 'Demuestra un destino y mira qué muestra la página pública de escaneo.', href: '/artifacts/sandbox' },
      { kind: 'Demo', title: 'Almstins Verify, paso a paso', body: 'El lado del comerciante en Verify, paso a paso.', href: '/artifacts/demo' },
      { kind: 'Guía (inglés)', title: 'Registros cripto: el periodo de tenencia tras una transferencia', body: 'Cómo probar cuándo compraste cripto después de moverla, con las fuentes oficiales.', href: '/guides/crypto-holding-period-after-transfer' },
      { kind: 'Guía (inglés)', title: 'La mesa de financiamiento, tarjeta por tarjeta', body: 'La guía del usuario de la mesa de cuentas por cobrar: las palabras, el flujo, los dos enlaces que envías y qué prueba la evidencia.', href: '/verify/guide' },
      { kind: 'Guía (inglés)', title: 'Hoja de ruta', body: 'Lleva una cuenta por cobrar real de principio a fin en alrededor de una hora. La página que un financiador mantiene abierta durante la primera llamada.', href: '/verify/runsheet' },
      { kind: 'Docs (inglés)', title: 'Documentación de la API de Agentics', body: 'La comprobación de destino antes de enviar para software y agentes de IA, y la regla de decisión publicada: seguir solo con probado.', href: '/agentics/docs' },
      { kind: 'Referencia', title: 'Verificar un registro firmado', body: 'Pega un resumen anual, un informe de agente o un archivo de prueba de cuentas por cobrar y comprueba su firma contra la clave publicada.', href: '/verify-record' },
      { kind: 'Referencia', title: 'Comprobación pública de cuentas por cobrar', body: 'Pega un ID de cuenta por cobrar para ver qué está ya reclamado contra ella. Sin cuenta.', href: '/verify/registry' },
      { kind: 'Referencia', title: 'Qué cambió', body: 'El registro de versiones de todo el sitio, y el registro de construcción aparte de Almstins Verify.', href: '/changelog' },
      { kind: 'Referencia', title: 'Registro de construcción de Almstins Verify', body: 'Cada cambio en las mesas de cuentas por cobrar y en Verify, con fecha.', href: '/verify/changelog' },
      { kind: 'Referencia', title: 'Política de privacidad y acuerdo de usuario', body: 'Qué se guarda, qué nunca se guarda y qué sale de la cuenta.', href: '/privacy' },
    ],
  },

  closing: {
    heading: 'Compruébalo tú mismo.',
    body: 'Prueba el comprobador gratis o una demo, sin cuenta. Preguntas y correcciones a donnie@almstins.com.',
    links: [
      { label: 'Comprobador gratis', href: '/wallet-checker/es' },
      { label: 'Precios', href: '/prices/es' },
      { label: 'Acerca de Almstins', href: '/about/es' },
    ],
  },
  updated: 'La página refleja el producto al 8 de noviembre de 2026.',
};

export const fr: LearnCopy = {
  lang: 'fr',
  canonical: 'https://almstins.com/learn/fr',
  meta: {
    title: 'Découvrir Almstins : cinq outils pour l’instant qui précède un paiement',
    description:
      'Ce que fait Almstins, outil par outil : vérifier une adresse avant d’envoyer, tenir vos livres crypto, prouver vos adresses de paiement, voir si une facture est déjà financée et garder une trace de ce que vos agents IA ont payé. En lecture seule, avec un lien vers chaque page, guide et démo.',
  },
  nav: {
    brand: 'Almstins',
    links: [
      { label: 'Vérificateur', href: '/wallet-checker/fr' },
      { label: 'Tarifs', href: '/prices/fr' },
      { label: 'À propos', href: '/about/fr' },
      { label: 'Se connecter', href: '/login' },
    ],
  },
  hero: {
    eyebrow: 'Découvrir',
    h1: 'La crypto sans deviner.',
    lede:
      'Almstins, ce sont cinq outils en lecture seule pour l’instant qui précède un mouvement d’argent : la seconde avant d’envoyer, de signer ou d’avancer des fonds. Cette page présente chacun d’eux, ce qu’il fait, ce qu’il coûte et où l’apprendre. Chaque élément renvoie à sa page.',
    primary: { label: 'Essayer le vérificateur gratuit', href: '/wallet-checker/fr' },
    secondary: { label: 'Voir les tarifs', href: '/prices/fr' },
    stance: 'Lecture seule. Aucune connexion de portefeuille, aucune clé, aucune garde. Almstins vérifie, avertit et signale ; la décision vous appartient toujours.',
  },

  tools: {
    heading: 'Les cinq outils',
    lede: 'Deux pour toute personne qui détient ou envoie de la crypto. Trois pour les entreprises, les prêteurs et ceux qui exploitent des agents IA. Choisissez une tuile pour lire comment il fonctionne.',
    items: [
      {
        id: 'checker',
        name: 'Vérificateur de portefeuilles et de sites',
        tagline: 'Vérifiez une adresse ou un site web avant d’envoyer.',
        price: 'Gratuit, sans compte',
        audience: 'Toute personne sur le point d’envoyer',
        what: 'Collez ou scannez n’importe quelle adresse de portefeuille ou site web et vérifiez-le auprès de sources de risque indépendantes avant d’envoyer quoi que ce soit. La réponse de chaque source est affichée, et un résultat qui n’a pas pu voir assez le dit au lieu de paraître net.',
        points: [
          'Vérifications d’arnaque, de phishing, de honeypot et de sanctions',
          'Vérification complète des arnaques sur Ethereum, BNB Chain et Polygon ; vérification des sanctions sur Bitcoin, Litecoin, Solana, Tron et Sui',
          'Des sources comme GoPlus, le filtrage des sanctions de Chainalysis, honeypot.is et la liste OFAC',
          'Sites web vérifiés auprès de MetaMask, ScamSniffer, OpenPhish, Google Safe Browsing, VirusTotal et URLScan.io',
          'Rouge, jaune ou vert, avec la réponse de chaque source',
          'Scannez un code QR avec l’appareil photo du téléphone ; il est lu sur votre appareil',
          'L’âge et l’activité du portefeuille présentés comme de simples faits, jamais comme un verdict',
          'Indique quand une adresse est une destination prouvée dans Verify',
        ],
        limit: 'Consultation seule : une vérification envoie l’adresse ou le lien et rien sur vous, et ne soumet jamais rien à l’analyse. Un résultat net signifie qu’aucune source listée ne l’a encore signalé.',
        open: { label: 'Ouvrir le vérificateur', href: '/wallet-checker/fr' },
        learnMore: [
          { label: 'Comment lire les signaux, sur la page du vérificateur', href: '/wallet-checker/fr' },
          { label: 'Le vérificateur en anglais', href: '/wallet-checker' },
          { label: 'Le vérificateur en espagnol', href: '/wallet-checker/es' },
        ],
      },
      {
        id: 'watcher',
        name: 'Wallet Watcher',
        tagline: 'Tout ce que vous détenez, avec le prix de revient et le détail fiscal.',
        price: 'Gratuit jusqu’à 3 portefeuilles',
        audience: 'Toute personne avec plus d’un portefeuille ou d’une plateforme',
        what: 'Tout ce que vous détenez sur vos portefeuilles, plateformes d’échange et DeFi en un seul endroit, avec le prix de revient, les gains réalisés et un détail fiscal complet. Lu par adresse publique ; rien à connecter.',
        points: [
          'Portefeuilles sur Ethereum, Polygon, Avalanche, Bitcoin, Litecoin, Solana, Sui et Rootstock',
          'Positions DeFi sur Aave et Sovryn',
          'Imports de plateformes : Coinbase, Kraken, Gemini, Crypto.com, Robinhood, Exodus, Cash App et Venmo',
          'Prix de revient et gains réalisés (FIFO), à court et à long terme',
          'Un bureau de recherche pour vos propres transactions sans justificatif d’achat ou sans prix de revient',
          'AI Triage pour trier les transactions non résolues (forfaits payants)',
          'Alertes par e-mail sur les prix et sur le facteur de santé Aave',
          'PDF de synthèse annuelle signé, inviolable, que n’importe qui peut vérifier (forfait Unlimited)',
        ],
        limit: 'Almstins organise des registres ; il ne déclare pas d’impôts et ne donne aucun conseil fiscal. Les comptables qui vous aident peuvent lire les mêmes registres.',
        open: { label: 'Ouvrir le suivi', href: '/fr' },
        learnMore: [
          { label: 'Essayer le compte démo, avec des visites guidées', href: '/api/demo/start' },
          { label: 'Guide : prouver quand vous avez acheté une crypto après un transfert (en anglais)', href: '/guides/crypto-holding-period-after-transfer' },
          { label: 'Vérifier une synthèse annuelle signée', href: '/verify-record' },
        ],
      },
      {
        id: 'verify',
        name: 'Verify',
        tagline: 'Prouvez que les adresses de paiement publiées par votre entreprise sont bien les vôtres.',
        price: 'Gratuit en accès anticipé',
        audience: 'Entreprises, plateformes et bourses d’échange',
        what: 'Une entreprise enregistre les adresses de réception et les liens de paiement qu’elle publie et prouve qu’ils sont bien les siens, pour qu’un client puisse vérifier un code QR ou une adresse avant de payer et repérer celui qui a été remplacé ou falsifié.',
        points: [
          'Prouvez le contrôle par un paiement minime de l’adresse vers elle-même, un fichier ou un enregistrement DNS sur votre domaine, ou une liste d’adresses chiffrée',
          'Deux niveaux publics : Revendiqué, et Vérifié lorsque votre propre domaine le garantit',
          'Page « Scannez avant de payer » : les clients vérifient n’importe quel affichage ou QR, sans compte',
          'Code QR imprimable pour les tables, les caisses et les factures, que les clients scannent pour vérifier l’adresse',
          'Vérifications continues de ce que vous publiez, avec des alertes par e-mail pour vous',
          'Seules les destinations prouvées sont affichées en public',
          'Bourses d’échange : laissez vos utilisateurs confirmer les adresses de dépôt officielles avant d’envoyer',
          'Développeurs et agents IA : une API de vérification de destination avant envoi',
        ],
        limit: 'Accès anticipé gratuit : jusqu’à 3 destinations (2 adresses de portefeuille et 1 lien de paiement ou QR). Verify prouve le contrôle et la publication, pas l’honnêteté d’une entreprise.',
        open: { label: 'Ouvrir Verify', href: '/verify/fr' },
        learnMore: [
          { label: 'Bac à sable Verify : essayez une preuve dans le navigateur', href: '/artifacts/sandbox' },
          { label: 'L’API de vérification et sa règle de décision (en anglais)', href: '/agentics/docs' },
          { label: 'Verify en anglais', href: '/verify' },
        ],
      },
      {
        id: 'receivables',
        name: 'Bureaux des créances et des jalons',
        tagline: 'Un registre signé de qui a financé une facture, et de chaque jalon contre lequel une tranche a été libérée.',
        price: 'Gratuit, un contrat à la fois',
        audience: 'Prêteurs et entreprises qu’ils financent',
        what: 'Un registre partagé et signé pour le financement de factures. Une entreprise enregistre une créance, les prêteurs enregistrent le financement qu’ils accordent dessus, et quiconque détient l’identifiant de la créance voit ce qui est déjà financé avant d’avancer davantage. Le bureau des jalons fait de même pour les travaux par étapes : un calendrier scellé, des inspecteurs qui attestent chaque étape depuis un lien à usage unique, le registre de paiement du financeur et une clôture datée.',
        points: [
          'Enregistrez une créance une fois ; le financement de chaque prêteur s’ajoute au même registre',
          'Voyez quelle part d’une facture est déjà financée',
          'Vérification « Déjà vue ? » : demandez si une facture est déjà enregistrée avant d’avancer',
          'Confirmation du débiteur par un lien à usage unique, sans compte',
          'Chaque écriture signée et horodatée sur Bitcoin',
          'Les registres vieillissent au grand jour : à jour, en délai de grâce, en retard, ou caducs après six mois',
          'Rappels par e-mail au prêteur et à l’entreprise quand un registre n’est plus mis à jour',
          'Avertissements automatiques pour les factures ressemblantes',
          'Jalons : un calendrier scellé, des attestations d’inspecteur avec photos et formulaire signé, le registre de paiement du financeur et une clôture signée',
          'Pour toute facture, crypto ou non',
        ],
        limit: 'Un registre volontaire qui aide les prêteurs à repérer le double financement. Il montre ce que les parties elles-mêmes ont enregistré, et il ne déplace jamais d’argent. Le forfait gratuit tient un contrat ouvert à la fois, une créance enregistrée ou un projet scellé ; Standard en tient dix.',
        open: { label: 'Ouvrir le bureau des créances (en anglais)', href: '/receivables' },
        learnMore: [
          { label: 'Démo du registre : deux prêteurs, une facture', href: '/artifacts/registry' },
          { label: 'Démo du bureau des jalons', href: '/artifacts/cairn' },
          { label: 'Une preuve ancrée sur Bitcoin, expliquée', href: '/artifacts/proof' },
          { label: 'Le guide de l’utilisateur du bureau de financement', href: '/verify/guide' },
          { label: 'Feuille de route : une vraie créance, de bout en bout', href: '/verify/runsheet' },
          { label: 'Vérifiez n’importe quel identifiant de créance, sans compte', href: '/verify/registry' },
        ],
      },
      {
        id: 'agentics',
        name: 'Agent Vault',
        tagline: 'Vos agents IA demandent avant de payer. Chaque réponse et chaque transfert sont consignés.',
        price: 'Gratuit, 3 agents',
        audience: 'Ceux qui exploitent des agents IA qui paient',
        what: 'Enregistrez chaque agent, les portefeuilles depuis lesquels il paie et les adresses qu’il peut payer. L’agent demande avant d’envoyer, et le Vault garde une trace datée de chaque réponse et de chaque transfert, avec un rapport quotidien téléchargeable en PDF signé.',
        points: [
          'API de vérification avant envoi : une requête, sans compte ; la réponse est prouvé, discordance, non ancré ou inconnu',
          'Une panne n’est jamais un feu vert ; la règle pour l’agent est de ne poursuivre que sur prouvé',
          'Chaque adresse est filtrée à l’ajout et à chaque vérification avec clé : listes de sanctions, filtrage des arnaques, preuves de domaine',
          'Chaque transfert direct du portefeuille d’un agent sur Ethereum, Polygon et Avalanche, entrant et sortant, avec l’indication que l’autre partie figurait ou non sur votre liste',
          'Un paiement vers une adresse hors liste, sans vérification préalable, est marqué sans correspondance et vous est envoyé par e-mail aussitôt',
          'Les e-mails ne montrent jamais d’adresse, d’étiquette ni de montant',
          'Un rapport quotidien en PDF signé, et une page Historique de la provenance de l’argent de vos agents',
          'Forfait gratuit : 3 agents, 15 adresses, 5 portefeuilles par agent, 5 000 vérifications consignées par agent et par jour',
        ],
        limit: 'Agentics vérifie, avertit et signale ; vous décidez. Il ne détient jamais de clés et n’est jamais sur le chemin du paiement. Les forfaits payants viendront plus tard ; rien à acheter aujourd’hui.',
        open: { label: 'Ouvrir Agentics (en anglais)', href: '/agentics' },
        learnMore: [
          { label: 'Documentation de l’API : la vérification avant envoi et la règle de décision', href: '/agentics/docs' },
          { label: 'Ce qui a changé, version par version', href: '/changelog' },
        ],
      },
    ],
  },

  principles: {
    heading: 'Ce en quoi nous croyons',
    lede: 'Une confiance que vous pouvez vérifier, pas une confiance à accorder sur parole. Six principes façonnent chaque outil.',
    items: [
      { title: 'Lecture seule. Aucune garde, jamais.', body: 'Almstins lit des données publiques et les fichiers que vous choisissez d’importer. Il ne vous demande jamais de connecter un portefeuille, ne détient jamais de clés et ne déplace jamais de fonds, donc il n’y a aucune clé à voler sur nos serveurs.' },
      { title: 'Les preuves, puis votre décision.', body: 'Chaque résultat montre ce que chaque source a dit. Almstins avertit et signale. Il ne décide jamais à votre place, et rien en lui ne se place entre vous et votre argent.' },
      { title: 'Des preuves, pas des promesses.', body: 'Les synthèses annuelles, les rapports de l’Agent Vault et les registres de créances sont signés, donc n’importe qui peut les vérifier avec notre clé publiée, et les registres de créances sont aussi horodatés sur Bitcoin. Nous appelons cela la confiance vérifiable.' },
      { title: 'Privé par conception.', body: 'Nous ne demandons jamais votre nom pour vous inscrire. Une vérification n’envoie que l’adresse ou le lien vérifié, jamais qui vous êtes. Pas de publicité, pas de vente de données, et Almstins ne dépose aucun signalement d’arnaque ou de fraude contre qui que ce soit.' },
      { title: 'Honnêtes sur les limites.', body: 'Pas d’étoiles ni de scores de réputation : la popularité n’est pas la confiance, et les escrocs peuvent acheter du volume. Quand une vérification ne peut pas voir assez, elle le dit au lieu d’afficher un résultat net.' },
      { title: 'La sécurité reste gratuite.', body: 'Le vérificateur de portefeuilles et de sites ne coûte rien et ne demande aucun compte, et chaque autre outil commence gratuitement. Vous ne payez que pour suivre plus, surveiller plus ou tenir plus de contrats ouverts.' },
    ],
    quote: 'Almstins se tient au-dessus des rails de paiement. Il ne déplace pas d’argent ; il aide les gens à vérifier où l’argent est sur le point d’aller, et garde une trace qu’ils pourront prouver plus tard.',
  },

  pricing: {
    heading: 'Commencez gratuitement. Ne payez que pour plus.',
    lede: 'Chaque outil a un forfait gratuit. Le tableau complet, avec ce que chaque forfait inclut, est sur la page des tarifs.',
    rows: [
      { plan: 'Vérificateur de portefeuilles et de sites', price: '$0', body: 'Vérifications gratuites, sans compte.' },
      { plan: 'Wallet Watcher', price: '$0 à $39/mois', body: 'Gratuit jusqu’à 3 portefeuilles. Starter $7, Pro $20, Unlimited $39 par mois, ou à l’année.' },
      { plan: 'Verify', price: '$0', body: 'Accès anticipé : jusqu’à 3 destinations. Bourses d’échange et grandes opérations : parlons-en.' },
      { plan: 'Agent Vault', price: '$0', body: '3 agents, 15 adresses, 5 portefeuilles par agent, 5 000 vérifications consignées par agent et par jour. Les forfaits payants viendront plus tard.' },
      { plan: 'Bureaux des créances et des jalons', price: '$0 ou $95/mois', body: 'Gratuit : un contrat ouvert à la fois. Standard : dix, pour $95 par mois. La facturation Standard ouvre bientôt ; d’ici là, demandez par e-mail.' },
    ],
    link: { label: 'Voir le tableau complet des tarifs', href: '/prices/fr' },
    note: 'Prix en dollars américains, au mois de novembre 2026. Verify est en accès anticipé.',
  },

  not: {
    heading: 'Ce qu’Almstins n’est pas',
    items: [
      'Ni un portefeuille, ni une bourse d’échange, ni un dépositaire',
      'Pas un rail de paiement : il ne déplace jamais d’argent',
      'Pas un conseil fiscal, juridique ou financier',
      'Pas un service de notation ni de réputation',
      'Ne se connecte jamais à votre portefeuille et ne demande jamais de clés',
      'Ne vend jamais vos données et n’affiche aucune publicité',
    ],
  },

  resources: {
    heading: 'Tutoriels, guides et démos',
    lede: 'Tout ce qui enseigne déjà Almstins, au même endroit. Les démos tournent dans votre navigateur sans compte. Les visites guidées tournent dans un compte démo. Les pages indiquées sont en anglais.',
    items: [
      { kind: 'Visite', title: 'Compte démo avec visites guidées', body: 'Un compte démo partagé avec des portefeuilles d’exemple. Des visites guidées parcourent le portefeuille, la revue de fin d’année, les transactions perdues et le bureau de recherche.', href: '/api/demo/start' },
      { kind: 'Démo', title: 'Registre des créances', body: 'Deux prêteurs peuvent-ils financer la même facture ? Essayez en direct la vérification du double financement.', href: '/artifacts/registry' },
      { kind: 'Démo', title: 'Une preuve ancrée sur Bitcoin', body: 'Voyez comment un registre signé obtient un horodatage daté et inviolable sur Bitcoin.', href: '/artifacts/proof' },
      { kind: 'Démo', title: 'Bureau des jalons', body: 'Un calendrier scellé, la réponse d’un inspecteur, une tranche libérée en conséquence.', href: '/artifacts/cairn' },
      { kind: 'Démo', title: 'Bac à sable Verify', body: 'Prouvez une destination et voyez ce que montre la page publique de scan.', href: '/artifacts/sandbox' },
      { kind: 'Démo', title: 'Almstins Verify, pas à pas', body: 'Le côté commerçant de Verify, étape par étape.', href: '/artifacts/demo' },
      { kind: 'Guide (anglais)', title: 'Registres crypto : la durée de détention après un transfert', body: 'Comment prouver quand vous avez acheté une crypto après l’avoir déplacée, avec les sources officielles.', href: '/guides/crypto-holding-period-after-transfer' },
      { kind: 'Guide (anglais)', title: 'Le bureau de financement, carte par carte', body: 'Le guide de l’utilisateur du bureau des créances : les mots, le déroulé, les deux liens que vous envoyez et ce que prouvent les éléments.', href: '/verify/guide' },
      { kind: 'Guide (anglais)', title: 'Feuille de route', body: 'Menez une vraie créance de bout en bout en une heure environ. La page qu’un financeur garde ouverte pendant le premier appel.', href: '/verify/runsheet' },
      { kind: 'Docs (anglais)', title: 'Documentation de l’API Agentics', body: 'La vérification de destination avant envoi pour les logiciels et les agents IA, et la règle de décision publiée : ne poursuivre que sur prouvé.', href: '/agentics/docs' },
      { kind: 'Référence', title: 'Vérifier un registre signé', body: 'Collez une synthèse annuelle, un rapport d’agent ou un fichier de preuve de créance et vérifiez sa signature avec la clé publiée.', href: '/verify-record' },
      { kind: 'Référence', title: 'Vérification publique d’une créance', body: 'Collez un identifiant de créance pour voir ce qui est déjà revendiqué dessus. Sans compte.', href: '/verify/registry' },
      { kind: 'Référence', title: 'Ce qui a changé', body: 'Le journal des versions de tout le site, et le journal de construction distinct d’Almstins Verify.', href: '/changelog' },
      { kind: 'Référence', title: 'Journal de construction d’Almstins Verify', body: 'Chaque changement aux bureaux des créances et à Verify, daté.', href: '/verify/changelog' },
      { kind: 'Référence', title: 'Politique de confidentialité et accord d’utilisation', body: 'Ce qui est conservé, ce qui ne l’est jamais, et ce qui sort du compte.', href: '/privacy' },
    ],
  },

  closing: {
    heading: 'Voyez par vous-même.',
    body: 'Essayez le vérificateur gratuit ou une démo, sans compte. Questions et corrections à donnie@almstins.com.',
    links: [
      { label: 'Vérificateur gratuit', href: '/wallet-checker/fr' },
      { label: 'Tarifs', href: '/prices/fr' },
      { label: 'À propos d’Almstins', href: '/about/fr' },
    ],
  },
  updated: 'La page reflète le produit au 8 novembre 2026.',
};
