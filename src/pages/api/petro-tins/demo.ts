import type { APIRoute } from 'astro';
import { clearSessionCookies } from '@/lib/petro-tins/session-cookies';

export const prerender = false;

/**
 * GET /api/petro-tins/demo — entry point for the PetroTins demo.
 *
 * Clears any real-session cookies (so a logged-in user isn't hijacked into
 * their own dashboard), then hands off to /api/demo/start, which re-seeds fresh
 * demo data for DEMO_TENANT_ID, sets the demo cookie, and lands on the
 * interactive dashboard. Each visit re-seeds, so the next visitor starts fresh.
 */
export const GET: APIRoute = () => {
  const headers = new Headers();
  headers.append('Location', '/api/demo/start?next=/dashboard/petro-tins');
  clearSessionCookies(headers);
  return new Response(null, { status: 302, headers });
};
