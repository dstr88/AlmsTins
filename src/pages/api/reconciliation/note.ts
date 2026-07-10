/**
 * POST /api/reconciliation/note
 *
 * Upserts a reconciliation note for an asset symbol.
 * If flaggedForSupport is true, sends an email notification.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

export const prerender = false;

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session ?? {};
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (!body || typeof body !== 'object') return new Response('Invalid body', { status: 400 });

    const b = body as Record<string, unknown>;
    const assetSymbol      = typeof b.assetSymbol === 'string' ? b.assetSymbol.trim().toUpperCase() : '';
    const note             = typeof b.note === 'string' ? b.note.trim() : '';
    const flaggedForSupport = (b.flaggedForSupport === true || b.flaggedForSupport === 1) ? 1 : 0;

    if (!assetSymbol) return new Response('Missing assetSymbol', { status: 400 });

    const now = new Date().toISOString();
    const id  = randomId();

    await db.execute({
      sql: `INSERT INTO reconciliation_notes
              (id, tenant_id, asset_symbol, note, flagged_for_support, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, asset_symbol) DO UPDATE SET
              note                = excluded.note,
              flagged_for_support = excluded.flagged_for_support,
              updated_at          = excluded.updated_at`,
      args: [id, tenantId, assetSymbol, note || null, flaggedForSupport, now, now],
    });

    // Email notification when flagged for support
    if (flaggedForSupport) {
      try {
        const emailServer = import.meta.env.EMAIL_SERVER;
        const emailFrom   = import.meta.env.EMAIL_FROM;
        if (emailServer && emailFrom) {
          const { default: nodemailer } = await import('nodemailer');
          const transport = nodemailer.createTransport(emailServer);
          await transport.sendMail({
            to:      'donnie@titaniumhut.com',
            from:    emailFrom,
            subject: `[almsTins] Reconciliation help needed — ${assetSymbol}`,
            text: [
              `A user flagged ${assetSymbol} for support in the reconciliation view.`,
              ``,
              `Tenant ID: ${tenantId}`,
              `Asset:     ${assetSymbol}`,
              `Note:      ${note || '(none provided)'}`,
              ``,
              `Log in to the admin panel to review their data.`,
            ].join('\n'),
          });
        }
      } catch (emailErr) {
        console.warn('[reconciliation/note] email notification failed:', emailErr);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[reconciliation/note]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
