/**
 * Copy for the Agentics door: the landing page (/agentics), the sign-in (/agentics/login), the
 * welcome page a new account lands on (/dashboard/agentics) and the welcome letter. English only
 * for now.
 *
 * The welcome page and the email are the same letter, so both read it from `letter` below and
 * cannot drift apart. Every line here is held to the product's wording rules in
 * tests/agentics/doorCopy.test.ts: Almstins verifies, warns and flags and never says it stops or
 * blocks anything; nothing is called safe; the free plan is described only as what it will cover
 * when the vault opens; paid plans are "coming later" with no prices, because nobody can buy one
 * yet.
 */

/** The plan a free account gets once the vault opens. Not enforced anywhere yet: the vault is not open. */
export const FREE_BOTS = 3;
export const FREE_ADDRESSES = 15;

export const en = {
  lang: 'en',
  brand: 'Almstins Agentics',

  landing: {
    title: 'Almstins Agentics: check the address before your agent pays it',
    description:
      'Agentics verifies the address an AI agent is about to send to and keeps a dated record of what it answered. Read-only, no keys, never in the transaction path. Free accounts are open.',
    eyebrow: 'Almstins Agentics',
    h1: 'Check the address before your agent pays it.',
    sub: 'Agentics verifies the destination an AI agent is about to send to, and keeps a dated record of what it answered. Read-only. No keys, no wallet connection, never in the transaction path.',
    ctaPrimary: 'Create a free account',
    ctaSecondary: 'Read the API docs',
    finePrint: 'Free to sign up. We will email you once, when your vault opens.',

    status: {
      liveLabel: 'Live today',
      liveText: 'the pre-send check (one request, no login) and the free address checker.',
      soonLabel: 'Opening soon',
      soonText: 'your vault, where you add your bots and the addresses they may pay, and get a daily report.',
    },

    stepsTitle: 'How it works',
    steps: [
      {
        tag: 'Opening soon',
        live: false,
        title: 'Register the addresses your agents may pay',
        body: 'You list them, one bot at a time. Agentics checks each address when you add it: sanctions lists, scam screening and domain proofs. Anything that fails a check is flagged for you.',
      },
      {
        tag: 'Live',
        live: true,
        title: 'The agent asks before it sends',
        body: 'One request with the address. The answer is proven, mismatch, unanchored or unknown. The rule for your agent is simple: proceed only on proven, and hold everything else for a person. An outage is never a pass.',
      },
      {
        tag: 'Opening soon',
        live: false,
        title: 'You get the record',
        body: 'Each check becomes a dated entry on your bot’s page. Agentics watches your registered addresses receive the funds, ties each transfer to the check that came before it, and sends a daily report you can download as a signed PDF.',
      },
    ],

    staysTitle: 'What stays true',
    stays: [
      'Agentics verifies, warns and flags. You decide.',
      'Almstins never holds keys, never connects to a wallet, and never moves or signs a transaction.',
      'The record covers the addresses you register. An agent that skips the check is outside what Agentics can see.',
      'If a source cannot be reached, the answer says so. An outage is never a pass.',
    ],

    plansTitle: 'Plans',
    plans: [
      {
        name: 'Free',
        status: 'Open now',
        body: `${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses when the vault opens.`,
      },
      {
        name: 'Paid plans',
        status: 'Coming later',
        body: 'Nothing to buy today.',
      },
    ],

    footer: 'Questions? Write support@almstins.com. Almstins Agentics is part of Almstins.',
    footerLinks: {
      docs: 'API docs',
      checker: 'Free address checker',
      privacy: 'Privacy',
    },
  },

  login: {
    title: 'Sign in to Almstins Agentics',
    pageTitle: 'Sign in: Almstins Agentics',
    blurb: 'Agentics is opening soon. Create your free account now and we will write to you once, when your vault opens.',
    foot: 'No separate signup. The first sign-in creates your account.',
    docsLink: 'Read the API docs',
    trust: ['Read-only. No keys. No wallet connection.', 'Free to sign up. Paid plans come later.'],
  },

  welcome: {
    title: 'Welcome to Almstins Agentics',
    h1: 'You’re in.',
    lead: 'Your free account is ready.',
    copySent: 'A copy of this letter is on its way to your inbox.',
    todayTitle: 'What you can do today',
    today: [
      { href: '/agentics/docs', text: 'Read the API docs and wire the pre-send check into your agent.' },
      { href: '/verify/agent-keys', text: 'Create an API key by proving a domain you control. A key raises the limit from 30 to 300 requests a minute.' },
      { href: '/wallet-checker', text: 'Check any address or site with the free checker.' },
    ],
    signOut: 'Sign out',
  },

  /** The letter itself: shown on the welcome page and sent by email. One paragraph per entry. */
  letter: {
    subject: 'You’re in: Almstins Agentics',
    greeting: 'Hi,',
    paragraphs: [
      'Thanks for signing up for Almstins Agentics. Agentics checks the address an AI agent is about to send to, and keeps a dated record of what it answered. We verify, warn and flag. We never hold keys, and we are never in the transaction.',
      `Where it stands. Live now: the pre-send check, free, no login. Opening soon: your vault, where you add your bots and the addresses they may pay, and get a daily report. Your free plan will cover ${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses. Paid plans come later; there is nothing to buy today.`,
      'What happens next. I will write once, when your vault opens. No newsletter.',
      'If you run agents that move money, reply and tell me what they do and which chains they use. I read every reply, and it decides what I build first.',
    ],
    signoff: ['Donnie', 'Almstins'],
    why: 'You are getting this because you created an Agentics account at almstins.com. It is the only email we will send until your vault opens.',
  },
} as const;

export type AgenticsCopy = typeof en;
