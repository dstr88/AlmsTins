/**
 * The digest an account asked for: which period it covers, what its numbers are, whether it is
 * worth sending, and the text. Pure (no database, no clock, no network), so every rule is a unit
 * test. Sending it, and keeping it from going out twice, are ./reportJob.ts and ./deliveryStore.ts.
 *
 * Three cadences, all opt-in (an account that has chosen none is sent nothing):
 *   daily   yesterday's report, every day the agents did anything.
 *   weekly  a roll-up of the seven UTC days before this week began (Monday to Sunday), sent on the
 *           first run on or after Monday that has not sent it yet. Its numbers are the report's
 *           own rule over the seven days: each address once, in its most severe group any of its
 *           checks fell in during the week.
 *   issues  yesterday's report, but only when it needs a person: at least one address that had
 *           issues or was not confirmed. A quiet day sends nothing.
 *
 * The subject leads with whether action is needed, and the body is counts and a link. It carries
 * no address, no label (an address's or an agent's) and no amount (src/i18n/emails/agentReport.ts).
 */
import { getAgentReportEmail, type DigestEmailArgs, type RenderedEmail } from '@/i18n/emails/agentReport';
import { addDays, headlineOf, type ReportContent } from './report';
import type { Cadence } from './deliveryStore';

export type DigestCadence = Exclude<Cadence, 'off'>;

/** What a digest says in numbers: addresses per group, the clear checks, and how many agents had activity. */
export interface DigestCounts {
  agents: number;
  issues: number;
  notConfirmed: number;
  new: number;
  /** Addresses whose every check in the period was clear. */
  noIssues: number;
  /** All checks, and the ones that came back proven or consistent with history. */
  checks: number;
  noIssuesChecks: number;
}

export const emptyCounts = (): DigestCounts => ({ agents: 0, issues: 0, notConfirmed: 0, new: 0, noIssues: 0, checks: 0, noIssuesChecks: 0 });

/** The sum of several agents' reports over one period. An agent with no events in the period is not counted as having activity. */
export function countsOf(contents: readonly ReportContent[]): DigestCounts {
  const c = emptyCounts();
  for (const content of contents) {
    const h = headlineOf(content);
    if (h.checks === 0 && h.transfers === 0) continue;
    c.agents += 1;
    c.issues += h.issues;
    c.notConfirmed += h.notConfirmed;
    c.new += h.new;
    c.noIssues += h.noIssues;
    c.checks += h.checks;
    c.noIssuesChecks += h.noIssuesChecks;
  }
  return c;
}

/** Addresses that call for a look: had issues plus not confirmed. New and clear addresses do not. */
export const attentionOf = (c: Pick<DigestCounts, 'issues' | 'notConfirmed'>): number => c.issues + c.notConfirmed;

/**
 * Whether a digest is worth sending for these numbers. Nothing to say (no agent had any activity)
 * is never sent; `issues` is sent only when something needs a look; the others, whenever there was activity.
 */
export function shouldSend(cadence: DigestCadence, counts: DigestCounts): boolean {
  if (counts.agents === 0) return false;
  return cadence === 'issues' ? attentionOf(counts) > 0 : true;
}

/** What a digest covers: the first and last UTC day, and the key that names it so it is sent once. */
export interface DigestPeriod {
  kind: 'day' | 'week';
  from: string;
  to: string;
  key: string;
}

/** The Monday on or before `day` (a UTC day, `YYYY-MM-DD`). */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((dow + 6) % 7));
}

/**
 * The period a digest covers when the job runs on `today`: for daily and issues, yesterday; for
 * weekly, the seven days before this week began. The key is the cadence and the first day, so a
 * digest is sent once for a period however many times the job runs, and changing cadence never
 * suppresses the first digest of the new one.
 */
export function digestPeriod(cadence: DigestCadence, today: string): DigestPeriod {
  if (cadence === 'weekly') {
    const to = addDays(mondayOf(today), -1);
    const from = addDays(to, -6);
    return { kind: 'week', from, to, key: `weekly:${from}` };
  }
  const day = addDays(today, -1);
  return { kind: 'day', from: day, to: day, key: `${cadence}:${day}` };
}

/** The email for a digest: the subject that leads with whether action is needed, and the text. */
export function composeDigest(period: Pick<DigestPeriod, 'kind' | 'from' | 'to'>, counts: DigestCounts, appBase: string): RenderedEmail {
  const args: DigestEmailArgs = {
    kind: period.kind,
    from: period.from,
    to: period.to,
    agents: counts.agents,
    issues: counts.issues,
    notConfirmed: counts.notConfirmed,
    new: counts.new,
    clearChecks: counts.noIssuesChecks,
    appBase,
  };
  return getAgentReportEmail('en').digest(args);
}
