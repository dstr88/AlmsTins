/**
 * GET  /api/community-rating?kind=wallet&subject=<addr>  — public
 *   Returns aggregate rating counts + up to 10 most-recent notes for a subject.
 *
 * POST /api/community-rating  — auth + paid plan required
 *   Body: { kind, subject, rating, note? }
 *   Upserts one rating per tenant per subject.
 *
 * DELETE /api/community-rating?kind=wallet&subject=<addr>  — auth required
 *   Removes the calling tenant's own rating for a subject.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { db } from '@/lib/db';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const VALID_KINDS    = new Set(['wallet', 'dapp']);
const VALID_RATINGS  = new Set(['safe', 'suspicious', 'scam']);
const NOTE_MAX       = 280;
const SUBJECT_MAX    = 512;

/** Normalize subject before storage so variants don't create duplicate rows. */
function normalizeSubject(kind: string, subject: string): string {
  const s = subject.trim();
  if (kind === 'wallet') {
    // EVM addresses are hex — the protocol is case-insensitive, EIP-55 mixed case
    // is only a checksum convention. Safe to canonicalize to lowercase.
    // Bitcoin/Solana/TRON/Litecoin use Base58, which IS case-sensitive — leave as-is.
    return /^0x[0-9a-fA-F]{40}$/.test(s) ? s.toLowerCase() : s;
  }
  // For dApp URLs: lowercase domain only; strip trailing slash
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    return (u.hostname + u.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function ensureTable(): Promise<void> {
  return db
    .execute({
      sql: `CREATE TABLE IF NOT EXISTS community_ratings (
              id          BIGSERIAL   PRIMARY KEY,
              tenant_id   TEXT        NOT NULL,
              kind        TEXT        NOT NULL,
              subject     TEXT        NOT NULL,
              rating      TEXT        NOT NULL,
              note        TEXT,
              created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE (tenant_id, kind, subject)
            )`,
    })
    .then(() =>
      db.execute({
        sql: `CREATE INDEX IF NOT EXISTS community_ratings_subject_idx ON community_ratings (kind, subject)`,
      }),
    )
    .then(() =>
      db.execute({
        sql: `CREATE INDEX IF NOT EXISTS community_ratings_tenant_idx ON community_ratings (tenant_id, kind, subject)`,
      }),
    )
    .then(() => {});
}

// ── GET — public aggregate ────────────────────────────────────────────────────

export const GET: APIRoute = async ({ url }) => {
  const kind    = url.searchParams.get('kind')?.trim() ?? '';
  const subject = url.searchParams.get('subject')?.trim() ?? '';

  if (!VALID_KINDS.has(kind))    return json({ ok: false, error: 'Invalid kind' }, 400);
  if (!subject || subject.length > SUBJECT_MAX) return json({ ok: false, error: 'Invalid subject' }, 400);

  const normalized = normalizeSubject(kind, subject);

  try {
    await ensureTable();

    const [countRes, notesRes] = await Promise.all([
      db.execute({
        sql: `SELECT rating, COUNT(*) AS n
              FROM community_ratings
              WHERE kind = ? AND subject = ?
              GROUP BY rating`,
        args: [kind, normalized],
      }),
      db.execute({
        sql: `SELECT note, rating, created_at
              FROM community_ratings
              WHERE kind = ? AND subject = ? AND note IS NOT NULL AND note <> ''
              ORDER BY updated_at DESC
              LIMIT 10`,
        args: [kind, normalized],
      }),
    ]);

    const counts: Record<string, number> = { safe: 0, suspicious: 0, scam: 0 };
    for (const row of countRes.rows as Array<{ rating: string; n: number }>) {
      if (row.rating in counts) counts[row.rating] = Number(row.n);
    }

    const notes = (notesRes.rows as Array<{ note: string; rating: string; created_at: string }>).map(r => ({
      rating: r.rating,
      note:   r.note,
      date:   String(r.created_at ?? '').slice(0, 10),
    }));

    const total = counts.safe + counts.suspicious + counts.scam;

    return json({ ok: true, counts, notes, total, subject: normalized });
  } catch (err) {
    console.error('[community-rating GET]', err);
    return json({ ok: false, error: 'Failed to fetch ratings' }, 500);
  }
};

// ── POST — auth + paid ────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  const plan = await getActivePlan(tenantId);
  if (plan.id === 'free') {
    return json({ ok: false, error: 'upgrade_required', planRequired: 'paid' }, 403);
  }

  let body: { kind?: unknown; subject?: unknown; rating?: unknown; note?: unknown } = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const kind    = String(body.kind    ?? '').trim();
  const subject = String(body.subject ?? '').trim();
  const rating  = String(body.rating  ?? '').trim();
  const note    = body.note != null ? String(body.note).trim().slice(0, NOTE_MAX) : null;

  if (!VALID_KINDS.has(kind))    return json({ ok: false, error: 'Invalid kind' }, 400);
  if (!VALID_RATINGS.has(rating)) return json({ ok: false, error: 'Invalid rating' }, 400);
  if (!subject || subject.length > SUBJECT_MAX) return json({ ok: false, error: 'Invalid subject' }, 400);

  const normalized = normalizeSubject(kind, subject);

  try {
    await ensureTable();
    await db.execute({
      sql: `INSERT INTO community_ratings (tenant_id, kind, subject, rating, note)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, kind, subject)
            DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note, updated_at = now()`,
      args: [tenantId, kind, normalized, rating, note ?? null],
    });
    return json({ ok: true });
  } catch (err) {
    console.error('[community-rating POST]', err);
    return json({ ok: false, error: 'Failed to save rating' }, 500);
  }
};

// ── DELETE — auth, own rating only ───────────────────────────────────────────

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  const kind    = url.searchParams.get('kind')?.trim() ?? '';
  const subject = url.searchParams.get('subject')?.trim() ?? '';

  if (!VALID_KINDS.has(kind))    return json({ ok: false, error: 'Invalid kind' }, 400);
  if (!subject || subject.length > SUBJECT_MAX) return json({ ok: false, error: 'Invalid subject' }, 400);

  const normalized = normalizeSubject(kind, subject);

  try {
    await ensureTable();
    await db.execute({
      sql: `DELETE FROM community_ratings WHERE tenant_id = ? AND kind = ? AND subject = ?`,
      args: [tenantId, kind, normalized],
    });
    return json({ ok: true });
  } catch (err) {
    console.error('[community-rating DELETE]', err);
    return json({ ok: false, error: 'Failed to delete rating' }, 500);
  }
};

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS });
