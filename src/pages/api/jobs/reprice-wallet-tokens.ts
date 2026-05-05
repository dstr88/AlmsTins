import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { repriceMissingWalletTokens } from '@/lib/repriceMissingWalletTokens';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const url = new URL(request.url);
		const walletId = url.searchParams.get('walletId') ?? undefined;
		const symbolsParam = url.searchParams.get('symbols');
		const symbols = symbolsParam
			? symbolsParam
					.split(',')
					.map((sym) => sym.trim().toUpperCase())
					.filter(Boolean)
			: undefined;

		if (walletId) {
			await requireWalletOwnedByTenant(walletId, tenantId);
		}

		const result = await repriceMissingWalletTokens({
			tenantId,
			walletId,
			symbols,
			trigger: 'cron',
			lockTtlSeconds: 5,
		});

		return new Response(JSON.stringify({ ...result, ok: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[reprice-job][FATAL]', error); // TEMP DEBUG
		console.error('[reprice-job][FATAL_STACK]', error instanceof Error ? error.stack : null); // TEMP DEBUG
		throw error; // TEMP DEBUG: surface real failure to platform logs
		return new Response(JSON.stringify({ ok: false, error: 'Unable to run reprice job.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
