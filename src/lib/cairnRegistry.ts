/**
 * PPPcairn — milestone / disbursement evidence layer.
 *
 * Sibling of receivablesRegistry.ts, same primitives, different nouns: a PROJECT (a financed
 * piece of infrastructure) holds an ordered list of MILESTONES, each tied to a tranche of
 * money. Later phases let an independent inspector attest a milestone (signed + anchored) so a
 * lender can release the next tranche against proof, not a promise.
 *
 * Phase 0 = the spine: create a project, add milestones, sign each manifest, read them back.
 * No invites, attestations, documents, or disbursements yet.
 *
 * Bright lines (inherited from Almstins): no money movement ever; no attribution; tenant
 * isolation (every query scoped by tenant_id); project id = capability. See pppcairn.md.
 *
 * Lazy ensureCairnTables() + app-enforced tenant isolation, mirroring receivablesRegistry.ts.
 */
import { db } from '@/lib/db';
import { createHash } from 'crypto';
import {
  canonicalManifestBytes,
  signManifest,
  getPublicKeyHex,
  getSigningKeyId,
} from '@/lib/recordProof/signing';

/** Timestamp matching the columns' to_char(now() … 'YYYY-MM-DD HH24:MI:SS') default. */
const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

function sha256hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function clampStr(s: unknown, max: number): string {
  return String(s ?? '').trim().slice(0, max);
}
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export type MilestoneStatus = 'pending' | 'claimed' | 'attested' | 'disputed';

export interface Signature {
  keyId: string;
  alg: string;
  signatureHex: string;
  publicKeyHex: string;
}

export interface ProjectInput {
  name: string;
  counterparty: string;
  totalValue: number;
  currency: string;
  description?: string | null;
  isTest?: boolean;
}

export interface MilestoneInput {
  title: string;
  description?: string | null;
  trancheAmount: number;
  targetDate?: string | null;
}

export interface CreateProjectResult {
  ok: boolean;
  id?: string;
  digest?: string;
  signed?: boolean;
  keyId?: string;
  error?: string;
  message?: string;
}

export interface AddMilestoneResult {
  ok: boolean;
  id?: string;
  digest?: string;
  signed?: boolean;
  error?: string;
  message?: string;
}

export interface MilestoneSummary {
  id: string;
  seq: number;
  title: string;
  description: string | null;
  trancheAmount: number;
  targetDate: string | null;
  status: MilestoneStatus;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  counterparty: string;
  totalValue: number;
  currency: string;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
  milestoneCount: number;
}

// ── Schema ────────────────────────────────────────────────────────────────
// Parallel tables to receivables (not shared), so the semantics and tenant isolation stay
// clean. The crypto/anchor/document machinery is what gets reused, not the rows.

const ENSURE_PROJECTS_SQL = `
  CREATE TABLE IF NOT EXISTS cairn_projects (
    id             TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    name           TEXT NOT NULL,
    counterparty   TEXT NOT NULL,
    total_value    DOUBLE PRECISION NOT NULL,
    currency       TEXT NOT NULL,
    description    TEXT,
    is_test        BOOLEAN NOT NULL DEFAULT FALSE,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    updated_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_PROJECTS_TENANT_IDX =
  `CREATE INDEX IF NOT EXISTS cairn_projects_tenant ON cairn_projects (tenant_id)`;

const ENSURE_MILESTONES_SQL = `
  CREATE TABLE IF NOT EXISTS cairn_milestones (
    id             TEXT NOT NULL PRIMARY KEY,
    project_id     TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT,
    tranche_amount DOUBLE PRECISION NOT NULL,
    target_date    TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_MILESTONES_PROJECT_IDX =
  `CREATE INDEX IF NOT EXISTS cairn_milestones_project ON cairn_milestones (project_id)`;

let ensured = false;
export async function ensureCairnTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_PROJECTS_SQL, args: [] });
  await db.execute({ sql: ENSURE_PROJECTS_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_MILESTONES_SQL, args: [] });
  await db.execute({ sql: ENSURE_MILESTONES_PROJECT_IDX, args: [] });
  ensured = true;
}

// ── Signing ─────────────────────────────────────────────────────────────────
function sign(manifest: object): { signature: Signature | null; digest: string } {
  const bytes = canonicalManifestBytes(manifest);
  const digest = sha256hex(bytes);
  const sig = signManifest(bytes);
  const pub = getPublicKeyHex();
  if (!sig || !pub) return { signature: null, digest };
  return {
    signature: { keyId: sig.keyId, alg: sig.alg, signatureHex: sig.signatureHex, publicKeyHex: pub },
    digest,
  };
}

/** Bump a project's last-activity clock. Any change to it or a milestone calls this.
 *  Keyed by id only; non-fatal (sort falls back to created_at). */
async function touchProject(projectId: string): Promise<void> {
  try {
    await db.execute({
      sql: `UPDATE cairn_projects SET updated_at = ? WHERE id = ?`,
      args: [nowUtc(), String(projectId)],
    });
  } catch { /* non-fatal */ }
}

// ── Create ────────────────────────────────────────────────────────────────

