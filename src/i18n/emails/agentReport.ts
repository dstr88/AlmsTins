// Agent Vault operator report emails: the digest and the real-time alert. English only for now:
// the Agent Vault is owner-only and its surfaces are not translated yet, so every language gets the
// English text (getAgentReportEmail never returns anything else).
//
// What these emails carry, and do not. The SUBJECT leads with whether anything needs a person:
// "2 need your attention", or a quiet "No flags, 1,284 checks". It never says "verified": a check
// that came back established (consistent-with-history) has not been verified, only not flagged. The BODY is
// counts and a link to the Reports page, behind the sign-in. It never carries a wallet address, a
// label (an address's or an agent's) or an amount of money: an email is less private than the
// dashboard, and the detail is sensitive. tests/agentics/digest.test.ts renders every state with
// addresses, labels and amounts in the report and checks none of them comes out.
//
// Almstins verifies, flags and records. These words never say it stops or holds anything, and
// never call an address safe. Same pattern as the other email templates: render(args) -> { subject, text }.

import type { Lang } from '@/lib/i18n/locale';
import { formatCount, formatDayLong, formatDayShort } from '@/lib/agentVault/reportFormat';

export interface RenderedEmail {
  subject: string;
  text: string;
}

export interface DigestEmailArgs {
  /** `day` is one report day; `week` is a roll-up of seven. */
  kind: 'day' | 'week';
  /** The first and last UTC day covered, `YYYY-MM-DD` (the same day for a `day`). */
  from: string;
  to: string;
  /** Agents that had activity in the period. */
  agents: number;
  /** Addresses per group. */
  issues: number;
  notConfirmed: number;
  new: number;
  /** Checks that came back proven or consistent with history. */
  clearChecks: number;
  /** Agents that reached their daily limit of recorded checks in the period. */
  limited: number;
  /** The site's address, e.g. "https://almstins.com". */
  appBase: string;
}

/** What the check was answered, as the alert names it (src/lib/agentVault/alerts.ts AlertKind). */
export type AlertEmailKind = 'mismatch' | 'flagged' | 'screening' | 'not_on_list' | 'pending' | 'unanchored' | 'unknown' | 'disputed' | 'established' | 'unmatched';

export interface AlertEmailArgs {
  appBase: string;
  kind: AlertEmailKind;
  /** The agent's id: an unmatched-payment email links to the agent's page. An id, never a name. */
  tinId?: string;
  /** For an unmatched-payment email: how many unmatched payments to the address it covers (a count, never an amount). */
  payments?: number;
  /** For an unmatched-payment email: whether an earlier one went for this address, so the count runs from it. */
  sinceLast?: boolean;
}

/** For each answer: the word the subject names it by, and the sentence that says what happened. Never an address, a label or an amount. */
const ALERT_WORDS: Record<AlertEmailKind, { word: string; what: string }> = {
  mismatch: { word: 'Mismatch', what: 'One of your agents asked about an address, and a domain other than the one it expected vouches for that address.' },
  flagged: { word: 'Flagged', what: 'One of your agents asked about an address that is flagged in its registry.' },
  screening: { word: 'Flagged', what: 'One of your agents asked about an address, and the sanctions or security screening Almstins ran on it at that moment found something.' },
  not_on_list: { word: 'Not on the list', what: 'One of your agents asked about an address that is not on its list.' },
  pending: { word: 'Pending', what: 'One of your agents asked about an address on its list whose checks have not finished.' },
  unanchored: { word: 'Unanchored', what: 'One of your agents asked about an address on its list for the first time. Someone proved control of the address, but no domain currently vouches for it.' },
  unknown: { word: 'Unknown', what: 'One of your agents asked about an address on its list for the first time, and no proof of that address is on record.' },
  disputed: { word: 'Disputed', what: 'One of your agents asked about an address that two Almstins accounts stand behind, a platform\'s published list and another account\'s proof, or two lists. It answers unknown until one of them withdraws.' },
  established: { word: 'Established', what: 'One of your agents asked about an address on its list that it has asked about before, and nothing flagged it. Established means the same address as before, not proof of ownership.' },
  unmatched: { word: 'Unmatched', what: "One of your agents' wallets sent a payment to an address that is not on its list, and the agent asked no check about that address in the hour before." },
};

export interface AgentReportEmailLocale {
  lang: Lang;
  digest: (a: DigestEmailArgs) => RenderedEmail;
  alert: (a: AlertEmailArgs) => RenderedEmail;
}

