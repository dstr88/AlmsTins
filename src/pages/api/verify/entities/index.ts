/**
 * GET  /api/verify/entities  — list the tenant's Verified Entities
 * POST /api/verify/entities  — register an entity for a domain; returns the challenge
 *                              + the .well-known file to publish. Body: { domain }.
 *
 * Publishing a platform list is by approval (verifyEntityAccess.ts): POST answers 403
 * { error: 'not_approved' } for any account that is not approved. GET stays open so an
 * account can still see (and delete) its own rows.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listEntities, createEntity } from '@/lib/verifyEntities';
import { canPublishEntities, entityNotApprovedResponse, ENTITY_NOT_APPROVED } from '@/lib/verifyEntityAccess';
import { buildProofFile, WELL_KNOWN_PATH } from '@/lib/verifyProof';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  return json({ ok: true, entities: await listEntities(session.tenantId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  if (!canPublishEntities(session.tenantId)) return entityNotApprovedResponse();

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await createEntity(session.tenantId, String(body.domain ?? ''));
  if (!result.ok && result.code === ENTITY_NOT_APPROVED) return entityNotApprovedResponse();
  if (!result.ok) return json({ ok: true, outcome: result.code }); // invalid_domain

  return json({
    ok: true,
    entity: result.entity,
    path: WELL_KNOWN_PATH,
    file: buildProofFile(result.entity.challenge, []),
  });
};
