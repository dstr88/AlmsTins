/**
 * GET  /api/account/api-keys       — list keys for the authenticated tenant
 * POST /api/account/api-keys       — create a new key (returns raw key once)
 * DELETE /api/account/api-keys?id= — revoke a key
 *
 * Demo users blocked. Max 5 keys per tenant.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createApiKey, listApiKeys, revokeApiKey, ensureApiKeysTable } from '@/lib/apiKeys';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const MAX_KEYS = 5;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'Not available in demo mode' }, 403);

  await ensureApiKeysTable();
  const keys = await listApiKeys(session.tenantId);
  return json({ ok: true, keys });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'Not available in demo mode' }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const label = String((body as any)?.label ?? '').trim().slice(0, 100);

  await ensureApiKeysTable();

  // Enforce max 5 keys per tenant
  const existing = await listApiKeys(session.tenantId);
  const activeKeys = existing.filter((k) => k.active);
  if (activeKeys.length >= MAX_KEYS) {
    return json(
      { ok: false, error: `Maximum of ${MAX_KEYS} active API keys allowed. Revoke one before creating another.` },
      400,
    );
  }

  const { keyId, key } = await createApiKey(session.tenantId, label);
  return json({ ok: true, keyId, key, label });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'Not available in demo mode' }, 403);

  const id = url.searchParams.get('id')?.trim();
  if (!id) return json({ ok: false, error: 'id is required' }, 400);

  await ensureApiKeysTable();
  const revoked = await revokeApiKey(session.tenantId, id);
  if (!revoked) return json({ ok: false, error: 'Key not found' }, 404);
  return json({ ok: true });
};
