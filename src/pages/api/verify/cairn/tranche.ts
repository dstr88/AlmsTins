/**
 * POST /api/verify/cairn/tranche — the funder records a milestone's tranche as paid (authenticated;
 * tier T5).
 *
 * Body: { milestoneId, by, amount?, date?, note? }
 *
 * The third signature a milestone can carry, after the inspector's attestation (required first: the
 * funder releases against proof). A signed, dated record in the funder's own role; no money moves
 * here. One per milestone, ever. Owner-scoped; refused on a draft or a closed project.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { acknowledgeTranche } from '@/lib/cairnRegistry';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const result = await acknowledgeTranche(session.tenantId, String(body.milestoneId ?? ''), {
    by: String(body.by ?? ''),
    amount: body.amount === undefined || body.amount === null || body.amount === '' ? null : Number(body.amount),
    date: body.date ? String(body.date) : null,
    note: body.note ? String(body.note) : null,
  });
  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['draft', 'closed', 'not_attested', 'already_paid'].includes(result.error) ? 409
    : 400;
  return json(result, status);
};
