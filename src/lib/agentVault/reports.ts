/**
 * Operator reports: making one, listing them, reading one. What the /api/agentics/reports endpoints
 * and the daily job (src/pages/api/cron/agent-reports.ts) call. The content of a report is
 * ./report.ts, its signature ./reportProof.ts and its storage ./reportStore.ts.
 *
 * A report is a SNAPSHOT of what the Vault had recorded when it was made. Making the same period
 * again can be repeated as often as you like: when nothing the report says has changed, it hands
 * back the version it already has and writes nothing. When something has (a transfer the chain confirmed late, a
 * label), it writes a NEW version, and the older versions stay. A version also differs from the
 * one before it when that one was made with no signing key and a key is configured now, so a
 * signed copy can be had without waiting for the ledger to change.
 *
 * Every operation takes the tenant first and passes it to every query. Days are UTC days.
 */
import { randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import { getSigningKey } from '@/lib/recordProof/signing';
import { readEventsInRange } from './events';
import { addDays, dayBounds, headlineOf, parseDay, ReportBuilder, utcDay, type ReportContent, type ReportHeadline } from './report';
import { buildReportBundle, bundleFromStored, contentHashOf, verifyReportBundle } from './reportProof';
import {
  getLatestReport,
  getReportById,
  insertReportVersion,
  listLatestReports,
  listReportVersions,
  type StoredReport,
} from './reportStore';
import { getTin, listDestinations, type Tin } from './store';
import { fail, idOf, type Failure } from './errors';

export interface ReportDeps {
  now: () => Date;
  newId: () => string;
}

export const defaultReportDeps: ReportDeps = { now: () => new Date(), newId: () => randomUUID() };

/** How often a writer retries for a version number another writer took first. */
const MAX_ATTEMPTS = 5;

export const DEFAULT_REPORT_PAGE = 30;
export const MAX_REPORT_PAGE = 90;

/** The registry's labels by address for one tin, as the report lists them: the first label found for an address wins. */
async function labelsFor(tenantId: string, tinId: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  for (const d of await listDestinations(tenantId, tinId)) {
    if (d.label && !labels.has(d.address)) labels.set(d.address, d.label);
  }
  return labels;
}

export interface GeneratedReport {
  report: StoredReport;
  /** True when a new version was written; false when the newest one already says the same. */
  created: boolean;
}

/**
 * Makes the report of one tin for one UTC day (`YYYY-MM-DD`, already validated) from the ledger as
 * it stands now. The moment it starts is the report's `generatedAt`, read before the ledger is, so
 * the snapshot holds at least every event recorded up to that moment.
 */
export async function generateReport(tenantId: string, tin: Tin, day: string, deps: ReportDeps = defaultReportDeps): Promise<GeneratedReport> {
  const generatedAt = deps.now().toISOString();
  const { start, end } = dayBounds(day);

  const builder = new ReportBuilder({
    tin: { id: tin.id, label: tin.label },
    period: { start, end, partial: generatedAt < end },
    labels: await labelsFor(tenantId, tin.id),
  });
  await readEventsInRange(tenantId, tin.id, { fromIso: start, toIso: end }, (event) => builder.add(event));
  const content = builder.finish();
  const contentHash = contentHashOf(content);
  const summaryJson = canonicalize(content) as string;
  const canSign = getSigningKey() !== null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const latest = await getLatestReport(tenantId, tin.id, start);
    // Nothing to say that the newest version does not: keep it. The one exception is an unsigned
    // version when a key is configured now, which is worth a signed copy of the same words.
    if (latest && latest.contentHash === contentHash && (latest.signature !== null || !canSign)) {
      return { report: latest, created: false };
    }
    const version = latest ? latest.version + 1 : 1;
    const id = deps.newId();
    const bundle = buildReportBundle({ tenantId, reportId: id, version, generatedAt, content, prevRoot: latest?.merkleRoot ?? null });
    const written = await insertReportVersion(tenantId, {
      id,
      tinId: tin.id,
      periodStart: start,
      periodEnd: end,
      version,
      generatedAt,
      contentHash,
      summaryJson,
      merkleRoot: bundle.manifest.merkle_root,
      leafCount: bundle.manifest.leaf_count,
      signingKeyId: bundle.signature ? bundle.signature.key_id : null,
      signatureHex: bundle.signature ? bundle.signature.signature_hex : null,
      manifestJson: JSON.stringify(bundle.manifest),
    });
    if (written) {
      return {
        report: {
          id,
          tinId: tin.id,
          periodStart: start,
          periodEnd: end,
          version,
          generatedAt,
          contentHash,
          content,
          merkleRoot: bundle.manifest.merkle_root,
          signature: bundle.signature ? { keyId: bundle.signature.key_id, signatureHex: bundle.signature.signature_hex } : null,
          manifest: bundle.manifest,
        },
        created: true,
      };
    }
    // Another writer took that version number first: look again at what it wrote.
  }
  throw new Error('agent_reports: no version number could be taken');
}

// ── What callers see ─────────────────────────────────────────────────────────

/** One report in a list: where it stands and its headline numbers, never an address. */
export interface ReportListItem {
  id: string;
  tinId: string;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  version: number;
  generatedAt: string;
  /** The report was made before its day ended, so it covers part of it. */
  partial: boolean;
  /** It carries an Almstins signature. */
  signed: boolean;
  headline: ReportHeadline;
}

