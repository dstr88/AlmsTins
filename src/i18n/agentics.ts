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
 *
 * The copy has two states, chosen by the flag that opens the Vault (AGENTICS_VAULT_PUBLIC, see
 * src/lib/agenticsFlag.mjs): `en` while the vault is private ("opening soon"), `enOpen` once it is
 * open. agenticsCopy(flag) picks one. Both are held to the same wording rules in
 * tests/agentics/doorCopy.test.ts, so flipping the flag cannot put a claim on the page that no test has read.
 */

/** The plan a free account gets once the vault opens. Not enforced anywhere yet: the vault is not open. */
export const FREE_BOTS = 3;
export const FREE_ADDRESSES = 15;

/** A link in a letter: the words beside it in the text version, the words on its button, and the path on this site. */
export interface LetterLink {
  readonly text: string;
  readonly button: string;
  readonly path: string;
}

/** A letter as the page shows it and the email sends it. */
export interface Letter {
  readonly subject: string;
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly links: readonly LetterLink[];
  readonly signoff: readonly string[];
  readonly why: string;
}

/** Every string the door shows, in either state. */
export interface AgenticsCopy {
  readonly lang: string;
  readonly brand: string;
  readonly landing: {
    readonly title: string;
    readonly description: string;
    readonly eyebrow: string;
    readonly h1: string;
    readonly sub: string;
    readonly ctaPrimary: string;
    readonly ctaSecondary: string;
    readonly finePrint: string;
    readonly status: { readonly liveLabel: string; readonly liveText: string; readonly soonLabel: string; readonly soonText: string };
    readonly stepsTitle: string;
    readonly steps: ReadonlyArray<{ readonly tag: string; readonly live: boolean; readonly title: string; readonly body: string }>;
    readonly staysTitle: string;
    readonly stays: readonly string[];
    readonly plansTitle: string;
    readonly plans: ReadonlyArray<{ readonly name: string; readonly status: string; readonly body: string }>;
    readonly footer: string;
    readonly footerLinks: { readonly docs: string; readonly checker: string; readonly privacy: string };
  };
  readonly login: {
    readonly title: string;
    readonly pageTitle: string;
    readonly blurb: string;
    readonly foot: string;
    readonly docsLink: string;
    readonly trust: readonly string[];
  };
  readonly welcome: {
    readonly title: string;
    readonly h1: string;
    readonly lead: string;
    readonly copySent: string;
    readonly todayTitle: string;
    readonly today: ReadonlyArray<{ readonly href: string; readonly text: string }>;
    readonly signOut: string;
  };
  readonly letter: Letter;
}

export const en: AgenticsCopy = {
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
      { href: '/agentics/account', text: 'See your account, or delete it.' },
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
    links: [{ text: 'API docs', button: 'Read the API docs', path: '/agentics/docs' }],
    signoff: ['Donnie', 'Almstins'],
    why: 'You are getting this because you created an Agentics account at almstins.com. It is the only email we will send until your vault opens.',
  },
};

/**
 * The door once the vault is open to every account. It differs from `en` only where "opening soon"
 * stops being true: the steps are live, the sign-up note, the plan line and the letter a new account
 * gets. Chains are named because the record is read from those and no others. Not shown until the flag
 * that opens the Vault is flipped.
 */
export const enOpen: AgenticsCopy = {
  ...en,
  landing: {
    ...en.landing,
    finePrint: 'Free to sign up. Your vault opens the moment you do.',
    status: {
      liveLabel: 'Live today',
      liveText: 'the pre-send check (one request, no login), the free address checker, and your vault.',
      soonLabel: 'Coming later',
      soonText: 'paid plans, for more bots and addresses. Nothing to buy today.',
    },
    steps: [
      { ...en.landing.steps[0], tag: 'Live', live: true },
      { ...en.landing.steps[1] },
      {
        tag: 'Live',
        live: true,
        title: 'You get the record',
        body: 'Each check becomes a dated entry on your bot’s page. Once a day Agentics reads Ethereum, Polygon and Avalanche for transfers between your bot’s wallet and the addresses you registered, ties each one to the check that came before it, and makes a report you can download as a signed PDF.',
      },
    ],
    plans: [
      { name: 'Free', status: 'Open now', body: `${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses.` },
      { name: 'Paid plans', status: 'Coming later', body: 'Nothing to buy today.' },
    ],
  },
  login: {
    ...en.login,
    blurb: 'Create your free account and your vault is ready right away.',
  },
  letter: {
    subject: 'Your vault is open: Almstins Agentics',
    greeting: 'Hi,',
    paragraphs: [
      'Thanks for signing up for Almstins Agentics. Agentics checks the address an AI agent is about to send to, and keeps a dated record of what it answered. We verify, warn and flag. We never hold keys, and we are never in the transaction.',
      `Your vault is open. Add a bot, list the addresses it may pay, and point its key at the pre-send check. Your free plan covers ${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses. Paid plans come later; there is nothing to buy today.`,
      'Each check appears on your bot’s page when the agent asks. Transfers appear once a day, or when you press Read the chain, for Ethereum, Polygon and Avalanche.',
      'If you run agents that move money, reply and tell me what they do and which chains they use. I read every reply, and it decides what I build first.',
    ],
    links: [
      { text: 'Your vault', button: 'Open your vault', path: '/dashboard/agentics' },
      { text: 'API docs', button: 'Read the API docs', path: '/agentics/docs' },
    ],
    signoff: ['Donnie', 'Almstins'],
    why: 'You are getting this because you created an Agentics account at almstins.com. We send a welcome like this once, and reports only if you turn them on.',
  },
};

/**
 * The one email that goes to everyone who signed up while the vault was private, the day it opens
 * (the privacy policy's "one email when the vault opens"). Sent once per account by the admin action
 * (src/pages/api/admin/agentics-opening.ts), and never before the vault is open.
 */
export const opening = {
  subject: 'Your Agentics vault is open',
  heading: 'Your vault is open.',
  letter: {
    subject: 'Your Agentics vault is open',
    greeting: 'Hi,',
    paragraphs: [
      'You signed up for Almstins Agentics before the vault opened, and I said I would write once, when it did. It is open.',
      `Your free plan covers ${FREE_BOTS} bots and ${FREE_ADDRESSES} addresses. You add a bot, list the addresses it may pay (each is checked against sanctions lists, scam screening and domain proofs when you add it), and point the bot’s key at the pre-send check. Each check becomes a dated entry on your bot’s page. Once a day, transfers between the bot’s wallet and your registered addresses are read from Ethereum, Polygon and Avalanche and tied to the check that came before them, and you can download a signed PDF report. Paid plans come later; there is nothing to buy today.`,
      'If you run agents that move money, reply and tell me what they do and which chains they use. I read every reply, and it decides what I build first.',
    ],
    links: [
      { text: 'Your vault', button: 'Open your vault', path: '/dashboard/agentics' },
      { text: 'API docs', button: 'Read the API docs', path: '/agentics/docs' },
    ],
    signoff: ['Donnie', 'Almstins'],
    why: 'You are getting this because you created an Agentics account at almstins.com before the vault opened. It is the one email we said we would send when it did, and we will not email you about it again.',
  } satisfies Letter,
} as const;

/** The door's words for the state the Vault is in: `enOpen` once it is open to every account, else `en`. */
export function agenticsCopy(open: boolean): AgenticsCopy {
  return open ? enOpen : en;
}
