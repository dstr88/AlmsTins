import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { seedPhishingDomainsFromSnapshots } from '@/lib/phishingDomains';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const result = await seedPhishingDomainsFromSnapshots();

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
