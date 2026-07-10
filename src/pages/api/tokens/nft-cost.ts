/**
 * POST /api/tokens/nft-cost — set (or clear with null) an NFT's manual cost basis.
 * Body: { chain, contract, tokenId, costUsd }. Tenant-scoped; demo read-only.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { setNftCost } from '../../../lib/nftCost';

export const prerender = false;
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session?.tenantId) return json(401, { ok: false, error: 'unauthorized' });
    if (session.isDemo) return json(403, { ok: false, error: 'demo' });

    const b = await request.json().catch(() => ({}));
    const chain = String(b?.chain ?? '').trim();
    const contract = String(b?.contract ?? '').trim();
    const tokenId = String(b?.tokenId ?? '').trim();
    if (!chain || !contract || !tokenId) return json(400, { ok: false, error: 'missing chain/contract/tokenId' });

    const raw = b?.costUsd;
    const costUsd = raw == null || raw === '' ? null : Number(raw);
    if (costUsd != null && (!Number.isFinite(costUsd) || costUsd < 0)) return json(400, { ok: false, error: 'invalid costUsd' });

    await setNftCost(session.tenantId, { chain, contract, tokenId, costUsd });
    return json(200, { ok: true });
  } catch (err) {
    console.error('[tokens/nft-cost]', err);
    return json(500, { ok: false, error: 'Server error' });
  }
};
