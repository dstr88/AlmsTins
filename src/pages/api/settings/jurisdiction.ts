/**
 * GET  /api/settings/jurisdiction  → { jurisdiction, label }
 * POST /api/settings/jurisdiction  ← { jurisdiction: 'us' | 'intl' }
 *                                  → { ok: true, jurisdiction }
 *
 * Persists the tenant's jurisdiction profile choice.
 * Almstins is an informational record-keeping tool — this setting controls
 * how data is *displayed*, not how any regulatory filing is produced.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import {
  getJurisdictionProfile,
  setJurisdiction,
  type Jurisdiction,
} from '../../../lib/jurisdictionProfile';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const profile = await getJurisdictionProfile(session.tenantId);
  return json({ jurisdiction: profile.jurisdiction, label: profile.label });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { jurisdiction } = body;
  if (jurisdiction !== 'us' && jurisdiction !== 'intl') {
    return json({ error: 'Invalid jurisdiction — must be "us" or "intl"' }, 400);
  }

  await setJurisdiction(session.tenantId, jurisdiction as Jurisdiction);
  return json({ ok: true, jurisdiction });
};