/** Whether a stored report is what was signed: `altered` when its words or numbers no longer match what was committed. */
export type StoredVerification = 'verified' | 'unsigned' | 'unverifiable' | 'altered';

export interface ReportDetail extends ReportListItem {
  period: { start: string; end: string };
  keyId: string | null;
  merkleRoot: string | null;
  verification: StoredVerification;
  content: ReportContent;
  /** Every version of this tin's report for the day, newest first. */
  versions: ReportListItem[];
}

export function listItemOf(r: StoredReport): ReportListItem {
  return {
    id: r.id,
    tinId: r.tinId,
    day: r.periodStart.slice(0, 10),
    version: r.version,
    generatedAt: r.generatedAt,
    partial: r.content.period.partial,
    signed: r.signature !== null,
    headline: headlineOf(r.content),
  };
}

/**
 * Checks a stored report against what was signed when it was made: the columns against the signed
 * manifest, the content against its hash, and the signature against the keys Almstins publishes
 * now. Never trusts the row: the words are rebuilt into the commitment and compared.
 */
export function verifyStoredReport(r: StoredReport): StoredVerification {
  if (contentHashOf(r.content) !== r.contentHash) return 'altered';
  const m = r.manifest;
  if (!m) return r.signature ? 'altered' : 'unsigned';
  if (m.record_id !== r.id || m.version !== r.version || m.generated_at !== r.generatedAt || m.period_start !== r.periodStart || m.period_end !== r.periodEnd) {
    return 'altered';
  }
  if (m.merkle_root !== r.merkleRoot) return 'altered';
  if (!r.signature) return 'unsigned';
  const bundle = bundleFromStored(r.content, { manifest: m, signature: r.signature });
  if (!bundle) return 'altered';
  const outcome = verifyReportBundle(bundle);
  if (outcome.verdict === 'verified') return 'verified';
  return outcome.verdict === 'tampered' ? 'altered' : 'unverifiable';
}

function detailOf(r: StoredReport, versions: StoredReport[]): ReportDetail {
  return {
    ...listItemOf(r),
    period: { start: r.periodStart, end: r.periodEnd },
    keyId: r.signature ? r.signature.keyId : null,
    merkleRoot: r.merkleRoot,
    verification: verifyStoredReport(r),
    content: r.content,
    versions: versions.map(listItemOf),
  };
}

// ── Operations the endpoints call ────────────────────────────────────────────

/** The UTC day a tin's stored creation time (`YYYY-MM-DD HH:MM:SS`) falls in. */
function createdDay(tin: Tin): string | null {
  const ms = Date.parse(`${tin.createdAt.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? utcDay(ms) : null;
}

/**
 * Makes (or finds) one tin's report for a UTC day, on request. The day may be today, which gives a
 * report that says it is partial and holds everything recorded so far; it may not be a day in the
 * future or one before the tin existed.
 */
export async function generateReportFor(
  tenantId: string,
  tinIdRaw: unknown,
  dayRaw: unknown,
  deps: ReportDeps = defaultReportDeps,
): Promise<{ ok: true; created: boolean; report: ReportDetail } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');
  const day = parseDay(dayRaw);
  if (!day) return fail('invalid_period');
  const first = createdDay(tin);
  if (day > utcDay(deps.now()) || (first !== null && day < first)) return fail('invalid_period');

  const made = await generateReport(tenantId, tin, day, deps);
  const versions = await listReportVersions(tenantId, tin.id, made.report.periodStart);
  return { ok: true, created: made.created, report: detailOf(made.report, versions) };
}

/**
 * A tin's reports, one per day (the newest version of each), newest day first. `limit` and
 * `before` (a day, `YYYY-MM-DD`: only older days) come straight from a query string, so both are
 * checked here.
 */
export async function listTinReports(
  tenantId: string,
  tinIdRaw: unknown,
  opts: { limit?: unknown; before?: unknown } = {},
): Promise<{ ok: true; tinId: string; reports: ReportListItem[]; next: string | null } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');
  const asked = Number(opts.limit);
  const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_REPORT_PAGE) : DEFAULT_REPORT_PAGE;
  let beforeStart: string | null = null;
  if (opts.before != null && opts.before !== '') {
    const day = parseDay(opts.before);
    if (!day) return fail('invalid_cursor');
    beforeStart = dayBounds(day).start;
  }
  const reports = (await listLatestReports(tenantId, tin.id, { limit, beforeStart })).map(listItemOf);
  return { ok: true, tinId: tin.id, reports, next: reports.length === limit ? reports[reports.length - 1].day : null };
}

/** One report by its id, with every version of its day and whether it still matches what was signed. */
export async function getReportDetail(tenantId: string, idRaw: unknown): Promise<{ ok: true; report: ReportDetail } | Failure> {
  const id = idOf(idRaw);
  if (!id) return fail('invalid_id');
  const report = await getReportById(tenantId, id);
  if (!report) return fail('report_not_found');
  return { ok: true, report: detailOf(report, await listReportVersions(tenantId, report.tinId, report.periodStart)) };
}

/** The UTC day before `now`: what the daily job reports on. */
export const yesterdayOf = (now: Date): string => addDays(utcDay(now), -1);