export async function createProject(
  tenantId: string,
  input: ProjectInput,
): Promise<CreateProjectResult> {
  await ensureCairnTables();
  const name = clampStr(input.name, 200);
  const counterparty = clampStr(input.counterparty, 200);
  const currency = clampStr(input.currency || 'NGN', 8).toUpperCase() || 'NGN';
  const totalValue = Number(input.totalValue);
  const description = input.description != null ? clampStr(input.description, 2000) || null : null;

  if (!name || !counterparty) {
    return { ok: false, error: 'invalid', message: 'Project name and counterparty are required.' };
  }
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return { ok: false, error: 'invalid', message: 'Total value must be a positive number.' };
  }

  const isTest = input.isTest === true;
  const project: Record<string, unknown> = { name, counterparty, totalValue, currency };
  if (description) project.description = description;
  // In the manifest so a test project's ID differs from the same one recorded for real, and
  // the flag is covered by the signature — a test record cannot be laundered into a real one.
  if (isTest) project.isTest = true;
  const manifest = { v: 1, kind: 'cairn_project', project };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  const existing = await db.execute({ sql: `SELECT id FROM cairn_projects WHERE id = ? LIMIT 1`, args: [id] });
  if (!existing.rows.length) {
    await db.execute({
      sql: `INSERT INTO cairn_projects
              (id, tenant_id, name, counterparty, total_value, currency, description, is_test, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, name, counterparty, totalValue, currency, description, isTest,
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
      ],
    });
  }
  await touchProject(id);
  return { ok: true, id, digest, signed: !!signature, keyId: getSigningKeyId() };
}

export async function addMilestone(
  tenantId: string,
  projectId: string,
  input: MilestoneInput,
): Promise<AddMilestoneResult> {
  await ensureCairnTables();
  const pid = clampStr(projectId, 80);
  const title = clampStr(input.title, 200);
  const description = input.description != null ? clampStr(input.description, 2000) || null : null;
  const trancheAmount = Number(input.trancheAmount);
  const targetDate = isYmd(input.targetDate) ? input.targetDate : null;

  if (!pid) return { ok: false, error: 'invalid', message: 'A project is required.' };
  if (!title) return { ok: false, error: 'invalid', message: 'A milestone title is required.' };
  if (!Number.isFinite(trancheAmount) || trancheAmount < 0) {
    return { ok: false, error: 'invalid', message: 'Tranche amount must be zero or more.' };
  }

  // Owner-scoped: you can only add milestones to your own project.
  const proj = await db.execute({
    sql: `SELECT id FROM cairn_projects WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [pid, tenantId],
  });
  if (!proj.rows.length) return { ok: false, error: 'not_found', message: 'Project not found.' };

  // Next sequence number in this project.
  const seqRow = await db.execute({
    sql: `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM cairn_milestones WHERE project_id = ?`,
    args: [pid],
  });
  const seq = Number((seqRow.rows[0] as any)?.max_seq ?? 0) + 1;

  const milestone: Record<string, unknown> = { projectId: pid, seq, title, trancheAmount };
  if (description) milestone.description = description;
  if (targetDate) milestone.targetDate = targetDate;
  const manifest = { v: 1, kind: 'cairn_milestone', milestone };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  const existing = await db.execute({ sql: `SELECT id FROM cairn_milestones WHERE id = ? LIMIT 1`, args: [id] });
  if (!existing.rows.length) {
    await db.execute({
      sql: `INSERT INTO cairn_milestones
              (id, project_id, tenant_id, seq, title, description, tranche_amount, target_date, status, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      args: [
        id, pid, tenantId, seq, title, description, trancheAmount, targetDate,
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
      ],
    });
  }
  await touchProject(pid);
  return { ok: true, id, digest, signed: !!signature };
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function listProjects(tenantId: string): Promise<ProjectSummary[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT p.id, p.name, p.counterparty, p.total_value, p.currency, p.is_test,
                 p.created_at, COALESCE(p.updated_at, p.created_at) AS last_activity,
                 (SELECT COUNT(*) FROM cairn_milestones m WHERE m.project_id = p.id) AS milestone_count
          FROM cairn_projects p
          WHERE p.tenant_id = ?
          ORDER BY COALESCE(p.updated_at, p.created_at) DESC
          LIMIT 200`,
    args: [tenantId],
  });
  return (r.rows as any[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    counterparty: String(row.counterparty),
    totalValue: Number(row.total_value),
    currency: String(row.currency),
    isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
    createdAt: String(row.created_at),
    updatedAt: String(row.last_activity ?? row.created_at),
    milestoneCount: Number(row.milestone_count ?? 0),
  }));
}

export async function listMilestones(tenantId: string, projectId: string): Promise<MilestoneSummary[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, seq, title, description, tranche_amount, target_date, status, created_at
          FROM cairn_milestones
          WHERE project_id = ? AND tenant_id = ?
          ORDER BY seq ASC`,
    args: [String(projectId), tenantId],
  });
  return (r.rows as any[]).map((row) => ({
    id: String(row.id),
    seq: Number(row.seq),
    title: String(row.title),
    description: row.description != null ? String(row.description) : null,
    trancheAmount: Number(row.tranche_amount),
    targetDate: row.target_date != null ? String(row.target_date) : null,
    status: String(row.status) as MilestoneStatus,
    createdAt: String(row.created_at),
  }));
}

/** One project the tenant owns, with its milestones. Tenant-scoped. */
export async function getProjectForOwner(
  tenantId: string,
  projectId: string,
): Promise<{ project: ProjectSummary; milestones: MilestoneSummary[] } | null> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, name, counterparty, total_value, currency, is_test, created_at,
                 COALESCE(updated_at, created_at) AS last_activity
          FROM cairn_projects WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(projectId), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  const milestones = await listMilestones(tenantId, String(row.id));
  return {
    project: {
      id: String(row.id),
      name: String(row.name),
      counterparty: String(row.counterparty),
      totalValue: Number(row.total_value),
      currency: String(row.currency),
      isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
      createdAt: String(row.created_at),
      updatedAt: String(row.last_activity ?? row.created_at),
      milestoneCount: milestones.length,
    },
    milestones,
  };
}
