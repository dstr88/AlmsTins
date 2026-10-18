/**
 * The daily report job: make yesterday's report for every agent that did anything, then send each
 * account that asked for one its digest. Run once a day, after the chain watcher
 * (.github/workflows/agent-reports.yml, GET /api/cron/agent-reports), because a transfer is only in
 * the ledger once the watcher has recorded it.
 *
 *   1. Reports. For each live tin that had any event yesterday, make its report (./reports.ts).
 *      Making a report can be repeated as often as you like: when nothing changed it writes
 *      nothing, so a manual re-run, or two runs at once, leave one version. Reports are made for EVERY account,
 *      whatever its email settings: the Reports page is the record, and email is only a pointer.
 *   2. Digests. For each account that turned a digest on, work out the period for its cadence,
 *      the numbers, and whether it is worth sending (./digest.ts); then the verified operator
 *      email (resolveAlertRecipient), a claim that this digest has not gone out already, and the
 *      send. An account that never opted in is never read for this and never sent anything. A
 *      send that fails gives its claim back, so a re-run the same day tries again.
 *
 * It stops starting new work when its deadline passes and says so (`truncated`), and picks up the
 * next day. A failure on one agent or one account never stops the rest. The summary is numbers
 * and true/false only: the workflow prints it in a public log, so it names no account or agent.
 *
 * Runs one account after another, tin after tin, always in the same order. That is right for a few
 * dozen accounts (a day with no activity costs one indexed read per tin). With hundreds, run the
 * tins in small parallel batches, and start each day at a different place so a deadline that cuts
 * the run short never starves the same accounts every day.
 */
import { sendMail } from '@/lib/email';
import { defaultAppBase } from '@/i18n/emails/agentReport';
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { claimDigest, listOptedIn, releaseDigest } from './deliveryStore';
import { hasEventsInRange, readEventsInRange } from './events';
import { addDays, dayBounds, ReportBuilder, utcDay, type ReportContent } from './report';
import { composeDigest, countsOf, digestPeriod, shouldSend, type DigestCounts, type DigestPeriod } from './digest';
import { defaultReportDeps, generateReport, type ReportDeps } from './reports';
import { listLatestReportsForPeriod } from './reportStore';
import { getTin, listAllTins, listTins } from './store';

/** The most tins and accounts one run reads. */
export const MAX_JOB_TINS = 5_000;
export const MAX_JOB_ACCOUNTS = 5_000;

export interface JobDeps {
  reports: ReportDeps;
  /** The verified operator email for an account, or null. */
  recipient: (tenantId: string) => Promise<string | null>;
  send: (mail: { to: string; subject: string; text: string }) => Promise<void>;
  /** The site's address, for the link in the email. */
  appBase: string;
}

export const defaultJobDeps = (): JobDeps => ({
  reports: defaultReportDeps,
  recipient: async (tenantId) => (await resolveAlertRecipient(tenantId)).email,
  send: (mail) => sendMail(mail),
  appBase: defaultAppBase(),
});

export interface JobSummary {
  /** Tins visited, and how many had activity yesterday. */
  tins: number;
  active: number;
  /** Reports newly written, and ones that already said the same. */
  created: number;
  unchanged: number;
  failedReports: number;
  /** Accounts that asked for a digest. */
  optedIn: number;
  sent: number;
  /** Nothing to say, or nothing that needs a look (for `issues`). */
  notNeeded: number;
  noRecipient: number;
  /** A digest for this period had already gone out. */
  alreadySent: number;
  failedSends: number;
  /** True when the deadline ended the run before every tin and account was visited. */
  truncated: boolean;
}

export const emptySummary = (): JobSummary => ({
  tins: 0, active: 0, created: 0, unchanged: 0, failedReports: 0, optedIn: 0, sent: 0, notNeeded: 0, noRecipient: 0, alreadySent: 0, failedSends: 0, truncated: false,
});

function logFailure(stage: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-reports] step failed', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/** The numbers of an account's weekly digest: the seven days, read from the ledger, one agent at a time. */
async function weeklyCounts(tenantId: string, period: DigestPeriod): Promise<DigestCounts> {
  const range = { fromIso: dayBounds(period.from).start, toIso: dayBounds(period.to).end };
  const contents: ReportContent[] = [];
  for (const tin of await listTins(tenantId)) {
    const builder = new ReportBuilder({ tin: { id: tin.id, label: '' }, period: { start: range.fromIso, end: range.toIso, partial: false } });
    await readEventsInRange(tenantId, tin.id, range, (event) => builder.add(event));
    contents.push(builder.finish());
  }
  return countsOf(contents);
}

/** The numbers of an account's daily or issues digest: the day's newest report of each agent. */
async function dayCounts(tenantId: string, period: DigestPeriod): Promise<DigestCounts> {
  const stored = await listLatestReportsForPeriod(tenantId, dayBounds(period.from).start);
  return countsOf(stored.map((r) => r.content));
}

export async function runAgentReports(deps: JobDeps = defaultJobDeps(), opts: { deadlineAt?: number } = {}): Promise<JobSummary> {
  const summary = emptySummary();
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const out = () => deps.reports.now().getTime() >= deadlineAt;
  const today = utcDay(deps.reports.now());
  const reportDay = addDays(today, -1);
  const bounds = dayBounds(reportDay);

  // ── 1. Yesterday's report for every agent that did anything ────────────────
  for (const target of await listAllTins(MAX_JOB_TINS)) {
    if (out()) {
      summary.truncated = true;
      break;
    }
    try {
      const tin = await getTin(target.tenantId, target.tinId);
      if (!tin) continue;
      summary.tins += 1;
      if (!(await hasEventsInRange(target.tenantId, tin.id, { fromIso: bounds.start, toIso: bounds.end }))) continue;
      summary.active += 1;
      const made = await generateReport(target.tenantId, tin, reportDay, deps.reports);
      if (made.created) summary.created += 1;
      else summary.unchanged += 1;
    } catch (err) {
      logFailure('report', err);
      summary.failedReports += 1;
    }
  }

  // ── 2. The digests, for the accounts that asked ────────────────────────────
  for (const account of await listOptedIn(MAX_JOB_ACCOUNTS)) {
    if (out()) {
      summary.truncated = true;
      break;
    }
    summary.optedIn += 1;
    try {
      const period = digestPeriod(account.cadence, today);
      if (account.lastDigestKey === period.key) {
        summary.alreadySent += 1;
        continue;
      }
      const counts = period.kind === 'week' ? await weeklyCounts(account.tenantId, period) : await dayCounts(account.tenantId, period);
      if (!shouldSend(account.cadence, counts)) {
        summary.notNeeded += 1;
        continue;
      }
      const to = await deps.recipient(account.tenantId);
      if (!to) {
        summary.noRecipient += 1;
        continue;
      }
      if (!(await claimDigest(account.tenantId, period.key))) {
        summary.alreadySent += 1;
        continue;
      }
      const mail = composeDigest(period, counts, deps.appBase);
      try {
        await deps.send({ to, subject: mail.subject, text: mail.text });
        summary.sent += 1;
      } catch (err) {
        logFailure('send', err);
        summary.failedSends += 1;
        await releaseDigest(account.tenantId, period.key, account.lastDigestKey);
      }
    } catch (err) {
      logFailure('digest', err);
      summary.failedSends += 1;
    }
  }
  return summary;
}
