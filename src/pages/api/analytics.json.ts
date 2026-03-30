import type { APIRoute } from 'astro';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const propertyId = import.meta.env.GA_PROPERTY_ID;

    if (!propertyId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing GA_PROPERTY_ID' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const client = new BetaAnalyticsDataClient();

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
