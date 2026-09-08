/**
 * PPPcairn — milestone / disbursement evidence layer.
 *
 * Sibling of receivablesRegistry.ts, same primitives, different nouns: a PROJECT (a financed
 * piece of infrastructure) holds an ordered list of MILESTONES, each tied to a tranche of
 * money. Later phases let an independent inspector attest a milestone (signed + anchored) so a
 * lender can release the next tranche against proof, not a promise.
 *
 * Phase 0 = the spine: create a project, add milestones, sign each manifest, read them back.
 * Phase 1 = the point: a single-use link asks an independent inspector to attest a milestone.
 * The answer is signed, stamped to Bitcoin at write time, and flips the milestone's status —
 * so the lender releases the next tranche against proof, not a promise.
 * No documents or disbursements yet (Phases 2–3).
 *
 * Bright lines (inherited from Almstins): no money movement ever; no attribution; tenant
 * isolation (every query scoped by tenant_id); project id = capability. See pppcairn.md.
 *
 * Lazy ensureCairnTables() + app-enforced tenant isolation, mirroring receivablesRegistry.ts.
 */
import { db } from '@/lib/db';
import { createHash, randomBytes, randomUUID } from 'crypto';
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

// Single-use inspector links, mirroring receivable_invites. `attested_by` not `by`
// (reserved word). An invite binds one question — "is THIS milestone reached?" — to one
// unguessable token; forwarding the link does not multiply the answer.
const ENSURE_CAIRN_INVITES_SQL = `
  CREATE TABLE IF NOT EXISTS cairn_invites (
    token          TEXT NOT NULL PRIMARY KEY,
    from_tenant    TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    milestone_id   TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'inspector',
    label          TEXT,
    email          TEXT,
    expires_at     TEXT NOT NULL,
    accepted_at    TEXT,
    accepted_by    TEXT,
    revoked_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_CAIRN_INVITES_FROM_IDX =
  `CREATE INDEX IF NOT EXISTS cairn_invites_from ON cairn_invites (from_tenant)`;

const ENSURE_CAIRN_ATTESTATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS cairn_attestations (
    id             TEXT NOT NULL PRIMARY KEY,
    milestone_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    role           TEXT NOT NULL,
    attested_by    TEXT NOT NULL,
    attester_title TEXT,
    statement      TEXT NOT NULL,
    attested_at    TEXT NOT NULL,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_CAIRN_ATTESTATIONS_IDX =
  `CREATE INDEX IF NOT EXISTS cairn_attestations_project ON cairn_attestations (project_id)`;

let ensured = false;
export async function ensureCairnTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_PROJECTS_SQL, args: [] });
  await db.execute({ sql: ENSURE_PROJECTS_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_MILESTONES_SQL, args: [] });
  await db.execute({ sql: ENSURE_MILESTONES_PROJECT_IDX, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_INVITES_SQL, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_INVITES_FROM_IDX, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_ATTESTATIONS_SQL, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_ATTESTATIONS_IDX, args: [] });
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
  return { ok: true, id, digest, signed: !!signature, keyId: getSigningKeyId() ?? undefined };
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

/** One project the tenant owns, with its milestones and the attestation trail. Tenant-scoped. */
export async function getProjectForOwner(
  tenantId: string,
  projectId: string,
): Promise<{ project: ProjectSummary; milestones: MilestoneSummary[]; attestations: AttestationSummary[] } | null> {
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
  const attestations = await listAttestations(tenantId, String(row.id));
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
    attestations,
  };
}

// ── Phase 1: the inspector attestation ────────────────────────────────────────
//
// The load-bearing proof of the whole product: an independent party puts their name to
// "this stage of the work is reached" through a single-use link, and the answer is signed
// by Almstins' key, bound to the milestone hash, and stamped to Bitcoin at write time. The
// lender still decides and still moves the money; PPPcairn only makes the fact provable.

/** Two weeks, not the receivables week: an inspector has to reach a site, not a filing cabinet. */
const CAIRN_INVITE_TTL_DAYS = 14;

/** 32 bytes of randomness, url-safe — same reasoning as the record IDs: unguessable. */
function cairnToken(): string {
  return randomBytes(32).toString('base64url');
}

export type AttestOutcome = 'reached' | 'not_reached' | 'disputed';

export interface AttestationSummary {
  id: string;
  milestoneId: string;
  role: string;
  by: string;
  title: string | null;
  statement: string;
  attestedAt: string;
  digest: string;
  anchored: boolean;
}

export interface AttestRequestRow {
  token: string;
  milestoneId: string;
  milestoneTitle: string;
  seq: number;
  email: string | null;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  state: 'open' | 'answered' | 'expired' | 'revoked';
  answeredBy: string | null;
}

/** Mint a single-use inspector link for one milestone. Only the project's owner may. */
export async function createInspectorInvite(
  tenantId: string,
  input: { projectId: string; milestoneId: string; email?: string | null; label?: string | null },
): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; error: string }> {
  await ensureCairnTables();
  const projectId = clampStr(input.projectId, 80);
  const milestoneId = clampStr(input.milestoneId, 80);

  const owns = await db.execute({
    sql: `SELECT 1 FROM cairn_milestones WHERE id = ? AND project_id = ? AND tenant_id = ? LIMIT 1`,
    args: [milestoneId, projectId, tenantId],
  });
  if (!owns.rows.length) return { ok: false, error: 'not_found' };

  const token = cairnToken();
  const expiresAt = new Date(Date.now() + CAIRN_INVITE_TTL_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19);
  await db.execute({
    sql: `INSERT INTO cairn_invites (token, from_tenant, project_id, milestone_id, role, label, email, expires_at)
          VALUES (?, ?, ?, ?, 'inspector', ?, ?, ?)`,
    args: [
      token, tenantId, projectId, milestoneId,
      input.label ? clampStr(input.label, 160) : null,
      input.email ? clampStr(input.email, 200) : null,
      expiresAt,
    ],
  });
  return { ok: true, token, expiresAt };
}

export async function revokeCairnInvite(tenantId: string, token: string): Promise<boolean> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `UPDATE cairn_invites SET revoked_at = ?
           WHERE token = ? AND from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), String(token || '').trim(), tenantId],
  });
  return !!r.rowsAffected;
}

