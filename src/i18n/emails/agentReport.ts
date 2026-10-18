// Agent Vault operator report emails: the digest and the real-time alert. English only for now:
// the Agent Vault is owner-only and its surfaces are not translated yet, so every language gets the
// English text (getAgentReportEmail never returns anything else).
//
// What these emails carry, and do not. The SUBJECT leads with whether anything needs a person:
// "2 need your attention", or a quiet "All clear, 1,284 verified". The BODY is counts and a link to
// the Reports page, behind the sign-in. It never carries a wallet address, a label (an address's or
// an agent's) or an amount of money: an email is less private than the dashboard, and the detail
// is sensitive. tests/agentics/digest.test.ts renders every state with addresses, labels and
// amounts in the report and checks none of them comes out.
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
  /** The site's address, e.g. "https://almstins.com". */
  appBase: string;
}

export interface AlertEmailArgs {
  appBase: string;
}

export interface AgentReportEmailLocale {
  lang: Lang;
  digest: (a: DigestEmailArgs) => RenderedEmail;
  alert: (a: AlertEmailArgs) => RenderedEmail;
}

/** The site's address: APP_URL, else AUTH_URL, else the product's own, without a trailing slash. */
export const defaultAppBase = (): string => (process.env.APP_URL ?? process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');

/** The page the emails point to: the Reports page, behind the sign-in. */
export const reportsLink = (appBase: string): string => `${appBase.replace(/\/+$/, '')}/dashboard/agentics/reports`;

const attentionLead = (n: number): string => `${formatCount(n)} ${n === 1 ? 'needs' : 'need'} your attention`;

/** The subject's first words: whether action is needed. */
export function digestLead(a: Pick<DigestEmailArgs, 'issues' | 'notConfirmed' | 'clearChecks'>): string {
  const attention = a.issues + a.notConfirmed;
  if (attention > 0) return attentionLead(attention);
  if (a.clearChecks > 0) return `All clear, ${formatCount(a.clearChecks)} verified`;
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
      `Checks that came back proven or consistent with history: ${formatCount(a.clearChecks)}`,
      `Agents with activity: ${formatCount(a.agents)}`,
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

  alert: ({ appBase }) => ({
    subject: 'Action needed: a check on a registered address came back flagged',
    text: [
      `One of your agents asked about an address on its registry, and the check came back flagged.`,
      ``,
      `A person should look at it before anything is sent to that address. Almstins flags and records. It does not hold or move funds and is never in the payment path.`,
      ``,
      `This email does not show the address. Open the Reports page, behind your sign-in, to see it:`,
      reportsLink(appBase),
      ``,
      `You are getting this because you turned on flagged-check emails. You get at most one an hour for the same address. To turn them off, open the Reports page.`,
      ``,
      `Almstins`,
    ].join('\n'),
  }),
};

const MAP: Record<Lang, AgentReportEmailLocale> = { en, es: en, fr: en };

export function getAgentReportEmail(lang: Lang): AgentReportEmailLocale {
  return MAP[lang] ?? en;
}
