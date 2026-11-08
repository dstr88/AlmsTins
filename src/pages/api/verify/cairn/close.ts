/**
 * POST /api/verify/cairn/close — close a project by signature (authenticated; tier T5, D13 / D14).
 *
 * Body: { projectId, kind: 'completed' | 'terminated' | 'abandoned', by, note? }
 *
 * `completed` needs the inspector's attestation on the final milestone and the funder's record of
 * its tranche paid, both already on the record; `terminated` and `abandoned` are the funder's own
 * statement, one signer. A closed project stays fully readable; nothing on the work paper expires.
 * Open inspector links die with the close. Owner-scoped; a draft is not closed, it is edited.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { closeProject } from '@/lib/cairnRegistry';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const result = await closeProject(session.tenantId, String(body.projectId ?? ''), {
    kind: String(body.kind ?? ''),
    by: String(body.by ?? ''),
    note: body.note ? String(body.note) : null,
  });
  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['already_closed', 'draft', 'final_milestone_unattested', 'final_tranche_unpaid', 'empty'].includes(result.error) ? 409
    : 400;
  return json(result, status);
};
