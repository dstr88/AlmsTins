import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { db } from '@/lib/db';
import { getAllBalances, getCoinMetadata, parseSuiSymbol, SUI_DECIMALS } from '@/lib/sui';

export const prerender = false;

function toDecimal(raw: string, decimals: number): number {
	try {
		const negative = raw.startsWith('-');
		const abs = BigInt(negative ? raw.slice(1) : raw);
		const base = 10n ** BigInt(decimals);
		const whole = abs / base;
		const fraction = abs % base;
		const fracStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
		const num = Number(fracStr ? `${whole}.${fracStr}` : whole.toString());
		return negative ? -num : num;
	} catch {
		return 0;
	}
}

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		if (!walletId) return respond({ error: true, message: 'Wallet id required.' }, 400);

		await requireWalletOwnedByTenant(walletId, tenantId);

		const walletResult = await db.execute({
			sql: 'SELECT id, address, label, wallet_type FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		const walletRow = walletResult.rows[0] as Record<string, any> | undefined;
		if (!walletRow) return respond({ error: true, message: 'Wallet not found.' }, 404);
		const walletChains: string[] = (() => {
			try { return JSON.parse(String(walletRow.chains ?? '[]')); } catch { return []; }
		})();
		if (!walletChains.includes('sui')) {
			return respond({ error: true, message: 'Wallet does not have sui chain configured.' }, 400);
		}

		const address = String(walletRow.address ?? '');
		const rawBalances = await getAllBalances(address);

		// Filter out zero balances and fetch metadata for symbols/decimals
		const nonZero = rawBalances.filter((b) => BigInt(b.totalBalance) > 0n);

		const coins = await Promise.all(
			nonZero.map(async (b) => {
				const meta = await getCoinMetadata(b.coinType);
				const symbol = meta?.symbol?.toUpperCase() ?? parseSuiSymbol(b.coinType);
				const decimals = meta?.decimals ?? SUI_DECIMALS;
				const amount = toDecimal(b.totalBalance, decimals);
				return {
					coinType: b.coinType,
					symbol,
					decimals,
					amount,
					priceUsd: null as number | null,
					valueUsd: null as number | null,
				};
			}),
		);

		// Fetch prices via CoinGecko route for known symbols
		const symbols = [...new Set(coins.map((c) => c.symbol))].join(',');
		let priceMap: Record<string, number> = {};
		try {
			const priceRes = await fetch(
				`/api/market/coingecko-prices?symbols=${encodeURIComponent(symbols)}`,
				{ headers: { cookie: request.headers.get('cookie') ?? '' } },
			);
			if (priceRes.ok) {
				const priceData = await priceRes.json();
				priceMap = priceData.prices ?? {};
			}
		} catch {}

		const coinsWithPrices = coins.map((c) => {
			const priceUsd = priceMap[c.symbol] ?? null;
			const valueUsd = priceUsd !== null ? c.amount * priceUsd : null;
			return { ...c, priceUsd, valueUsd };
		});

		return respond(
			{
				ok: true,
				walletId,
				address,
				label: walletRow.label ?? null,
				coins: coinsWithPrices,
			},
			200,
		);
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[sui-balances] error', err);
		return respond({ error: true, message: 'Failed to load Sui balances.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
