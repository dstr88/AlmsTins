/**
 * What the Reports pages (src/pages/dashboard/agentics/) load before they render: the account's
 * tins with their newest reports, and one report with its versions. The pages call these straight
 * from their frontmatter, never through their own API (a server page does not fetch itself).
 *
 * Every function takes the tenant first, from the session, and never from the request. The shapes
 * are plain objects, so a page can hand them to a component as props.
 */
import { getSigningKey } from '@/lib/recordProof/signing';
import { addDays, utcDay } from './report';
import { getReportSettings, type ReportSettings } from './delivery';
import { createdDay, DEFAULT_REPORT_PAGE, getReportDetail, listItemOf, type ReportDetail, type ReportListItem } from './reports';
import { listLatestReports } from './reportStore';
import { listTins } from './store';

export interface ReportsPageTin {
  id: string;
  label: string;
  /** The UTC day the agent was created: the first day it can have a report. */
  since: string;
  /** Its newest reports, one per day, newest day first. */
  reports: ReportListItem[];
}

export interface ReportsPageData {
  /** The UTC day today, and the one before it (what the daily job reports on). */
  today: string;
  yesterday: string;
  /** Whether this server can sign a report: with no signing key, reports are made unsigned. */
  signing: { available: boolean };
  tins: ReportsPageTin[];
  /** How the account hears about its agents: its settings, and whether there is an address to send to. */
  delivery: { settings: ReportSettings; recipientAvailable: boolean };
}

export async function loadReportsPage(tenantId: string, now: Date = new Date()): Promise<ReportsPageData> {
  const today = utcDay(now);
  const tins: ReportsPageTin[] = [];
  for (const tin of await listTins(tenantId)) {
    const reports = await listLatestReports(tenantId, tin.id, { limit: DEFAULT_REPORT_PAGE });
    tins.push({ id: tin.id, label: tin.label, since: createdDay(tin) ?? today, reports: reports.map(listItemOf) });
  }
  return { today, yesterday: addDays(today, -1), signing: { available: getSigningKey() !== null }, tins, delivery: await getReportSettings(tenantId) };
}

export interface ReportPageData {
  report: ReportDetail;
  signing: { available: boolean };
}

/** One report for its page, or null when there is none (the page answers 404). */
export async function loadReportPage(tenantId: string, id: string): Promise<ReportPageData | null> {
  const r = await getReportDetail(tenantId, id);
  return r.ok ? { report: r.report, signing: { available: getSigningKey() !== null } } : null;
}
