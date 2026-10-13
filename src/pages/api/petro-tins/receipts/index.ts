/**
 * GET    /api/petro-tins/receipts        — list receipt metadata (no photo bytes); ?year=YYYY filter
 * POST   /api/petro-tins/receipts        — create a receipt (multipart: amount, description, category, receiptDate, file?)
 * PATCH  /api/petro-tins/receipts        — edit a receipt's fields (JSON: id, amount?, description?, category?, receiptDate?)
 * DELETE /api/petro-tins/receipts?id=    — delete a receipt
 *
 * Tenant-scoped registry the user keeps for their tax preparer. Demo sessions
 * are read-only (GET only). Photos are stored base64 in Postgres; the durable
 * copy is the ZIP+CSV export (./export).
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isOwner } from '@/lib/owner';
import {
  ensureReceiptsTable,
  listReceipts,
  ALLOWED_TYPES,
  MAX_SIZE_BYTES,
} from '@/lib/petroReceipts';
import { randomUUID } from 'crypto';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DESC_MAX = 200;
const CAT_MAX = 80;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── GET — list ──────────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (!isOwner(session.tenantId)) return json({ ok: false, error: 'not_available' }, 403);
  const { tenantId } = session;

  const url  = new URL(request.url);
  const year = url.searchParams.get('year') ?? undefined;

  const receipts = await listReceipts(tenantId, year);
  return json({ ok: true, receipts });
};

// ── POST — create (multipart) ─────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (!isOwner(session.tenantId)) return json({ ok: false, error: 'not_available' }, 403);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const { tenantId } = session;

  await ensureReceiptsTable();

  const form = await request.formData();

  const amount = Number(form.get('amount'));
  if (!isFinite(amount) || amount < 0) {
    return json({ ok: false, error: 'Invalid amount' }, 400);
  }

  let receiptDate = String(form.get('receiptDate') ?? '').trim();
  if (!ISO_DATE.test(receiptDate)) receiptDate = todayIso();

  const description = String(form.get('description') ?? '').trim().slice(0, DESC_MAX) || null;
  const category    = String(form.get('category')    ?? '').trim().slice(0, CAT_MAX)  || null;

  // Photo is optional — a receipt can be logged now and photographed later.
  let filename: string | null = null;
  let mimeType: string | null = null;
  let base64:   string | null = null;
  let fileSize: number | null = null;

  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return json({ ok: false, error: 'Unsupported file type. Use PNG, JPG, GIF, WEBP, or PDF.' }, 400);
    }
    if (file.size > MAX_SIZE_BYTES) {
      return json({ ok: false, error: 'File too large (max 5 MB).' }, 400);
    }
    const buffer = await file.arrayBuffer();
    base64   = Buffer.from(buffer).toString('base64');
    filename = file.name;
    mimeType = file.type;
    fileSize = file.size;
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO petro_receipts
            (id, tenant_id, receipt_date, amount, description, category, filename, mime_type, data, file_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tenantId, receiptDate, amount, description, category, filename, mimeType, base64, fileSize],
  });

  return json({ ok: true, id }, 201);
};

// ── PATCH — edit fields ─────────────────────────────────────────────────────────
export const PATCH: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (!isOwner(session.tenantId)) return json({ ok: false, error: 'not_available' }, 403);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const { tenantId } = session;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const id = String(body.id ?? '').trim();
  if (!id) return json({ ok: false, error: 'id required' }, 400);

  const fields: string[] = [];
  const args: any[] = [];

  if (body.amount !== undefined) {
    const amt = Number(body.amount);
    if (!isFinite(amt) || amt < 0) return json({ ok: false, error: 'Invalid amount' }, 400);
    fields.push('amount = ?'); args.push(amt);
  }
  if (body.description !== undefined) {
    fields.push('description = ?'); args.push(String(body.description).slice(0, DESC_MAX) || null);
  }
  if (body.category !== undefined) {
    fields.push('category = ?'); args.push(String(body.category).slice(0, CAT_MAX) || null);
  }
  if (body.receiptDate !== undefined) {
    const d = String(body.receiptDate).trim();
    if (!ISO_DATE.test(d)) return json({ ok: false, error: 'Invalid date' }, 400);
    fields.push('receipt_date = ?'); args.push(d);
  }

  if (!fields.length) return json({ ok: false, error: 'Nothing to update' }, 400);

  args.push(id, tenantId);
  await db.execute({
    sql: `UPDATE petro_receipts SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
    args,
  });

  return json({ ok: true });
};

// ── DELETE — remove ─────────────────────────────────────────────────────────────
export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (!isOwner(session.tenantId)) return json({ ok: false, error: 'not_available' }, 403);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const { tenantId } = session;

  const url = new URL(request.url);
  let id = url.searchParams.get('id') ?? '';
  if (!id) {
    let body: any = {};
    try { body = await request.json(); } catch { /* ignore */ }
    id = String(body.id ?? '').trim();
  }
  if (!id) return json({ ok: false, error: 'id required' }, 400);

  await db.execute({
    sql: `DELETE FROM petro_receipts WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });

  return json({ ok: true });
};
