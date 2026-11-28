/**
 * GET /api/wallets/[id]/approvals
 *
 * The wallet's standing approvals on Ethereum, Polygon, Avalanche and Arbitrum (src/lib/approvals),
 * read from public chain data by address. Read-only: no wallet connection, never a signature.
 *
 * - Owner only: the wallet must belong to the signed-in account (requireWalletOwnedByTenant), like
 *   every other wallet route. Anyone can read any address's approvals on a chain explorer; Almstins
 *   shows them only for wallets the account added.
 * - A check runs in the background (src/lib/approvals/cache.ts). This request answers within about
 *   20 seconds, under Render's ~30 s cutoff: the whole report, or the list so far with
 *   `complete: false` and the chains still being read marked `pending`. The page then polls.
 * - `?poll=1` reads the running check (or the cached report) and never starts one; `{ ok: true,
 *   status: 'missing' }` when there is none.
 * - `?cached=1` answers from the cache, or the running check, and never starts one
 *   ({ ok: true, cached: false } when there is neither), so the page can show the last count.
 * - `?refresh=1` skips the cache.
 * - Cached 30 minutes per wallet once complete. Starting a check counts against a per-account limit
 *   (RATE_LIMIT_MAX per hour); a cached answer, joining a running check or polling doesn't.
 * - Free on every plan.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { isEvmAddress } from '@/lib/addressFormats';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { json } from '@/lib/http';
import { isCheckRunning, pollApprovals, readCachedApprovals, startApprovalsCheck } from '@/lib/approvals/cache';

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

		if (url.searchParams.get('poll') === '1') {
			const report = await pollApprovals(tenantId, walletId);
			return report
				? json({ ...report, cached: false }, 200, { noStore: true })
				: json({ ok: true, status: 'missing' }, 200, { noStore: true });
		}

		if (!refresh) {
			const cached = await readCachedApprovals(tenantId, walletId);
			if (cached) return json({ ...cached, cached: true }, 200, { noStore: true });
		}
		if (url.searchParams.get('cached') === '1') {
			const running = isCheckRunning(tenantId, walletId) ? await pollApprovals(tenantId, walletId) : null;
			return running ? json({ ...running, cached: false }, 200, { noStore: true }) : json({ ok: true, cached: false }, 200, { noStore: true });
		}

		// Joining a check already running costs nothing; starting one counts against the limit.
		if (!isCheckRunning(tenantId, walletId) && limiter.hit(`tenant:${tenantId}`)) {
			return json(
				{ error: 'RATE_LIMITED', message: 'Too many approval checks in the last hour. Try again later.' },
				429,
				{ noStore: true, headers: { 'Retry-After': '600' } },
			);
		}

		const report = await startApprovalsCheck(tenantId, walletId, address);
		return json({ ...report, cached: false }, 200, { noStore: true });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[approvals] error', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
		return json({ error: 'INTERNAL', message: 'Approvals could not be checked. Try again in a few minutes.' }, 500, { noStore: true });
	}
};