/** The site's address: APP_URL, else AUTH_URL, else the product's own, without a trailing slash. */
export const defaultAppBase = (): string => (process.env.APP_URL ?? process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');

/** The page the emails point to: the Reports page, behind the sign-in. */
export const reportsLink = (appBase: string): string => `${appBase.replace(/\/+$/, '')}/dashboard/agentics/reports`;

/** How many unmatched payments an email covers, as a sentence: a count, never an amount. */
export const unmatchedCountLine = (n: number, sinceLast: boolean): string =>
  `Your agent made ${formatCount(n)} ${n === 1 ? 'payment' : 'payments'} to this address without a check first${sinceLast ? ' since our last email' : ''}.`;

/** One agent's page, behind the sign-in: where an unmatched-payment email sends the operator. The agent's id only, never its name. */
export const agentLink = (appBase: string, tinId: string): string => `${appBase.replace(/\/+$/, '')}/dashboard/agentics/tins/${encodeURIComponent(tinId)}`;

const attentionLead = (n: number): string => `${formatCount(n)} ${n === 1 ? 'needs' : 'need'} your attention`;

/** The subject's first words: whether action is needed. */
export function digestLead(a: Pick<DigestEmailArgs, 'issues' | 'notConfirmed' | 'clearChecks'> & { limited?: number }): string {
  const attention = a.issues + a.notConfirmed;
  if (attention > 0) return attentionLead(attention);
  // A day the daily limit cut is not described as all checks: only the recorded ones were looked at.
  if (a.clearChecks > 0) {
    const noun = a.clearChecks === 1 ? 'check' : 'checks';
    return (a.limited ?? 0) > 0 ? `No flags, ${formatCount(a.clearChecks)} recorded ${noun}` : `No flags, ${formatCount(a.clearChecks)} ${noun}`;
  }
  return 'Nothing needs your attention';
}

const periodText = (a: Pick<DigestEmailArgs, 'kind' | 'from' | 'to'>): { subject: string; long: string } => {
  const year = a.to.slice(0, 4);
  if (a.kind === 'day' || a.from === a.to) return { subject: `${formatDayShort(a.to)}, ${year}`, long: formatDayLong(a.to) };
  return { subject: `${formatDayShort(a.from)} to ${formatDayShort(a.to)}, ${year}`, long: `${formatDayLong(a.from)} to ${formatDayLong(a.to)}` };
};

export const en: AgentReportEmailLocale = {
  lang: 'en',

  digest: (a) => {
    const when = periodText(a);
    const attention = a.issues + a.notConfirmed;
    const lines = [
      `Agent report for ${when.long} (UTC)`,
      ``,
      attention > 0 ? `${attentionLead(attention)}.` : `Nothing needs your attention.`,
    ];
    if (attention > 0) {
      lines.push(`  Had issues: ${formatCount(a.issues)}`, `  Not confirmed: ${formatCount(a.notConfirmed)}`);
    }
    lines.push(
      `New (first check of a registered address): ${formatCount(a.new)}`,
      `Checks that came back proven or established: ${formatCount(a.clearChecks)}`,
      `Agents with activity: ${formatCount(a.agents)}`,
      ...(a.limited > 0
        ? [
            ``,
            `${formatCount(a.limited)} ${a.limited === 1 ? 'agent' : 'agents'} reached the daily limit of recorded checks. Checks after that were answered and not recorded, except ones that came back flagged, so the counts above cover the recorded checks.`,
          ]
        : []),
      ``,
      `View the full report (sign-in required):`,
      reportsLink(a.appBase),
      ``,
      `This email carries counts only. Addresses, labels and amounts stay behind your sign-in.`,
      `A clear result means the checks that ran came back without a flag. It is not a statement that an address is safe.`,
      ``,
      `You are getting this because you turned on report emails. To change how often, or to turn them off, open the Reports page.`,
      ``,
      `Almstins`,
    );
    return { subject: `${digestLead(a)} · Agent report, ${when.subject}`, text: lines.join('\n') };
  },

  alert: ({ appBase, kind, tinId, payments, sinceLast }) => {
    const w = ALERT_WORDS[kind] ?? ALERT_WORDS.unknown;
    const established = kind === 'established';
    if (kind === 'unmatched') {
      return {
        subject: 'Action needed: an agent paid an address it never asked about',
        text: [
          w.what,
          ``,
          unmatchedCountLine(payments ?? 1, sinceLast === true),
          ``,
          `A person should look at it. The payment has already gone out on the chain. Almstins flags and records. It does not hold or move funds and is never in the payment path.`,
          ``,
          `This email does not show the address or the amount. Open the agent's page, behind your sign-in, to see it:`,
          tinId ? agentLink(appBase, tinId) : reportsLink(appBase),
          ``,
          `Almstins emails you about every payment an agent makes to an address that is not on its list without asking about it first, at most one an hour for the same address.`,
          ``,
          `Almstins`,
        ].join('\n'),
      };
    }
    return {
      subject: established ? 'A check came back Established' : `Action needed: a check came back ${w.word}`,
      text: [
        w.what,
        ``,
        established
          ? `No action is needed. Almstins flags and records. It does not hold or move funds and is never in the payment path.`
          : `A person should look at it before anything is sent to that address. Almstins flags and records. It does not hold or move funds and is never in the payment path.`,
        ``,
        `This email does not show the address. Open the Reports page, behind your sign-in, to see it:`,
        reportsLink(appBase),
        ``,
        established
          ? `You are getting this because you turned on Established emails. You get at most one an hour for the same address. To turn them off, open the Reports page.`
          : `Almstins emails you about every check that does not come back proven or established, at most one an hour for the same address.`,
        ``,
        `Almstins`,
      ].join('\n'),
    };
  },
};

const MAP: Record<Lang, AgentReportEmailLocale> = { en, es: en, fr: en };

export function getAgentReportEmail(lang: Lang): AgentReportEmailLocale {
  return MAP[lang] ?? en;
}
