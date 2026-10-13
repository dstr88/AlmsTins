/**
 * POST /api/verify/compare — check a scanned/entered payment value against the
 * tenant's OWN registered Destinations.
 *
 * Returns { matched, destination? }. Match = "still yours"; no match = a value we
 * never registered (a possible QR swap). Owner→self, tenant-scoped, no attribution
 * — no legal hold. This is the on-demand half of Almstins Verify; continuous
 * monitoring + the safety overlay (checkWallet) layer on top later.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { compareToDestinations } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const value = String(body.value ?? '').trim();
  if (!value) return json({ ok: false, error: 'invalid', message: 'Nothing to check.' }, 400);

  const result = await compareToDestinations(session.tenantId, value);
  return json({
    ok: true,
    matched: result.matched,
    destination: result.destination
      ? {
          id: result.destination.id,
          rail: result.destination.rail,
          label: result.destination.label,
          value: result.destination.value,
        }
      : null,
  });
};
