/**
 * GET /api/verify/receivables/needs-update — the lender desk's inbox feed (aging A4 / D5).
 *
 * This tenant's OWN active claims whose record is due-in-grace or past due, not updated —
 * computed on load from the same rows every other surface reads, stored nowhere. Updating the
 * claim (settle / extend / unpaid) clears an item by itself, because the state recomputes.
 * Tenant-scoped like every claim read: only the caller's claims, never whose they are on the
 * public record. A read, so it stays open to the demo (the demo browses, never writes).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listNeedsUpdate } from '@/lib/receivablesRegistry';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const items = await listNeedsUpdate(session.tenantId, new Date());
  return json({ ok: true, items });
};
