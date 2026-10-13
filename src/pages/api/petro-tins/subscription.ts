/**
 * GET  /api/petro-tins/subscription  — current tier
 * POST /api/petro-tins/subscription  — redeem promo code
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getPetroSubscription, redeemPromoCode } from '@/lib/petroSubscription';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const tier = await getPetroSubscription(session.tenantId);
  return new Response(JSON.stringify({ tier }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session || session.isDemo) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? '').trim();
  if (!code) {
    return new Response(JSON.stringify({ ok: false, error: 'No code provided.' }), { status: 400 });
  }

  const result = await redeemPromoCode(session.tenantId, code);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
