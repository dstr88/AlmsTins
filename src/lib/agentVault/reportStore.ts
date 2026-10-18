/**
 * Stored operator reports: one append-only row per version of a tin's report for a stretch of
 * time. SQL only; making a report is ./reports.ts and the content is ./report.ts.
 *
 * A report is a SNAPSHOT of what the Vault knew when it was generated. The ledger can still grow
 * for a period after its report was made (a transfer the chain confirms late is recorded later),
 * so making the report again is a NEW version: the older versions stay, nothing is rewritten, and
 * the newest one is the one the Reports page shows. This module inserts and reads, and nothing in
 * it updates or removes a row; tests/agentics/guards.test.ts fails the day any other file names
 * the table in a write. The only way a row leaves is the whole account being removed
 * (src/lib/accountDeleteTables.ts).
 *
 * Tenant isolation is the same rule as store.ts: every statement names tenant_id, so a report of
 * another account answers exactly like one that does not exist.
 *
 * Schema is created lazily by ensureAgentReportsTable and mirrored in
 * migrations-pg/0053_agent_reports.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';
import type { ReportContent } from './report';
import type { AgentReportManifest } from './reportProof';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The table and indexes, in creation order. The migration file holds the same statements. */
export const AGENT_REPORTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_reports (
    id             TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    tin_id         TEXT NOT NULL,
    period_start   TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    version        INTEGER NOT NULL,
    generated_at   TEXT NOT NULL,
    content_hash   TEXT NOT NULL,
    summary_json   TEXT NOT NULL,
    merkle_root    TEXT,
    leaf_count     INTEGER,
    signing_key_id TEXT,
    signature_hex  TEXT,
    manifest_json  TEXT,
    created_at     TEXT NOT NULL ${TS_DEFAULT},
    CHECK (version >= 1)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_reports_version ON agent_reports (tenant_id, tin_id, period_start, version)`,
  `CREATE INDEX IF NOT EXISTS agent_reports_tenant_period ON agent_reports (tenant_id, period_start)`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the reports table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentReportsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_REPORTS_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** One stored version of a report, as callers see it (never a tenant id). */
export interface StoredReport {
  id: string;
  tinId: string;
  /** The period's first moment, UTC ISO-8601 with milliseconds. */
  periodStart: string;
  periodEnd: string;
  version: number;
  /** When the snapshot was taken: it holds every event the Vault had recorded up to this moment. */
  generatedAt: string;
  contentHash: string;
  content: ReportContent;
  merkleRoot: string | null;
  signature: { keyId: string; signatureHex: string } | null;
  manifest: AgentReportManifest | null;
}

const text = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The content of a stored row when it is the shape this code writes; null for anything else. */
function parseContent(raw: unknown): ReportContent | null {
  const v = parseJson(raw) as Partial<ReportContent> | null;
  if (!v || typeof v !== 'object' || v.v !== 1 || !v.tin || !v.period || !v.buckets || !v.strip || !v.events) return null;
  return v as ReportContent;
}

function parseManifest(raw: unknown): AgentReportManifest | null {
  const v = parseJson(raw) as Partial<AgentReportManifest> | null;
  return v && typeof v === 'object' && v.record_type === 'agent_report' ? (v as AgentReportManifest) : null;
}

/** A stored row as a StoredReport, or null when its content cannot be read (it is skipped, never half-shown). */
function reportFrom(r: any): StoredReport | null {
  const content = parseContent(r.summary_json);
  if (!content) return null;
  const keyId = text(r.signing_key_id);
  const signatureHex = text(r.signature_hex);
  return {
    id: String(r.id),
    tinId: String(r.tin_id),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    version: Number(r.version),
    generatedAt: String(r.generated_at),
    contentHash: String(r.content_hash),
    content,
    merkleRoot: text(r.merkle_root),
    signature: keyId && signatureHex ? { keyId, signatureHex } : null,
    manifest: parseManifest(r.manifest_json),
  };
}

const COLUMNS = `id, tin_id, period_start, period_end, version, generated_at, content_hash, summary_json, merkle_root, signing_key_id, signature_hex, manifest_json`;

/** What one new version is written with. */
export interface NewReportRow {
  id: string;
  tinId: string;
  periodStart: string;
  periodEnd: string;
  version: number;
  generatedAt: string;
  contentHash: string;
  /** The content as canonical JSON text (what was hashed is what is kept). */
  summaryJson: string;
  merkleRoot: string | null;
  leafCount: number | null;
  signingKeyId: string | null;
  signatureHex: string | null;
  manifestJson: string | null;
}

/**
 * The one statement that writes a report, and the only INSERT INTO this table anywhere in src
 * (tests/agentics/guards.test.ts counts it). A version number that already exists for this tin and
 * period is skipped, so two generators racing for it cannot both win: exactly one of them writes
 * that version. False when the version was taken.
 */
export async function insertReportVersion(tenantId: string, row: NewReportRow): Promise<boolean> {
  await ensureAgentReportsTable();
  const r = await db.execute({
    sql: `INSERT INTO agent_reports (id, tenant_id, tin_id, period_start, period_end, version, generated_at, content_hash, summary_json, merkle_root, leaf_count, signing_key_id, signature_hex, manifest_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, tin_id, period_start, version) DO NOTHING`,
    args: [
      row.id, tenantId, row.tinId, row.periodStart, row.periodEnd, row.version, row.generatedAt, row.contentHash, row.summaryJson,
      row.merkleRoot, row.leafCount, row.signingKeyId, row.signatureHex, row.manifestJson,
    ],
  });
  return (r.rowsAffected ?? 0) > 0;
}

/**
 * The newest stored version of a tin's report for one period, as a writer needs it: the number,
 * the time and the Merkle root come from the row's own columns, so they are known even when the
 * words of the row cannot be read.
 */
export interface NewestVersion {
  version: number;
  generatedAt: string;
  merkleRoot: string | null;
  /** The version's words, or null when they cannot be read (its number is still taken). */
  report: StoredReport | null;
}

/** The newest version of a tin's report for one period, or null when there is none. */
export async function getNewestVersion(tenantId: string, tinId: string, periodStart: string): Promise<NewestVersion | null> {
  await ensureAgentReportsTable();
  const r = await db.execute({
    sql: `SELECT ${COLUMNS} FROM agent_reports WHERE tenant_id = ? AND tin_id = ? AND period_start = ? ORDER BY version DESC LIMIT 1`,
    args: [tenantId, tinId, periodStart],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  return { version: Number(row.version), generatedAt: String(row.generated_at), merkleRoot: text(row.merkle_root), report: reportFrom(row) };
}

/** The newest readable version of a tin's report for one period, or null when there is none (or its words cannot be read). */
export async function getLatestReport(tenantId: string, tinId: string, periodStart: string): Promise<StoredReport | null> {
  return (await getNewestVersion(tenantId, tinId, periodStart))?.report ?? null;
}

/** One stored version by its id, or null. */
export async function getReportById(tenantId: string, id: string): Promise<StoredReport | null> {
  await ensureAgentReportsTable();
  const r = await db.execute({
    sql: `SELECT ${COLUMNS} FROM agent_reports WHERE tenant_id = ? AND id = ? LIMIT 1`,
    args: [tenantId, id],
  });
  return r.rows.length ? reportFrom(r.rows[0]) : null;
}

/** Every stored version of a tin's report for one period, newest version first. */
export async function listReportVersions(tenantId: string, tinId: string, periodStart: string, limit = 50): Promise<StoredReport[]> {
  await ensureAgentReportsTable();
  const r = await db.execute({
    sql: `SELECT ${COLUMNS} FROM agent_reports WHERE tenant_id = ? AND tin_id = ? AND period_start = ? ORDER BY version DESC LIMIT ?`,
    args: [tenantId, tinId, periodStart, limit],
  });
  return r.rows.map(reportFrom).filter((x): x is StoredReport => x !== null);
}

/**
 * The newest version of each period a tin has reports for, newest period first, at most `limit`
 * periods, older than `beforeStart` when given. One statement: a version is the newest of its
 * period when no higher version of the same period exists, so however many versions a period
 * has, `limit` periods are what comes back (a period that piled up versions never crowds out an
 * older one). A period whose newest version cannot be read is left out, not half shown.
 */
export async function listLatestReports(
  tenantId: string,
  tinId: string,
  opts: { limit: number; beforeStart?: string | null },
): Promise<StoredReport[]> {
  await ensureAgentReportsTable();
  const args: Array<string | number> = [tenantId, tinId];
  let before = '';
  if (opts.beforeStart) {
    before = ` AND r.period_start < ?`;
    args.push(opts.beforeStart);
  }
  args.push(opts.limit);
  const r = await db.execute({
    sql: `SELECT ${COLUMNS.split(', ').map((c) => `r.${c}`).join(', ')} FROM agent_reports r
          WHERE r.tenant_id = ? AND r.tin_id = ?${before}
            AND NOT EXISTS (SELECT 1 FROM agent_reports n WHERE n.tenant_id = r.tenant_id AND n.tin_id = r.tin_id AND n.period_start = r.period_start AND n.version > r.version)
          ORDER BY r.period_start DESC LIMIT ?`,
    args,
  });
  return (r.rows as any[]).map(reportFrom).filter((x): x is StoredReport => x !== null);
}

/** The newest version of each tin's report for one period, across the account's tins (what a digest reads). */
export async function listLatestReportsForPeriod(tenantId: string, periodStart: string): Promise<StoredReport[]> {
  await ensureAgentReportsTable();
  const r = await db.execute({
    sql: `SELECT ${COLUMNS} FROM agent_reports WHERE tenant_id = ? AND period_start = ? ORDER BY tin_id ASC, version DESC`,
    args: [tenantId, periodStart],
  });
  const out: StoredReport[] = [];
  let lastTin = '';
  for (const row of r.rows as any[]) {
    const tinId = String(row.tin_id);
    if (tinId === lastTin) continue; // older versions of a tin already taken
    lastTin = tinId;
    const report = reportFrom(row);
    if (report) out.push(report);
  }
  return out;
}
