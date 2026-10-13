/**
 * GET /api/verify/address-activity?address=<addr>&network=<ethereum|polygon|avalanche>
 *
 * SECRET-GATED, server-to-server. Returns recent PUBLIC-chain in/out activity for one
 * address. Backs sister products (SusuFinance) that carry no chain-reading code: they
 * ask Almstins "what has moved in and out of this address?" and show it to the address's
 * OWN owner. The owner→owner direction is the whole point — this is bookkeeping a person
 * runs on her own wallet, not surveillance of someone else's.
 *
 * Why secret-gated and NOT public like /api/verify/lookup: lookup answers a yes/no
 * ("is this proven?") that's safe to expose. This returns transaction FLOWS. Though the
 * data is public (any explorer shows it), a public "any address's activity" endpoint
 * would invite using Almstins as a wallet-watching tool. The shared secret keeps it a
 * server-to-server call; the CALLER is responsible for only ever showing an address's
 * activity to that address's owner.
 *
 * Fail-closed: if ADDRESS_ACTIVITY_SECRET is unset, the endpoint is disabled (401) — it
 * can never accidentally serve unauthenticated. No attribution: returns counterparty
 * ADDRESSES only, never identities. Read-only; the queried value is never written.
 */
import type { APIRoute } from 'astro';
import { isValidAddress } from '@/lib/walletChecker';
import { getAddressActivity, type ActivityResult } from '@/lib/addressActivity';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Small in-memory cache — protects the explorer from repeated identical lookups
// (the same girl's page reloading). 60s TTL; resets on restart.
const CACHE = new Map<string, { at: number; result: ActivityResult }>();
const CACHE_TTL_MS = 60_000;

export const GET: APIRoute = async ({ request, url }) => {
  const secret = import.meta.env.ADDRESS_ACTIVITY_SECRET;
  const provided = request.headers.get('x-activity-secret') ?? '';
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const address = (url.searchParams.get('address') ?? '').trim();
  if (!address || !isValidAddress(address)) return json({ ok: false, error: 'invalid_address' }, 400);
  const network = url.searchParams.get('network')?.trim() || undefined;

  const key = `${address.toLowerCase()}:${network ?? ''}`;
  const cached = CACHE.get(key);
  let result: ActivityResult;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    result = cached.result;
  } else {
    result = await getAddressActivity(address, network);
    // Only cache successes — a transient outage shouldn't stick for a minute.
    if (result.ok) CACHE.set(key, { at: Date.now(), result });
  }

  if (!result.ok) {
    const status = result.reason === 'unsupported' ? 422 : 502;
    return json({ ok: false, error: result.reason }, status);
  }
  return json({
    ok: true,
    chain: result.chain,
    network: result.network,
    address,
    activity: result.activity,
    truncated: result.truncated,
  });
};
