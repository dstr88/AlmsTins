/**
 * The daily report job: make the report of each of the last three days for every agent that did
 * anything, then send each account that asked for one its digest of yesterday. Run once a day,
 * after the chain watcher (.github/workflows/agent-reports.yml, GET /api/cron/agent-reports),
 * because a transfer is only in the ledger once the watcher has recorded it.
 *
 *   1. Reports. For each live tin, and for each of the last three UTC days (yesterday and the two
 *      before) on which it had any event, make its report (./reports.ts). Three days, so one run
 *      that never happened, or one that was cut short, does not lose a day: the next run makes it.
 *      Making a report can be repeated as often as you like: when nothing changed it writes
 *      nothing, so a manual re-run, or two runs at once, leave one version. Reports are made for
 *      EVERY account, whatever its email settings: the Reports page is the record, and email is
 *      only a pointer.
 *   2. Digests. For each account that turned a digest on, work out the period for its cadence,
 *      the numbers, and whether it is worth sending (./digest.ts); then the verified operator
 *      email (resolveAlertRecipient), a claim that this digest has not gone out already, and the
 *      send. An account that never opted in is never read for this and never sent anything. The
 *      digest is for yesterday (or the week before) only, whatever the reports were made for. A
 *      send that fails gives its claim back, so a re-run the same day tries again.
 *
 * It stops starting new work when its deadline passes and says so (`truncated`), and picks up the
 * next day. A failure on one agent or one account never stops the rest. The summary is numbers
 * and true/false only: the workflow prints it in a public log, so it names no account or agent.
 * The workflow goes red when the summary reports a failed report, a failed send or a truncated run.
 *
 * Runs one account after another, tin after tin. The accounts are taken in an order that changes
 * every day (sha256 of the day and the account id), so a deadline that cuts the run short does
 * not starve the same accounts every day. That is right for a few dozen accounts (a day with no
 * activity costs one indexed read per tin per day). With hundreds, run the tins in small parallel
 * batches.
 */
import { createHash } from 'node:crypto';
import { defaultAppBase } from '@/i18n/emails/agentReport';
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { claimDigest, listOptedIn, releaseDigest } from './deliveryStore';
import { hasEventsInRange, readEventsInRange } from './events';
import { sendVaultMail } from './mailer';
import { addDays, dayBounds, ReportBuilder, utcDay, type ReportContent } from './report';
import { composeDigest, countsOf, digestPeriod, shouldSend, type DigestCounts, type DigestPeriod } from './digest';
import { defaultReportDeps, generateReport, type ReportDeps } from './reports';
import { listLatestReportsForPeriod } from './reportStore';
import { getTin, listAllTins, listTins, type Tin, type WatchTarget } from './store';

/** The most tins and accounts one run reads. */
export const MAX_JOB_TINS = 5_000;
export const MAX_JOB_ACCOUNTS = 5_000;

/** How many UTC days a run makes reports for: yesterday and the days before it. */
export const REPORT_DAYS = 3;

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
  send: sendVaultMail,
  appBase: defaultAppBase(),
});

export interface JobSummary {
  /** Tins visited. */
  tins: number;
  /** Reports looked at, one per tin and day (the last three days of each tin) on which the tin had any event. */
  active: number;
  /** Of those, newly written, and ones that already said the same. */
  created: number;
  unchanged: number;
  failedReports: number;
  /** Accounts that asked for a digest. */
  optedIn: number;
  sent: number;
  /** Nothing to say, or nothing that needs a look (for `issues`). */
  notNeeded: number;
  noRecipient: number;
  /** A digest for this period had already gone out, or the account changed its settings while the run was under way. */
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

/**
 * The tins in the order this run takes them: accounts by the sha256 of the run's day and the
 * account id, so the order changes every day and is the same for every run of one day. The tins
 * of one account stay together, in the order they came in. A deadline that ends a run early then
 * leaves a different account unvisited each day, not the same tail every day.
 */
export function orderForDay<T extends Pick<WatchTarget, 'tenantId'>>(targets: readonly T[], day: string): T[] {
  const ranks = new Map<string, string>();
  const rankOf = (tenantId: string): string => {
    let rank = ranks.get(tenantId);
    if (rank === undefined) ranks.set(tenantId, (rank = createHash('sha256').update(day + tenantId).digest('hex')));
    return rank;
  };
  return targets
    .map((target, index) => ({ target, index, rank: rankOf(target.tenantId) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.index - b.index))
    .map((x) => x.target);
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

/**
 * The numbers of an account's daily or issues digest: the day's newest report of each agent. Only
 * the agents the account still has, like the weekly digest: a removed agent's report stays on file
 * but is no longer the account's to be told about.
 */
async function dayCounts(tenantId: string, period: DigestPeriod): Promise<DigestCounts> {
  const live = new Set((await listTins(tenantId)).map((tin) => tin.id));
  const stored = await listLatestReportsForPeriod(tenantId, dayBounds(period.from).start);
  return countsOf(stored.filter((r) => live.has(r.tinId)).map((r) => r.content));
}

export async function runAgentReports(deps: JobDeps = defaultJobDeps(), opts: { deadlineAt?: number } = {}): Promise<JobSummary> {
  const summary = emptySummary();
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const out = () => deps.reports.now().getTime() >= deadlineAt;
  const today = utcDay(deps.reports.now());
  const reportDay = addDays(today, -1);
  const reportDays = Array.from({ length: REPORT_DAYS }, (_, i) => addDays(reportDay, -i)); // newest first

  // ── 1. The last three days' reports for every agent that did anything ──────
  reports: for (const target of orderForDay(await listAllTins(MAX_JOB_TINS), today)) {
    if (out()) {
      summary.truncated = true;
      break;
    }
    let tin: Tin | null;
    try {
      tin = await getTin(target.tenantId, target.tinId);
    } catch (err) {
      logFailure('report', err);
      summary.failedReports += 1;
      continue;
    }
    if (!tin) continue;
    summary.tins += 1;
    for (const day of reportDays) {
      if (out()) {
        summary.truncated = true;
        break reports;
      }
      try {
        const bounds = dayBounds(day);
        if (!(await hasEventsInRange(target.tenantId, tin.id, { fromIso: bounds.start, toIso: bounds.end }))) continue;
        summary.active += 1;
        const made = await generateReport(target.tenantId, tin, day, deps.reports);
        if (made.created) summary.created += 1;
        else summary.unchanged += 1;
      } catch (err) {
        logFailure('report', err);
        summary.failedReports += 1;
      }
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
      if (!(await claimDigest(account.tenantId, period.key, account.cadence))) {
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
