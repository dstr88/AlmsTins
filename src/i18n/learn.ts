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
