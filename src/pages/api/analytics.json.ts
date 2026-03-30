import type { APIRoute } from 'astro';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    if (!import.meta.env.GA_PROPERTY_ID) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing GA_PROPERTY_ID' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!import.meta.env.GA_CLIENT_EMAIL) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing GA_CLIENT_EMAIL' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!import.meta.env.GA_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing GA_PRIVATE_KEY' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const client = new BetaAnalyticsDataClient({
      credentials: {
        client_email: import.meta.env.GA_CLIENT_EMAIL,
        private_key: import.meta.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
    });

    const [response] = await client.runRealtimeReport({
      property: `properties/${import.meta.env.GA_PROPERTY_ID}`,
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
