import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isOwner } from '@/lib/owner';
import { getGA4Realtime } from '@/lib/ga4';

export const prerender = false;

// Who is on the site right now, for the owner's admin page (live card). Uses the same GA4
// service account as the 28-day summary (src/lib/ga4.ts, GA4_* env vars); it used to look
// for separate GA_* variables that were never set.
export const GET: APIRoute = async ({ request }) => {
  // Site-wide traffic data: the owner's only (any signed-in or demo session used to pass).
  const session = await requireTenantSession(request);
  if (!session || !isOwner(session.tenantId)) return new Response('Not found', { status: 404 });

  const realtime = await getGA4Realtime();
  if (!realtime) {
    return json({ ok: false, error: 'Google Analytics is not connected or did not answer.' }, 503);
  }
  return json({ ok: true, ...realtime }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
