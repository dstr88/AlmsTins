/**
 * POST /api/verify/cairn/milestone — add, replace, or remove a milestone (authenticated).
 *
 * Body: { projectId, title, description?, trancheAmount, targetDate? }         — add
 *       { …same, editMilestoneId }        — edit a DRAFT milestone in place
 *       { action: 'remove', milestoneId } — remove a DRAFT milestone (later seats shuffle up)
 *
 * Drafts only: while the project is unsealed, the schedule is the banker's to shape.
 * Sealing signs the lot and locks it. Owner-scoped throughout. No money moves here.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addMilestone, updateMilestone, deleteMilestone } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  if (body.action === 'remove') {
    const gone = await deleteMilestone(session.tenantId, String(body.milestoneId ?? ''));
    return gone.ok ? json(gone) : json(gone, gone.error === 'not_found' ? 404 : 409);
  }

  const input = {
    title: String(body.title ?? ''),
    description: body.description ?? null,
    trancheAmount: Number(body.trancheAmount),
    targetDate: body.targetDate ?? null,
  };

  const editId = String(body.editMilestoneId ?? '').trim();
  const result = editId
    ? await updateMilestone(session.tenantId, editId, input)
    : await addMilestone(session.tenantId, String(body.projectId ?? ''), input);

  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : result.error === 'locked' ? 409 : 400);
};
