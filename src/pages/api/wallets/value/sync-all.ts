import type { APIRoute } from 'astro';
import { syncWalletValuesForAllWallets } from '@/lib/sync/syncWalletValue';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getLang } from '@/lib/i18n/locale';
import { getAccountErrors } from '@/i18n/apiErrors/account';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
	const t = getAccountErrors(getLang(ctx.request));
	try {
		const session = await requireTenantSession(ctx.request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const result = await syncWalletValuesForAllWallets(tenantId);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		});
	} catch (err: any) {
		console.error('[VALUE] sync error', err);
		return new Response(JSON.stringify({ error: err?.message ?? t.valueSyncFailed }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
