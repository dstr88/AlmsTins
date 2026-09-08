/**
 * Inspector requests on a milestone (authenticated).
 *
 * POST { projectId, milestoneId, email?, label? } -> mint a single-use inspector token
 * POST { action: 'revoke', token }                -> withdraw one you sent
 * GET  ?projectId=…                               -> the roster: everyone asked, and where each stands
 *
 * The token is random and single-use; a predictable one would be a standing key to the
 * attestation. Only the project's owner can mint, list, or revoke.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createInspectorInvite, revokeCairnInvite, listAttestRequests } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const projectId = url.searchParams.get('projectId') ?? '';
  if (!projectId) return json({ ok: false, error: 'project_required' }, 400);
  return json({ ok: true, requests: await listAttestRequests(session.tenantId, projectId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  if (body.action === 'revoke') {
    const done = await revokeCairnInvite(session.tenantId, String(body.token ?? ''));
    return done ? json({ ok: true }) : json({ ok: false, error: 'not_found' }, 404);
  }

  const result = await createInspectorInvite(session.tenantId, {
    projectId: String(body.projectId ?? ''),
    milestoneId: String(body.milestoneId ?? ''),
    email: body.email ?? null,
    label: body.label ?? null,
  });
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 400);
};
