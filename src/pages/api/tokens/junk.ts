/**
 * GET /api/tokens/junk — the tokens filtered out as spam/scam, for the Junk drawer.
 * Read-only; tenant-scoped. The scan lives in lib/junkTokens (shared with the PDF).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { getFilteredTokens } from '../../../lib/junkTokens';

export const prerender = false;

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session?.tenantId) return json(401, { ok: false, error: 'unauthorized' });
    const items = await getFilteredTokens(session.tenantId);
    return json(200, { ok: true, items });
  } catch (err) {
    console.error('[tokens/junk]', err);
    return json(500, { ok: false, error: 'Server error' });
  }
};