/** Anti-cannon rate limit input: invites this tenant minted in the last hour. */
export async function countRecentCairnInvites(tenantId: string): Promise<number> {
  await ensureCairnTables();
  const since = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM cairn_invites WHERE from_tenant = ? AND created_at > ?`,
    args: [tenantId, since],
  });
  return Number((r.rows[0] as any)?.n ?? 0);
}

/** The roster for one project: every inspector asked, and where each request stands. */
export async function listAttestRequests(tenantId: string, projectId: string): Promise<AttestRequestRow[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT i.token, i.milestone_id, i.email, i.label, i.created_at, i.expires_at,
                 i.accepted_at, i.accepted_by, i.revoked_at, m.title, m.seq
            FROM cairn_invites i
            JOIN cairn_milestones m ON m.id = i.milestone_id
           WHERE i.project_id = ? AND i.from_tenant = ?
           ORDER BY i.created_at DESC
           LIMIT 200`,
    args: [String(projectId), tenantId],
  });
  const now = nowUtc();
  return (r.rows as any[]).map((row) => ({
    token: String(row.token),
    milestoneId: String(row.milestone_id),
    milestoneTitle: String(row.title),
    seq: Number(row.seq),
    email: row.email != null ? String(row.email) : null,
    label: row.label != null ? String(row.label) : null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    state: row.revoked_at ? 'revoked'
      : row.accepted_at ? 'answered'
      : String(row.expires_at) < now ? 'expired'
      : 'open',
    answeredBy: row.accepted_by != null ? String(row.accepted_by) : null,
  }));
}

