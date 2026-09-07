/**
 * POST /api/verify/cairn/milestone — add + sign a milestone on a project (authenticated).
 *
 * Body: { projectId, title, description?, trancheAmount, targetDate? }
 *
 * Owner-scoped: you can only add milestones to a project you created. Each milestone is signed
 * on write and gets the next sequence number in the project. No money moves here.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addMilestone } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await addMilestone(session.tenantId, String(body.projectId ?? ''), {
    title: String(body.title ?? ''),
    description: body.description ?? null,
    trancheAmount: Number(body.trancheAmount),
    targetDate: body.targetDate ?? null,
  });

  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 400);
};
