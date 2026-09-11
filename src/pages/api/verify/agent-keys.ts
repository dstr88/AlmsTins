/**
 * Agent API keys — authenticated management, self-serve issuance.
 *
 * GET               → the tenant's keys (pending challenges included, hashes never)
 * POST {domain}     → start a claim: returns the pending row with its TXT challenge
 * POST {action:'verify', id} → check DNS, mint the key — plaintext returned ONCE
 * DELETE ?id=       → revoke
 *
 * No admin, no review queue, no approval: the DNS record is the whole ceremony.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { startAgentKey, activateAgentKey, listAgentKeys, revokeAgentKey } from '@/lib/agentKeys';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  return json({ ok: true, keys: await listAgentKeys(session.tenantId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'expected_json' }, 400); }

  if (String(body?.action ?? '') === 'verify') {
    const result = await activateAgentKey(session.tenantId, String(body?.id ?? ''));
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return json(result, status);
    }
    return json({ ok: true, key: result.key, plaintextKey: result.plaintextKey });
  }

  const result = await startAgentKey(session.tenantId, String(body?.domain ?? ''));
  if (!result.ok) return json(result, 400);
  return json(result);
};

export const DELETE: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const ok = await revokeAgentKey(session.tenantId, id);
  return ok ? json({ ok: true }) : json({ ok: false, error: 'not_found' }, 404);
};
