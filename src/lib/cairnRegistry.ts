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
  sealedAt: string | null;
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
  // The inspector's condition report — what they found, word for word, in the signed
  // manifest. Added after the table shipped; idempotent for both fresh and existing DBs.
  await db.execute({ sql: `ALTER TABLE cairn_attestations ADD COLUMN IF NOT EXISTS findings TEXT`, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_DOCS_SQL, args: [] });
  await db.execute({ sql: ENSURE_CAIRN_DOCS_IDX, args: [] });
  // What each file IS: the lender's blank form, the completed report, a site photo of the
  // work itself, or the inspector's drawn signature. Different bankers accept different
  // ceremonies; the desk labels each accordingly.
  await db.execute({ sql: `ALTER TABLE cairn_documents ADD COLUMN IF NOT EXISTS kind TEXT`, args: [] });
  // Draft -> sealed lifecycle: a schedule is built freely, then signed in one deliberate
  // act. NULL = still a draft; the timestamp is when the owner put their name to it all.
  await db.execute({ sql: `ALTER TABLE cairn_projects ADD COLUMN IF NOT EXISTS signed_at TEXT`, args: [] });
  ensured = true;
}

// Paperwork on a milestone, in both directions: the lender attaches the report form the
// inspector must use; the inspector uploads the completed form (photo or PDF) from the
// site. Bytes live base64 in Postgres (no object store; Render's disk is ephemeral).
// Every file's sha256 is bound into the attestation manifest at answer time, so a swapped
// form is provable rather than deniable. Purge policy arrives with the Phase 2/3 cron;
// purged_at exists from day one so tombstoning needs no migration.
const ENSURE_CAIRN_DOCS_SQL = `
  CREATE TABLE IF NOT EXISTS cairn_documents (
    id             TEXT NOT NULL PRIMARY KEY,
    milestone_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    uploaded_by    TEXT NOT NULL DEFAULT 'owner',
    filename       TEXT NOT NULL,
    mime_type      TEXT NOT NULL,
    file_size      INTEGER NOT NULL DEFAULT 0,
    sha256         TEXT NOT NULL,
    data           TEXT,
    uploaded_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    purged_at      TEXT
  )
`;
const ENSURE_CAIRN_DOCS_IDX =
  `CREATE INDEX IF NOT EXISTS cairn_documents_ms ON cairn_documents (milestone_id)`;

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
  // In the manifest so the flag is covered by the eventual signature — a test record
  // cannot be laundered into a real one at sealing time.
  if (isTest) project.isTest = true;
  // A DRAFT: recorded, unsigned, freely editable. The id is random (still an unguessable
  // capability); signing happens once, deliberately, when the whole schedule is true —
  // sealProject() below. The draft manifest is a placeholder the seal overwrites.
  const manifest = { v: 1, kind: 'cairn_project_draft', project };
  const digest = sha256hex(canonicalManifestBytes(manifest));
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO cairn_projects
            (id, tenant_id, name, counterparty, total_value, currency, description, is_test, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, tenantId, name, counterparty, totalValue, currency, description, isTest,
      JSON.stringify(manifest), null, digest,
    ],
  });
  await touchProject(id);
  return { ok: true, id, digest, signed: false, keyId: getSigningKeyId() ?? undefined };
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

  // Owner-scoped, drafts only: a sealed schedule does not grow quietly. (Whether sealed
  // projects can take signed addenda is an open question for the pilot financier.)
  const proj = await db.execute({
    sql: `SELECT id, signed_at FROM cairn_projects WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [pid, tenantId],
  });
  if (!proj.rows.length) return { ok: false, error: 'not_found', message: 'Project not found.' };
  if ((proj.rows[0] as any).signed_at != null) {
    return { ok: false, error: 'locked', message: 'This schedule is signed and sealed. It does not grow quietly.' };
  }

  // The schedule cannot promise more than the project. Enforced here, at edit, and at
  // sealing — the form does the arithmetic so the last tile is never a math problem.
  const totRow = await db.execute({
    sql: `SELECT p.total_value, COALESCE(SUM(m.tranche_amount), 0) AS allocated
            FROM cairn_projects p LEFT JOIN cairn_milestones m ON m.project_id = p.id
           WHERE p.id = ? GROUP BY p.total_value`,
    args: [pid],
  });
  const totalValueP = Number((totRow.rows[0] as any)?.total_value ?? 0);
  const allocated = Number((totRow.rows[0] as any)?.allocated ?? 0);
  if (totalValueP > 0 && allocated + trancheAmount > totalValueP + 0.005) {
    const left = Math.max(0, totalValueP - allocated);
    return { ok: false, error: 'over_allocated', message: `Only ${left.toLocaleString('en-US')} is left to place on this project.` };
  }

  // Next sequence number in this project.
  const seqRow = await db.execute({
    sql: `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM cairn_milestones WHERE project_id = ?`,
    args: [pid],
  });
  const seq = Number((seqRow.rows[0] as any)?.max_seq ?? 0) + 1;

  // A draft row: unsigned, editable in place, random-id. The seal signs it.
  const milestone: Record<string, unknown> = { projectId: pid, seq, title, trancheAmount };
  if (description) milestone.description = description;
  if (targetDate) milestone.targetDate = targetDate;
  const manifest = { v: 1, kind: 'cairn_milestone_draft', milestone };
  const digest = sha256hex(canonicalManifestBytes(manifest));
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO cairn_milestones
            (id, project_id, tenant_id, seq, title, description, tranche_amount, target_date, status, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    args: [
      id, pid, tenantId, seq, title, description, trancheAmount, targetDate,
      JSON.stringify(manifest), null, digest,
    ],
  });
  await touchProject(pid);
  return { ok: true, id, digest, signed: false };
}

// ── The draft -> sealed lifecycle ─────────────────────────────────────────────
//
// The banker builds the schedule freely: add, edit, remove, leave, come back. Nothing is
// signed while he is still writing what he knows to be true. When all of it is, he signs
// once — sealProject — and the whole schedule locks: every milestone gets its signed
// manifest, and the project's own signed manifest embeds every milestone's digest, so the
// schedule is sealed as one object, not a pile of independently signed pieces. Inspectors
// can only be invited onto a sealed schedule: an attestation must bind to a milestone that
// can no longer shift under the inspector's feet.

async function milestoneDraft(
  tenantId: string, milestoneId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const ms = await db.execute({
    sql: `SELECT m.id, m.project_id, p.signed_at
            FROM cairn_milestones m JOIN cairn_projects p ON p.id = m.project_id
           WHERE m.id = ? AND m.tenant_id = ? LIMIT 1`,
    args: [String(milestoneId || '').trim(), tenantId],
  });
  if (!ms.rows.length) return { ok: false, error: 'not_found' };
  const row = ms.rows[0] as any;
  if (row.signed_at != null) return { ok: false, error: 'locked' };
  return { ok: true, projectId: String(row.project_id) };
}

/** Edit a draft milestone in place. Refused once the schedule is sealed. */
export async function updateMilestone(
  tenantId: string,
  milestoneId: string,
  input: MilestoneInput,
): Promise<AddMilestoneResult> {
  await ensureCairnTables();
  const can = await milestoneDraft(tenantId, milestoneId);
  if (!can.ok) return { ok: false, error: can.error, message: can.error === 'locked'
    ? 'This schedule is signed and sealed; its milestones no longer change.'
    : 'Milestone not found.' };

  const title = clampStr(input.title, 200);
  const description = input.description != null ? clampStr(input.description, 2000) || null : null;
  const trancheAmount = Number(input.trancheAmount);
  const targetDate = isYmd(input.targetDate) ? input.targetDate : null;
  if (!title) return { ok: false, error: 'invalid', message: 'A milestone title is required.' };
  if (!Number.isFinite(trancheAmount) || trancheAmount < 0) {
    return { ok: false, error: 'invalid', message: 'Tranche amount must be zero or more.' };
  }

  // Over-allocation check, with this milestone's own money given back first.
  const totRow = await db.execute({
    sql: `SELECT p.total_value,
                 COALESCE((SELECT SUM(m2.tranche_amount) FROM cairn_milestones m2
                            WHERE m2.project_id = p.id AND m2.id <> ?), 0) AS others
            FROM cairn_projects p WHERE p.id = ? LIMIT 1`,
    args: [String(milestoneId).trim(), can.projectId],
  });
  const totalValueU = Number((totRow.rows[0] as any)?.total_value ?? 0);
  const others = Number((totRow.rows[0] as any)?.others ?? 0);
  if (totalValueU > 0 && others + trancheAmount > totalValueU + 0.005) {
    const left = Math.max(0, totalValueU - others);
    return { ok: false, error: 'over_allocated', message: `Only ${left.toLocaleString('en-US')} is left to place on this project.` };
  }

  await db.execute({
    sql: `UPDATE cairn_milestones
             SET title = ?, description = ?, tranche_amount = ?, target_date = ?
           WHERE id = ? AND tenant_id = ?`,
    args: [title, description, trancheAmount, targetDate, String(milestoneId).trim(), tenantId],
  });
  await touchProject(can.projectId);
  return { ok: true, id: String(milestoneId).trim(), signed: false };
}

/** Remove a draft milestone. Later seats shuffle up so the schedule stays 1..N. */
export async function deleteMilestone(
  tenantId: string, milestoneId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureCairnTables();
  const can = await milestoneDraft(tenantId, milestoneId);
  if (!can.ok) return can;
  const id = String(milestoneId).trim();
  const seqRow = await db.execute({ sql: `SELECT seq FROM cairn_milestones WHERE id = ? LIMIT 1`, args: [id] });
  const seq = Number((seqRow.rows[0] as any)?.seq ?? 0);
  await db.execute({ sql: `DELETE FROM cairn_documents WHERE milestone_id = ? AND tenant_id = ?`, args: [id, tenantId] });
  await db.execute({
    sql: `UPDATE cairn_invites SET revoked_at = ?
           WHERE milestone_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), id],
  });
  await db.execute({ sql: `DELETE FROM cairn_milestones WHERE id = ? AND project_id = ?`, args: [id, can.projectId] });
  await db.execute({
    sql: `UPDATE cairn_milestones SET seq = seq - 1 WHERE project_id = ? AND seq > ?`,
    args: [can.projectId, seq],
  });
  await touchProject(can.projectId);
  return { ok: true };
}

