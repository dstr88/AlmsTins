/**
 * petroReceipts.ts — Receipt registry for PetroTins
 *
 * A standalone, tenant-scoped registry of receipts the user keeps for their
 * tax preparer: an amount, what it was for, an optional category, and a photo
 * of the receipt (PNG/JPG/GIF/WEBP/PDF).
 *
 * Storage: the photo bytes are kept base64 in Postgres (same approach as
 * `transaction_screenshots`). Nothing auto-deletes them. The durable "keep it
 * for seven years" copy is the ZIP+CSV export (see receipts/export.ts) — an
 * independent artifact the user and their accountant hold outside the app.
 *
 * Boundaries: every query is scoped `WHERE tenant_id = ?`. No cross-tenant or
 * operator read path. This is the user's own record of their own spending.
 */

import { db } from './db';

// ── Upload constraints (mirror src/pages/api/research/attachment.ts) ───────────
export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
];

// ── Types ──────────────────────────────────────────────────────────────────────

/** Registry row WITHOUT the image bytes — what the list view consumes. */
export interface ReceiptMeta {
  id:          string;
  receiptDate: string;        // YYYY-MM-DD (date on the receipt)
  amount:      number;
  description: string | null; // "what it was for"
  category:    string | null; // optional grouping for the tax preparer
  filename:    string | null;
  mimeType:    string | null;
  fileSize:    number | null;
  hasPhoto:    boolean;
  createdAt:   string;
}

/** Full row INCLUDING base64 bytes — used by the photo endpoint + export. */
export interface ReceiptWithData extends ReceiptMeta {
  data: string | null; // base64-encoded photo
}

// ── Lazy table ensure ──────────────────────────────────────────────────────────
//
// Durable schema lives in migrations-pg/0008_petro_receipts.sql, but we also
// self-create lazily (idempotent CREATE … IF NOT EXISTS, routed to the owner
// pool by db.pg.ts's isSchemaDDL) so the feature works on a deploy even before
// that migration is applied manually — same pattern as the other petro tables.

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS petro_receipts (
    id           TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    receipt_date TEXT NOT NULL,
    amount       REAL NOT NULL DEFAULT 0,
    description  TEXT,
    category     TEXT,
    filename     TEXT,
    mime_type    TEXT,
    data         TEXT,
    file_size    INTEGER,
    created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

const ENSURE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_petro_receipts_tenant
    ON petro_receipts (tenant_id, receipt_date DESC, created_at DESC)
`;

let tableEnsured = false;
export async function ensureReceiptsTable(): Promise<void> {
  if (tableEnsured) return;
  await db.execute({ sql: ENSURE_TABLE_SQL, args: [] });
  await db.execute({ sql: ENSURE_INDEX_SQL, args: [] });
  tableEnsured = true;
}

// ── Row mapping ─────────────────────────────────────────────────────────────────

function mapMeta(r: any): ReceiptMeta {
  return {
    id:          String(r.id),
    receiptDate: String(r.receipt_date),
    amount:      r.amount != null ? Number(r.amount) : 0,
    description: r.description != null ? String(r.description) : null,
    category:    r.category != null ? String(r.category) : null,
    filename:    r.filename != null ? String(r.filename) : null,
    mimeType:    r.mime_type != null ? String(r.mime_type) : null,
    fileSize:    r.file_size != null ? Number(r.file_size) : null,
    hasPhoto:    Number(r.has_photo ?? 0) === 1,
    createdAt:   String(r.created_at),
  };
}

// ── Queries (all tenant-scoped) ─────────────────────────────────────────────────

/**
 * List receipt metadata for a tenant, newest first. Never selects `data` so the
 * registry loads fast regardless of how many large photos are stored.
 * Optional `year` (YYYY) filters by the receipt date.
 */
export async function listReceipts(tenantId: string, year?: string): Promise<ReceiptMeta[]> {
  await ensureReceiptsTable();
  const where = ['tenant_id = ?'];
  const args: any[] = [tenantId];
  if (year && /^\d{4}$/.test(year)) {
    where.push('receipt_date LIKE ?');
    args.push(`${year}%`);
  }
  const res = await db.execute({
    sql: `SELECT id, receipt_date, amount, description, category, filename, mime_type, file_size,
                 (CASE WHEN data IS NOT NULL THEN 1 ELSE 0 END) AS has_photo, created_at
          FROM petro_receipts
          WHERE ${where.join(' AND ')}
          ORDER BY receipt_date DESC, created_at DESC`,
    args,
  });
  return res.rows.map(mapMeta);
}

/** Fetch a single receipt's photo (base64 + mime), tenant-scoped. */
export async function getReceiptPhoto(
  tenantId: string,
  id: string,
): Promise<{ data: string; mimeType: string; filename: string | null } | null> {
  await ensureReceiptsTable();
  const res = await db.execute({
    sql: `SELECT data, mime_type, filename FROM petro_receipts WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  const row = res.rows[0] as any;
  if (!row || row.data == null) return null;
  return {
    data:     String(row.data),
    mimeType: row.mime_type != null ? String(row.mime_type) : 'application/octet-stream',
    filename: row.filename != null ? String(row.filename) : null,
  };
}

/** Fetch every receipt for a tenant INCLUDING the photo bytes — used by export. */
export async function getReceiptsForExport(tenantId: string, year?: string): Promise<ReceiptWithData[]> {
  await ensureReceiptsTable();
  const where = ['tenant_id = ?'];
  const args: any[] = [tenantId];
  if (year && /^\d{4}$/.test(year)) {
    where.push('receipt_date LIKE ?');
    args.push(`${year}%`);
  }
  const res = await db.execute({
    sql: `SELECT id, receipt_date, amount, description, category, filename, mime_type, file_size,
                 data, (CASE WHEN data IS NOT NULL THEN 1 ELSE 0 END) AS has_photo, created_at
          FROM petro_receipts
          WHERE ${where.join(' AND ')}
          ORDER BY receipt_date ASC, created_at ASC`,
    args,
  });
  return res.rows.map(r => ({ ...mapMeta(r), data: (r as any).data != null ? String((r as any).data) : null }));
}
