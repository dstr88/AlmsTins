import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { repriceMissingWalletTokens } from '@/lib/repriceMissingWalletTokens';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const url = new URL(request.url);
		const walletId = url.searchParams.get('walletId') ?? undefined;
		const symbolsParam = url.searchParams.get('symbols');
		const symbols = symbolsParam
			? symbolsParam
					.split(',')
					.map((sym) => sym.trim().toUpperCase())
					.filter(Boolean)
			: undefined;

		const result = await repriceMissingWalletTokens({
			tenantId,
			walletId,
			symbols,
			trigger: 'cron',
			lockTtlSeconds: 5,
		});

		return new Response(JSON.stringify({ ok: true, ...result }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[reprice] job failed', error);
		return new Response(JSON.stringify({ ok: false, error: 'Unable to run reprice job.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
