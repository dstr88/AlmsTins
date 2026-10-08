import type { APIRoute } from 'astro';
import { clearSessionCookies } from '@/lib/petro-tins/session-cookies';
import { PETRO_TINS_PUBLIC } from '@/lib/petroTinsAccess';

export const prerender = false;

/**
 * GET /api/petro-tins/demo — entry point for the PetroTins demo.
 *
 * Clears any real-session cookies (so a logged-in user isn't hijacked into
 * their own dashboard), then hands off to /api/demo/start, which re-seeds fresh
 * demo data for DEMO_TENANT_ID, sets the demo cookie, and lands on the
 * interactive dashboard. Each visit re-seeds, so the next visitor starts fresh.
 *
 * While PetroTins is owner-only there is no PetroTins demo, and only the owner gets past the
 * middleware gate to this route: it keeps the owner signed in and goes to the dashboard.
 */
export const GET: APIRoute = () => {
  if (!PETRO_TINS_PUBLIC) {
    return new Response(null, { status: 302, headers: { Location: '/dashboard/petro-tins' } });
  }
  const headers = new Headers();
  headers.append('Location', '/api/demo/start?next=/dashboard/petro-tins');
  clearSessionCookies(headers);
  return new Response(null, { status: 302, headers });
};
