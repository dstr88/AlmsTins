/**
 * POST   /api/tokens/override   — set a token's classification (include|junk|income)
 * DELETE /api/tokens/override    — clear it (revert to the heuristic)
 *
 * Body / query: { chain?, contract?, symbol?, decision, note? }. Tenant-scoped;
 * demo sessions are read-only.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { setTokenOverride, clearTokenOverride, type OverrideDecision } from '../../../lib/tokenOverrides';

export const prerender = false;

const VALID = new Set<OverrideDecision>(['include', 'junk', 'income']);
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session?.tenantId) return json(401, { ok: false, error: 'unauthorized' });
    if (session.isDemo) return json(403, { ok: false, error: 'demo' });

    const body = await request.json().catch(() => ({}));
    const decision = String(body?.decision ?? '') as OverrideDecision;
    if (!VALID.has(decision)) return json(400, { ok: false, error: 'invalid decision' });

    await setTokenOverride(session.tenantId, {
      chain:    body?.chain ?? null,
      contract: body?.contract ?? null,
      symbol:   body?.symbol ?? null,
      decision,
      note:     body?.note ?? null,
    });
    return json(200, { ok: true });
  } catch (err) {
    console.error('[tokens/override:POST]', err);
    return json(500, { ok: false, error: 'Server error' });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session?.tenantId) return json(401, { ok: false, error: 'unauthorized' });
    if (session.isDemo) return json(403, { ok: false, error: 'demo' });

    const url = new URL(request.url);
    await clearTokenOverride(session.tenantId, {
      chain:    url.searchParams.get('chain'),
      contract: url.searchParams.get('contract'),
      symbol:   url.searchParams.get('symbol'),
    });
    return json(200, { ok: true });
  } catch (err) {
    console.error('[tokens/override:DELETE]', err);
    return json(500, { ok: false, error: 'Server error' });
  }
};
