/**
 * Download links for a milestone desk project's paperwork, for parties who hold no account.
 *
 * GET   ?t=<token>                  — the project's paperwork as a page of links (public)
 * GET   ?t=<token>&id=<documentId>  — one file, read-only (public)
 * GET   ?projectId=…                — the owner's links with their state (authenticated)
 * POST  { action: 'create', projectId, label, days?, milestoneId? } — mint one link; the link comes back once
 *                                                                  (milestoneId limits it to one milestone)
 * POST  { action: 'revoke', id }    — withdraw one link (authenticated)
 *
 * The token is the authority for the two public reads. It opens that project's live files and
 * nothing else, until it expires or is revoked. Every other branch needs the owner's session.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import {
  createShareLink, listShareLinks, revokeShareLink,
  readShareLink, listShareDocuments, readShareDocument,
  type CairnDocMeta,
} from '@/lib/cairnRegistry';
import { json } from '@/lib/http';

export const prerender = false;

const pageHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

const KIND_LABEL: Record<string, string> = {
  form: 'the lender form',
  report: 'the completed form',
  photo: 'site photo',
  signature: 'inspector signature',
};

const fileResponse = (found: { meta: { mimeType: string; filename: string }; data: Buffer }) =>
  new Response(new Uint8Array(found.data), {
    status: 200,
    headers: {
      'Content-Type': found.meta.mimeType,
      'Content-Disposition': `inline; filename="${found.meta.filename.replace(/["\\]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const page = (status: number, title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:2rem auto;padding:0 16px;` +
    `line-height:1.5;color:#1a1a1a}li{margin:.6rem 0}small{color:#666}</style></head>` +
    `<body>${body}</body></html>`,
    { status, headers: pageHeaders },
  );

function linksPage(token: string, label: string | null, docs: CairnDocMeta[], limited: boolean): string {
  const items = docs.length
    ? docs.map((d) =>
        `<li><a href="?t=${encodeURIComponent(token)}&amp;id=${encodeURIComponent(d.id)}">${esc(d.filename)}</a>` +
        ` <small>${esc(KIND_LABEL[d.kind] ?? d.kind)} · ${Math.round((d.fileSize || 0) / 1024)} KB · ` +
        `${esc(String(d.uploadedAt).slice(0, 10))}</small></li>`).join('')
    : '<li>No paperwork on this project yet.</li>';
  return `<h1>Paperwork${label ? ` for ${esc(label)}` : ''}</h1>` +
    `<p>Read-only copies of the paperwork${limited ? ' for one milestone' : ' on this project'}. This link ` +
    `expires on its own date, and the person who sent it can withdraw it.</p><ul>${items}</ul>`;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');

  // Token path: no session, no account. The link is the authority, for this project only.
  if (token) {
    const link = await readShareLink(token);
    if (!link) {
      return page(404, 'Link unavailable', '<h1>This link is no longer available</h1>' +
        '<p>It may have expired or been withdrawn. Ask the person who sent it for a new one.</p>');
    }
    const docId = url.searchParams.get('id');
    if (docId) {
      const found = await readShareDocument(link.tenantId, link.projectId, docId, link.milestoneId);
      if (!found) return page(404, 'Not found', '<h1>That file is not available</h1>');
      return fileResponse(found);
    }
    const docs = await listShareDocuments(link.tenantId, link.projectId, link.milestoneId);
    return page(200, 'Paperwork', linksPage(token, link.label, docs, link.milestoneId != null));
  }

  // The owner's list of links. A demo session sees nothing here.
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'not_found' }, 404);
  const projectId = String(url.searchParams.get('projectId') ?? '').trim();
  if (!projectId) return json({ ok: false, error: 'project_required' }, 400);
  return json({ ok: true, links: await listShareLinks(session.tenantId, projectId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'expected_json' }, 400); }

  if (body?.action === 'revoke') {
    const ok = await revokeShareLink(session.tenantId, String(body.id ?? ''));
    return json({ ok }, ok ? 200 : 404);
  }

  if (body?.action === 'create') {
    const made = await createShareLink(session.tenantId, {
      projectId: String(body.projectId ?? ''),
      label: body.label ?? null,
      days: body.days,
      milestoneId: body.milestoneId ?? null,
    });
    if (!made.ok) return json(made, 404);
    const origin = new URL(request.url).origin;
    return json({
      ok: true,
      id: made.id,
      link: `${origin}/api/verify/cairn/share?t=${encodeURIComponent(made.token)}`,
      expiresAt: made.expiresAt,
    });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
};
