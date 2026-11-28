/**
 * GET /api/wallets/[id]/approvals
 *
 * The wallet's standing approvals on Ethereum, Polygon, Avalanche and Arbitrum (src/lib/approvals),
 * read from public chain data by address. Read-only: no wallet connection, never a signature.
 *
 * - Owner only: the wallet must belong to the signed-in account (requireWalletOwnedByTenant), like
 *   every other wallet route. Anyone can read any address's approvals on a chain explorer; Almstins
 *   shows them only for wallets the account added.
 * - Cached 30 minutes per wallet (in memory and in the `cache` table, key t:{tenant}:approvals:...),
 *   so the Wallets page and the monthly check-up share one read. Nothing else is stored.
 * - `?cached=1` answers from the cache only ({ ok: true, cached: false } when there is none), so the
 *   page can show the last count without starting a check.
 * - `?refresh=1` skips the cache.
 * - A fresh check counts against a per-account limit (RATE_LIMIT_MAX per hour); a cached answer doesn't.
 * - Free on every plan.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { isEvmAddress } from '@/lib/addressFormats';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { json } from '@/lib/http';
import { readCachedApprovals, runApprovalsCheck } from '@/lib/approvals/cache';

export const prerender = false;

const RATE_LIMIT_MAX = 12;
const limiter = createFixedWindowLimiter({ windowMs: 60 * 60_000, max: RATE_LIMIT_MAX });

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = String(params.id ?? '');
	if (!walletId) return json({ error: 'WALLET_ID_REQUIRED', message: 'Wallet id is required.' }, 400, { noStore: true });

	try {
		const session = await requireTenantSession(request);
		if (!session) return json({ error: 'UNAUTHORIZED', message: 'Sign in to see approvals.' }, 401, { noStore: true });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(walletId, tenantId);

		const row = await db.execute({
			sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		const address = String(row.rows?.[0]?.address ?? '').trim();
		if (!address) return json({ error: 'WALLET_NOT_FOUND', message: 'Wallet not found.' }, 404, { noStore: true });
		if (!isEvmAddress(address)) {
			return json({ error: 'NOT_EVM', message: 'Approvals are read for Ethereum-family wallets only.' }, 400, { noStore: true });
		}

		const url = new URL(request.url);
		const refresh = url.searchParams.get('refresh') === '1';

		if (!refresh) {
			const cached = await readCachedApprovals(tenantId, walletId);
			if (cached) return json({ ...cached, cached: true }, 200, { noStore: true });
		}
		if (url.searchParams.get('cached') === '1') return json({ ok: true, cached: false }, 200, { noStore: true });

		if (limiter.hit(`tenant:${tenantId}`)) {
			return json(
				{ error: 'RATE_LIMITED', message: 'Too many approval checks in the last hour. Try again later.' },
				429,
				{ noStore: true, headers: { 'Retry-After': '600' } },
			);
		}

		const report = await runApprovalsCheck(tenantId, walletId, address);
		return json({ ...report, cached: false }, 200, { noStore: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[approvals] error', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
		return json({ error: 'INTERNAL', message: 'Approvals could not be checked. Try again in a few minutes.' }, 500, { noStore: true });
	}
};
