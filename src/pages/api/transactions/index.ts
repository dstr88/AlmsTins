import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { getTransactionsForWalletDashboard } from '../../../lib/transactions';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const walletId = url.searchParams.get('walletId');
	if (!walletId) {
		return respond({ error: true, message: 'Wallet id is required.' }, 400);
	}

	const limit = Number(url.searchParams.get('limit') ?? '50');
	const offset = Number(url.searchParams.get('offset') ?? '0');
	const fromDate = url.searchParams.get('from');
	const toDate = url.searchParams.get('to');

	try {
		await requireWalletOwnedByTenant(walletId, tenantId);

		const rows = await getTransactionsForWalletDashboard(tenantId, walletId, {
			limit,
			offset,
			fromDate: fromDate || undefined,
			toDate: toDate || undefined,
		});

		return respond({
			ok: true,
			walletId,
			limit,
			offset,
			count: rows.length,
			transactions: rows,
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Failed to load transactions', error);
		return respond({ error: true, message: 'Unable to load transactions.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