/** What the inspector sees before answering. Token-gated; no account, no identity leaked. */
export async function readAttestRequest(token: string): Promise<
  | { ok: true; projectName: string; counterparty: string; currency: string;
      milestoneId: string; projectId: string; seq: number; milestoneTitle: string;
      milestoneDescription: string | null; trancheAmount: number; targetDate: string | null;
      status: MilestoneStatus; sentTo: string | null; isTest: boolean }
  | { ok: false; error: 'not_found' | 'expired' | 'revoked' | 'used' }
> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT i.milestone_id, i.project_id, i.email, i.expires_at, i.accepted_at, i.revoked_at,
                 m.seq, m.title, m.description, m.tranche_amount, m.target_date, m.status,
                 p.name, p.counterparty, p.currency, p.is_test
            FROM cairn_invites i
            JOIN cairn_milestones m ON m.id = i.milestone_id
            JOIN cairn_projects p ON p.id = i.project_id
           WHERE i.token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (row.revoked_at) return { ok: false, error: 'revoked' };
  if (row.accepted_at) return { ok: false, error: 'used' };
  if (String(row.expires_at) < nowUtc()) return { ok: false, error: 'expired' };
  return {
    ok: true,
    projectName: String(row.name),
    counterparty: String(row.counterparty),
    currency: String(row.currency),
    milestoneId: String(row.milestone_id),
    projectId: String(row.project_id),
    seq: Number(row.seq),
    milestoneTitle: String(row.title),
    milestoneDescription: row.description != null ? String(row.description) : null,
    trancheAmount: Number(row.tranche_amount),
    targetDate: row.target_date != null ? String(row.target_date) : null,
    status: String(row.status) as MilestoneStatus,
    sentTo: row.email != null ? String(row.email) : null,
    isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
  };
}

/**
 * The inspector answers. Claims the token atomically (a forwarded link cannot answer
 * twice), records a signed attestation under the tenant that asked, stamps its digest to
 * Bitcoin (non-fatal), and flips the milestone's status: reached -> attested,
 * disputed -> disputed, not_reached -> stays pending with the finding on the record.
 */
