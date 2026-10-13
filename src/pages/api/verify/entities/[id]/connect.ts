/**
 * POST /api/verify/entities/:id/connect — store the entity's hosted endpoint + API key
 * (key encrypted at rest), then pull its live address list into the mirror.
 * Body: { endpoint, apiKey }. Requires a proven domain. By approval only: answers 403
 * { error: 'not_approved' } for any other account, before reading the body.
 *
 * Returns { ok, outcome }, outcome ∈ pulled | not_proven | invalid_endpoint |
 * encryption_unavailable | no_endpoint | unauthorized | unreachable | malformed.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { connectEntity } from '@/lib/verifyEntities';
import { canPublishEntities, entityNotApprovedResponse, ENTITY_NOT_APPROVED } from '@/lib/verifyEntityAccess';
import { WELL_KNOWN_ADDRESSES_PATH } from '@/lib/verifyProof';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  if (!canPublishEntities(session.tenantId)) return entityNotApprovedResponse();

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  let endpoint = String(body.endpoint ?? '').trim();
  const apiKey = String(body.apiKey ?? '').trim();
  if (!endpoint || !apiKey) return json({ ok: true, outcome: 'invalid_endpoint' });

  // A bare domain or origin defaults to the canonical well-known path, so "just tell
  // us your domain" works and the unbranded convention is what new platforms adopt.
  // An explicit path (the legacy /almstins/addresses included) is honored as given.
  try {
    const probe = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
    if (probe.pathname === '/' && !probe.search) {
      endpoint = `${probe.origin}${WELL_KNOWN_ADDRESSES_PATH}`;
    }
  } catch { /* leave as typed; validateEntityEndpoint reports invalid_endpoint */ }

  const result = await connectEntity(session.tenantId, String(params.id ?? ''), endpoint, apiKey);
  if (!result.ok && result.code === 'not_found') return json({ ok: false, error: 'not_found' }, 404);
  if (!result.ok && result.code === ENTITY_NOT_APPROVED) return entityNotApprovedResponse();
  return json(result.ok ? { ok: true, outcome: 'pulled', count: result.count } : { ok: true, outcome: result.code });
};
