import type { APIRoute } from 'astro';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { requireAdminSession } from '@/lib/adminGuard';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try { await requireAdminSession(request); }
  catch (e) { return e instanceof Response ? e : new Response('Unauthorized', { status: 401 }); }

  try {
    const propertyId = import.meta.env.GA_PROPERTY_ID;
    const clientEmail = import.meta.env.GA_CLIENT_EMAIL;
    const privateKey = import.meta.env.GA_PRIVATE_KEY;

    if (!propertyId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing GA_PROPERTY_ID' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!clientEmail) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing GA_CLIENT_EMAIL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!privateKey) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing GA_PRIVATE_KEY' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey.replace(/\\n/g, '\n'),
      },
    });

    const [response] = await client.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [{ name: 'activeUsers' }],
    });

    return new Response(
      JSON.stringify({ ok: true, response }, null, 2),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        null,
        2
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
