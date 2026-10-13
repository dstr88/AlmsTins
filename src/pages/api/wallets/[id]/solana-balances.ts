import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { getAllActiveWallets } from '@/lib/wallets';

export const prerender = false;

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;

export const GET: APIRoute = async ({ params, request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id ?? '';
		if (!walletId) return respond({ error: true, message: 'Wallet id required.' }, 400);

		await requireWalletOwnedByTenant(walletId, tenantId);

		const wallets = await getAllActiveWallets(tenantId);
		const wallet  = wallets.find((w) => w.id === walletId);
		if (!wallet) return respond({ error: true, message: 'Wallet not found.' }, 404);

		if (!wallet.chains.includes('solana')) {
			return respond({ error: true, message: 'Not a Solana wallet.' }, 400);
		}

		const address = wallet.address;
		const rpcRes  = await fetch(SOLANA_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'getBalance',
				params: [address],
			}),
		});

		if (!rpcRes.ok) return respond({ error: true, message: `Solana RPC returned ${rpcRes.status}` }, 502);

		const json  = await rpcRes.json() as { result?: { value?: number }; error?: unknown };
		const lamports = json?.result?.value ?? null;
		const solBalance = lamports !== null ? lamports / LAMPORTS_PER_SOL : null;

		return respond({ ok: true, address, solBalance }, 200);
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[solana-balances] error', err);
		return respond({ error: true, message: 'Failed to fetch Solana balance.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
