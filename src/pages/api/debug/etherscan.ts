import type { APIRoute } from 'astro';
import { buildScanUrl, fetchEthereumScan } from '@/lib/scanSync';
import { requireAdminSession } from '@/lib/adminGuard';

export const prerender = false;

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

export const GET: APIRoute = async ({ request }) => {
	try { await requireAdminSession(request); }
	catch (e) { return e instanceof Response ? e : new Response('Unauthorized', { status: 401 }); }

	const address = '0x0000000000000000000000000000000000000000'; // replace in queries if you want a real wallet

	try {
		const nativeParams = { module: 'account', action: 'balance', address, tag: 'latest' };
		const nativeUrl = buildScanUrl('ethereum', nativeParams);
		const nativeRedacted = nativeUrl ? nativeUrl.replace(/apikey=[^&]+/i, 'apikey=[redacted]') : '(key missing)';
		console.log('[debug.etherscan] native url', nativeRedacted);

		const nativeBalance = await fetchEthereumScan(nativeParams);

		const ercParams = (contractaddress: string) => ({
			module: 'account',
			action: 'tokenbalance',
			address,
			contractaddress,
			tag: 'latest',
		});

		const usdcUrl = (buildScanUrl('ethereum', ercParams(USDC)) ?? '').replace(/apikey=[^&]+/i, 'apikey=[redacted]');
		const usdtUrl = (buildScanUrl('ethereum', ercParams(USDT)) ?? '').replace(/apikey=[^&]+/i, 'apikey=[redacted]');
		console.log('[debug.etherscan] usdc url', usdcUrl);
		console.log('[debug.etherscan] usdt url', usdtUrl);

		const [usdcBalance, usdtBalance] = await Promise.all([
			fetchEthereumScan(ercParams(USDC)),
			fetchEthereumScan(ercParams(USDT)),
		]);

		return new Response(
			JSON.stringify(
				{
					ok: true,
					nativeBalance,
					erc20: {
						USDC: usdcBalance,
						USDT: usdtBalance,
					},
					raw: {
						native: nativeBalance,
						usdc: usdcBalance,
						usdt: usdtBalance,
					},
				},
				null,
				2,
			),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: any) {
		console.error('[debug.etherscan] error', err);
		return new Response(
			JSON.stringify(
				{
					ok: false,
					error: err?.message ?? 'Etherscan debug failed',
					message: err?.message ?? String(err),
				},
				null,
				2,
			),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
