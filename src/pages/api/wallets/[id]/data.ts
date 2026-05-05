// src/pages/api/wallets/[id]/data.ts
import type { APIRoute } from 'astro';
import { getWalletWithLatestData } from '@/lib/db/puller';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session;
    const walletId = params.id;

    if (!walletId) {
      return new Response(
        JSON.stringify({ error: true, message: 'Wallet id is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await requireWalletOwnedByTenant(walletId, tenantId);

    const data = await getWalletWithLatestData(tenantId, walletId);

    if (!data) {
      return new Response(
        JSON.stringify({ error: true, message: 'Wallet not found.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[API /wallets/[id]/data] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