/**
 * The deliberate act: sign the whole schedule at once. Each milestone gets its signed
 * manifest; the project manifest embeds every milestone digest and is signed over the lot;
 * the project digest is stamped to Bitcoin (non-fatal). After this, the schedule is
 * read-only and inspectors can be invited.
 */
export async function sealProject(
  tenantId: string,
  projectId: string,
): Promise<{ ok: true; digest: string; milestones: number; anchored: boolean } | { ok: false; error: string; message?: string }> {
  await ensureCairnTables();
  const pr = await db.execute({
    sql: `SELECT id, name, counterparty, total_value, currency, description, is_test, signed_at
            FROM cairn_projects WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(projectId || '').trim(), tenantId],
  });
  if (!pr.rows.length) return { ok: false, error: 'not_found', message: 'Project not found.' };
  const p = pr.rows[0] as any;
  if (p.signed_at != null) return { ok: false, error: 'already_sealed', message: 'This schedule is already signed and sealed.' };

  const ms = await db.execute({
    sql: `SELECT id, seq, title, description, tranche_amount, target_date
            FROM cairn_milestones WHERE project_id = ? AND tenant_id = ? ORDER BY seq ASC`,
    args: [String(p.id), tenantId],
  });
  if (!ms.rows.length) return { ok: false, error: 'empty', message: 'Add at least one milestone before sealing.' };

  // A schedule cannot promise more money than the project has. Under-allocation is
  // legitimate (retention, contingency, a phase to be scheduled later); over-allocation is
  // an arithmetic error, and the moment of signing is the last honest place to catch it.
  const allocated = (ms.rows as any[]).reduce((s, r) => s + (Number(r.tranche_amount) || 0), 0);
  if (allocated > Number(p.total_value) + 0.005) {
    return {
      ok: false, error: 'over_allocated',
      message: `The milestones promise ${allocated.toLocaleString('en-US')} against a project total of ${Number(p.total_value).toLocaleString('en-US')}. Fix the tranches before sealing.`,
    };
  }

  // Sign each milestone, collecting digests in schedule order.
  const schedule: Array<Record<string, unknown>> = [];
  for (const r of ms.rows as any[]) {
    const milestone: Record<string, unknown> = {
      projectId: String(p.id), seq: Number(r.seq), title: String(r.title),
      trancheAmount: Number(r.tranche_amount),
    };
    if (r.description != null && String(r.description)) milestone.description = String(r.description);
    if (r.target_date != null && String(r.target_date)) milestone.targetDate = String(r.target_date);
    const manifest = { v: 1, kind: 'cairn_milestone', milestone };
    const { signature, digest } = sign(manifest);
    await db.execute({
      sql: `UPDATE cairn_milestones SET manifest_json = ?, signature_json = ?, digest = ? WHERE id = ?`,
      args: [JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest, String(r.id)],
    });
    schedule.push({ seq: Number(r.seq), title: String(r.title), trancheAmount: Number(r.tranche_amount), digest });
  }

  // The project manifest seals the whole schedule: every milestone digest inside it.
  const isTest = p.is_test === true || p.is_test === 1 || String(p.is_test) === 'true';
  const project: Record<string, unknown> = {
    name: String(p.name), counterparty: String(p.counterparty),
    totalValue: Number(p.total_value), currency: String(p.currency),
  };
  if (p.description != null && String(p.description)) project.description = String(p.description);
  if (isTest) project.isTest = true;
  const manifest = { v: 1, kind: 'cairn_project', project, schedule };
  const { signature, digest } = sign(manifest);
  await db.execute({
    sql: `UPDATE cairn_projects SET manifest_json = ?, signature_json = ?, digest = ?, signed_at = ? WHERE id = ?`,
    args: [JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest, nowUtc(), String(p.id)],
  });

  // Stamp the sealed schedule's digest to Bitcoin while the moment is fresh (non-fatal).
  let anchored = false;
  try {
    const { OpenTimestampsAnchor } = await import('@/lib/rwaProof/anchorOpenTimestamps');
    const receipt = await new OpenTimestampsAnchor().stamp(digest.toLowerCase());
    await db.execute({ sql: `UPDATE cairn_projects SET anchor_json = ? WHERE id = ?`, args: [JSON.stringify(receipt), String(p.id)] });
    anchored = true;
  } catch { /* anchor later; the signature already binds the content */ }

  await touchProject(String(p.id));
  return { ok: true, digest, milestones: schedule.length, anchored };
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function listProjects(tenantId: string): Promise<ProjectSummary[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT p.id, p.name, p.counterparty, p.total_value, p.currency, p.is_test, p.signed_at,
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
    sealedAt: row.signed_at != null ? String(row.signed_at) : null,
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
): Promise<{ project: ProjectSummary; milestones: MilestoneSummary[]; attestations: AttestationSummary[]; documents: CairnDocMeta[] } | null> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, name, counterparty, total_value, currency, is_test, signed_at, created_at,
                 COALESCE(updated_at, created_at) AS last_activity
          FROM cairn_projects WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(projectId), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  const milestones = await listMilestones(tenantId, String(row.id));
  const attestations = await listAttestations(tenantId, String(row.id));
  const documents = await listProjectDocuments(tenantId, String(row.id));
  return {
    project: {
      id: String(row.id),
      name: String(row.name),
      counterparty: String(row.counterparty),
      totalValue: Number(row.total_value),
      currency: String(row.currency),
      isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
      sealedAt: row.signed_at != null ? String(row.signed_at) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.last_activity ?? row.created_at),
      milestoneCount: milestones.length,
    },
    milestones,
    attestations,
    documents,
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
  findings: string | null;
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
    sql: `SELECT m.id, p.signed_at
            FROM cairn_milestones m JOIN cairn_projects p ON p.id = m.project_id
           WHERE m.id = ? AND m.project_id = ? AND m.tenant_id = ? LIMIT 1`,
    args: [milestoneId, projectId, tenantId],
  });
  if (!owns.rows.length) return { ok: false, error: 'not_found' };
  // Drafts take no inspectors: an attestation must bind to a milestone that can no longer
  // shift under the inspector's feet. Seal the schedule first.
  if ((owns.rows[0] as any).signed_at == null) return { ok: false, error: 'draft' };

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
      status: MilestoneStatus; sentTo: string | null; isTest: boolean; documents: CairnDocMeta[] }
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
    documents: (await listMilestoneDocuments(String(row.milestone_id))).filter((d) => !d.purgedAt),
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
  answers: { by: string; title?: string | null; note?: string | null; findings?: string | null },
): Promise<{ ok: true; attestationId: string; milestoneId: string } | { ok: false; error: string }> {
  await ensureCairnTables();
  const req = await readAttestRequest(token);
  if (!req.ok) return { ok: false, error: req.error };

  const by = clampStr(answers.by, 100);
  if (!by) return { ok: false, error: 'name_required' };
  const roleTitle = answers.title ? clampStr(answers.title, 60) : null;
  const note = answers.note ? clampStr(answers.note, 600) : null;
  // The condition report: what the inspector found, in their words, at whatever length the
  // site deserves. It travels inside the signed manifest, so the description is as
  // un-backdatable and un-editable as the verdict itself.
  const findings = answers.findings ? clampStr(answers.findings, 4000) : null;
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
  const found = findings ? ' Findings on record.' : '';
  const statement =
    outcome === 'reached'
      ? `REACHED. Attests ${stage} is reached${note ? `. Note: ${note}` : ''}.${found} Answered by ${by}${titled}${via}.`
    : outcome === 'not_reached'
      ? `NOT_REACHED. Attests ${stage} is not yet reached${note ? `. Note: ${note}` : ''}.${found} Answered by ${by}${titled}${via}.`
      : `DISPUTED — ${note}. ${stage[0].toUpperCase()}${stage.slice(1)}.${found} Answered by ${by}${titled}${via}.`;

  const manifest: Record<string, unknown> = {
    v: 1, kind: 'cairn_attestation',
    milestoneId: req.milestoneId, projectId: req.projectId,
    role: 'inspector', by, statement, date,
  };
  if (roleTitle) manifest.title = roleTitle;
  if (findings) manifest.findings = findings;
  // Bind the exact paperwork on the milestone at answer time — the lender's form and the
  // inspector's own uploaded, signed copy alike. Swap any file afterward and its digest no
  // longer matches this signed manifest. Omitted entirely when absent so earlier
  // attestations' manifests stay byte-identical.
  const boundDocs = (await listMilestoneDocuments(req.milestoneId)).filter((d) => !d.purgedAt);
  if (boundDocs.length) {
    manifest.docs = boundDocs
      .map((d) => ({ sha256: d.sha256, filename: d.filename }))
      .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  }
  const { signature, digest } = sign(manifest);
  const attestationId = randomUUID();
  await db.execute({
    sql: `INSERT INTO cairn_attestations
            (id, milestone_id, project_id, tenant_id, role, attested_by, attester_title, statement, findings, attested_at, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, 'inspector', ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      attestationId, req.milestoneId, req.projectId, fromTenant, by, roleTitle, statement, findings, date,
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
    sql: `SELECT id, milestone_id, role, attested_by, attester_title, statement, findings, attested_at, digest, anchor_json
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
    findings: row.findings != null ? String(row.findings) : null,
    attestedAt: String(row.attested_at),
    digest: String(row.digest),
    anchored: row.anchor_json != null,
  }));
}

// ── Milestone paperwork (both directions) ─────────────────────────────────────

export const CAIRN_DOC_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB, same as the other registries
export const CAIRN_DOC_ALLOWED_TYPES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
];

export type CairnDocKind = 'form' | 'report' | 'photo' | 'signature';

export interface CairnDocMeta {
  id: string;
  milestoneId: string;
  uploadedBy: 'owner' | 'inspector';
  kind: CairnDocKind;
  filename: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  uploadedAt: string;
  purgedAt: string | null;
}

function cairnDocRow(r: any): CairnDocMeta {
  return {
    id: String(r.id),
    milestoneId: String(r.milestone_id),
    uploadedBy: String(r.uploaded_by) === 'inspector' ? 'inspector' : 'owner',
    kind: (['form', 'report', 'photo', 'signature'].includes(String(r.kind))
      ? String(r.kind) : String(r.uploaded_by) === 'inspector' ? 'report' : 'form') as CairnDocKind,
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    fileSize: Number(r.file_size || 0),
    sha256: String(r.sha256),
    uploadedAt: String(r.uploaded_at),
    purgedAt: r.purged_at != null ? String(r.purged_at) : null,
  };
}

function checkDocInput(mimeType: string, bytes: Buffer): string | null {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (!CAIRN_DOC_ALLOWED_TYPES.includes(mime)) return 'unsupported_type';
  if (!bytes?.length) return 'empty';
  if (bytes.length > CAIRN_DOC_MAX_SIZE_BYTES) return 'too_large';
  return null;
}

async function insertCairnDoc(
  milestoneId: string, projectId: string, tenantId: string,
  uploadedBy: 'owner' | 'inspector',
  input: { filename: string; mimeType: string; bytes: Buffer; kind?: CairnDocKind },
): Promise<CairnDocMeta> {
  const mime = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
  const filename = clampStr(input.filename, 200) || 'document';
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const kind: CairnDocKind = uploadedBy === 'owner' ? 'form'
    : (['report', 'photo', 'signature'].includes(String(input.kind)) ? input.kind! : 'report');
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO cairn_documents
            (id, milestone_id, project_id, tenant_id, uploaded_by, kind, filename, mime_type, file_size, sha256, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, milestoneId, projectId, tenantId, uploadedBy, kind, filename, mime,
           input.bytes.length, sha256, input.bytes.toString('base64')],
  });
  const r = await db.execute({
    sql: `SELECT id, milestone_id, uploaded_by, kind, filename, mime_type, file_size, sha256, uploaded_at, purged_at
            FROM cairn_documents WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return cairnDocRow(r.rows[0]);
}

/** The lender attaches the report form the inspector is asked to use. Owner only. */
export async function addMilestoneDocument(
  tenantId: string,
  milestoneId: string,
  input: { filename: string; mimeType: string; bytes: Buffer },
): Promise<{ ok: true; doc: CairnDocMeta } | { ok: false; error: string }> {
  await ensureCairnTables();
  const ms = await db.execute({
    sql: `SELECT id, project_id FROM cairn_milestones WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(milestoneId || '').trim(), tenantId],
  });
  if (!ms.rows.length) return { ok: false, error: 'not_found' };
  const bad = checkDocInput(input.mimeType, input.bytes);
  if (bad) return { ok: false, error: bad };
  const doc = await insertCairnDoc(
    String((ms.rows[0] as any).id), String((ms.rows[0] as any).project_id), tenantId, 'owner', input);
  return { ok: true, doc };
}

/**
 * The inspector uploads the completed, signed form from the site — phone photo or PDF —
 * through the same single-use token, while it is still open. Answering closes uploads
 * along with everything else, which is the right order: the paperwork goes on file first,
 * then the answer seals it (every file's sha256 lands in the signed manifest).
 */
export async function addCairnDocumentByToken(
  token: string,
  input: { filename: string; mimeType: string; bytes: Buffer; kind?: CairnDocKind },
): Promise<{ ok: true; doc: CairnDocMeta } | { ok: false; error: string }> {
  await ensureCairnTables();
  const req = await readAttestRequest(token);
  if (!req.ok) return { ok: false, error: req.error };
  const bad = checkDocInput(input.mimeType, input.bytes);
  if (bad) return { ok: false, error: bad };
  const sender = await db.execute({
    sql: `SELECT from_tenant FROM cairn_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const doc = await insertCairnDoc(
    req.milestoneId, req.projectId, String((sender.rows[0] as any)?.from_tenant ?? ''), 'inspector', input);
  return { ok: true, doc };
}

/** Metadata for every document on one milestone, tombstones included. */
export async function listMilestoneDocuments(milestoneId: string): Promise<CairnDocMeta[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, milestone_id, uploaded_by, kind, filename, mime_type, file_size, sha256, uploaded_at, purged_at
            FROM cairn_documents WHERE milestone_id = ? ORDER BY uploaded_at ASC`,
    args: [String(milestoneId || '').trim()],
  });
  return r.rows.map(cairnDocRow);
}

/** All paperwork on a project the tenant owns — the desk's per-milestone file lists. */
export async function listProjectDocuments(tenantId: string, projectId: string): Promise<CairnDocMeta[]> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, milestone_id, uploaded_by, kind, filename, mime_type, file_size, sha256, uploaded_at, purged_at
            FROM cairn_documents WHERE project_id = ? AND tenant_id = ? ORDER BY uploaded_at ASC`,
    args: [String(projectId || '').trim(), tenantId],
  });
  return r.rows.map(cairnDocRow);
}

/** The bytes, owner-scoped. Null once purged — a tombstone has no document to give. */
export async function readCairnDocument(
  tenantId: string,
  documentId: string,
): Promise<{ meta: CairnDocMeta; data: Buffer } | null> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT id, milestone_id, uploaded_by, kind, filename, mime_type, file_size, sha256, uploaded_at, purged_at, data
            FROM cairn_documents WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(documentId || '').trim(), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.data == null) return null;
  return { meta: cairnDocRow(row), data: Buffer.from(String(row.data), 'base64') };
}

/**
 * The bytes, by token — the inspector saving or printing the form. Deliberately NOT
 * readAttestRequest: answering spends the right to answer, not the right to read the
 * paperwork you just put your name against. Revoked and expired still close it.
 */
export async function readCairnDocumentByToken(
  token: string,
  documentId: string,
): Promise<{ meta: CairnDocMeta; data: Buffer } | null> {
  await ensureCairnTables();
  const r = await db.execute({
    sql: `SELECT milestone_id, expires_at, revoked_at FROM cairn_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.revoked_at) return null;
  if (String(row.expires_at) < nowUtc()) return null;
  const d = await db.execute({
    sql: `SELECT id, milestone_id, uploaded_by, kind, filename, mime_type, file_size, sha256, uploaded_at, purged_at, data
            FROM cairn_documents WHERE id = ? AND milestone_id = ? LIMIT 1`,
    args: [String(documentId || '').trim(), String(row.milestone_id)],
  });
  if (!d.rows.length) return null;
  const doc = d.rows[0] as any;
  if (doc.data == null) return null;
  return { meta: cairnDocRow(doc), data: Buffer.from(String(doc.data), 'base64') };
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
