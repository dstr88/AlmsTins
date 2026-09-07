/**
 * PPPcairn projects — create + list (authenticated).
 *
 * POST /api/verify/cairn/projects  — create + sign a project. Returns its ID (SHA-256 of the
 *   signed creation manifest), which is the capability handed to counterparties in later phases.
 * GET  /api/verify/cairn/projects  — list the projects this tenant created.
 * GET  /api/verify/cairn/projects?id=…  — one project this tenant owns, with its milestones.
 *
 * Writes are tenant-scoped. No money is moved here; this records and signs the project only.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createProject, listProjects, getProjectForOwner } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const id = url.searchParams.get('id') ?? '';
  if (id) {
    const found = await getProjectForOwner(session.tenantId, id);
    return found ? json({ ok: true, ...found }) : json({ ok: false, error: 'not_found' }, 404);
  }
  const projects = await listProjects(session.tenantId);
  return json({ ok: true, projects });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await createProject(session.tenantId, {
    name: String(body.name ?? ''),
    counterparty: String(body.counterparty ?? ''),
    totalValue: Number(body.totalValue),
    currency: String(body.currency ?? 'NGN'),
    description: body.description ?? null,
    isTest: body.isTest === true,
  });

  return result.ok ? json(result) : json(result, 400);
};