export async function attestByToken(
  token: string,
  outcome: AttestOutcome,
  answers: { by: string; title?: string | null; note?: string | null },
): Promise<{ ok: true; attestationId: string; milestoneId: string } | { ok: false; error: string }> {
  await ensureCairnTables();
  const req = await readAttestRequest(token);
  if (!req.ok) return { ok: false, error: req.error };

  const by = clampStr(answers.by, 100);
  if (!by) return { ok: false, error: 'name_required' };
  const roleTitle = answers.title ? clampStr(answers.title, 60) : null;
  const note = answers.note ? clampStr(answers.note, 600) : null;
  if (outcome === 'disputed' && !note) return { ok: false, error: 'note_required' };

  const sender = await db.execute({
    sql: `SELECT from_tenant FROM cairn_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const fromTenant = String((sender.rows[0] as any)?.from_tenant ?? '');

  // Claim the token first; two people opening the same link race here and one wins.
  const claimed = await db.execute({
    sql: `UPDATE cairn_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), by, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const date = nowUtc().slice(0, 10);
  const titled = roleTitle ? ` (${roleTitle})` : '';
  const via = ' via a single-use link';
  const stage = `milestone ${req.seq}, "${req.milestoneTitle}"`;
  const statement =
    outcome === 'reached'
      ? `REACHED. Attests ${stage} is reached${note ? `. Note: ${note}` : ''}. Answered by ${by}${titled}${via}.`
    : outcome === 'not_reached'
      ? `NOT_REACHED. Attests ${stage} is not yet reached${note ? `. Note: ${note}` : ''}. Answered by ${by}${titled}${via}.`
      : `DISPUTED — ${note}. ${stage[0].toUpperCase()}${stage.slice(1)}. Answered by ${by}${titled}${via}.`;

  const manifest: Record<string, unknown> = {
    v: 1, kind: 'cairn_attestation',
    milestoneId: req.milestoneId, projectId: req.projectId,
    role: 'inspector', by, statement, date,
  };
  if (roleTitle) manifest.title = roleTitle;
  const { signature, digest } = sign(manifest);
  const attestationId = randomUUID();
  await db.execute({
    sql: `INSERT INTO cairn_attestations
            (id, milestone_id, project_id, tenant_id, role, attested_by, attester_title, statement, attested_at, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, 'inspector', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      attestationId, req.milestoneId, req.projectId, fromTenant, by, roleTitle, statement, date,
      JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
    ],
  });

  if (outcome !== 'not_reached') {
    await db.execute({
      sql: `UPDATE cairn_milestones SET status = ? WHERE id = ? AND project_id = ?`,
      args: [outcome === 'reached' ? 'attested' : 'disputed', req.milestoneId, req.projectId],
    });
  }
  await touchProject(req.projectId);

  // Stamp the digest to Bitcoin now, while the moment is fresh; the pending receipt fixes
  // the date and upgrades to a confirmed proof later (cron integration lands in Phase 3).
  // Non-fatal by design: the signed record stands on its own if the calendar is down.
  try {
    const { OpenTimestampsAnchor } = await import('@/lib/rwaProof/anchorOpenTimestamps');
    const receipt = await new OpenTimestampsAnchor().stamp(digest.toLowerCase());
    await db.execute({
      sql: `UPDATE cairn_attestations SET anchor_json = ? WHERE id = ?`,
      args: [JSON.stringify(receipt), attestationId],
    });
  } catch { /* anchor later; the signature already binds the content */ }

  return { ok: true, attestationId, milestoneId: req.milestoneId };
}

/** The dated trail for one project the tenant owns. */
export async function listAttestations(tenantId: string, projectId: string): Promise<AttestationSummary[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, milestone_id, role, attested_by, attester_title, statement, attested_at, digest, anchor_json
            FROM cairn_attestations
           WHERE project_id = ? AND tenant_id = ?
           ORDER BY created_at ASC
           LIMIT 500`,
    args: [String(projectId), tenantId],
  });
  return (r.rows as any[]).map((row) => ({
    id: String(row.id),
    milestoneId: String(row.milestone_id),
    role: String(row.role),
    by: String(row.attested_by),
    title: row.attester_title != null ? String(row.attester_title) : null,
    statement: String(row.statement),
    attestedAt: String(row.attested_at),
    digest: String(row.digest),
    anchored: row.anchor_json != null,
  }));
}

/** An open, emailable request this tenant created — what the send endpoint describes. */
export async function getSendableCairnRequest(tenantId: string, token: string): Promise<
  | { token: string; sentTo: string; projectName: string; counterparty: string;
      milestoneTitle: string; seq: number; targetDate: string | null; expiresAt: string; isTest: boolean }
  | null
> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT i.token, i.email, i.expires_at, i.accepted_at, i.revoked_at,
                 m.title, m.seq, m.target_date, p.name, p.counterparty, p.is_test
            FROM cairn_invites i
            JOIN cairn_milestones m ON m.id = i.milestone_id
            JOIN cairn_projects p ON p.id = i.project_id
           WHERE i.token = ? AND i.from_tenant = ? LIMIT 1`,
    args: [String(token || '').trim(), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.revoked_at || row.accepted_at) return null;
  if (String(row.expires_at) < nowUtc()) return null;
  if (!row.email) return null;
  return {
    token: String(row.token),
    sentTo: String(row.email),
    projectName: String(row.name),
    counterparty: String(row.counterparty),
    milestoneTitle: String(row.title),
    seq: Number(row.seq),
    targetDate: row.target_date != null ? String(row.target_date) : null,
    expiresAt: String(row.expires_at),
    isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
  };
}
