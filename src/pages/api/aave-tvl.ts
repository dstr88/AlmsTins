import type { APIRoute } from 'astro';

const DEFILLAMA_BASE = 'https://api.llama.fi';
const REQUEST_TIMEOUT_MS = 20_000;

// DeFiLlama slugs to try for Aave V4
const AAVE_V4_SLUG = 'aave-v4';

export const GET: APIRoute = async () => {
	try {
		const [protocolRes, chainsRes] = await Promise.all([
			fetchWithTimeout(`${DEFILLAMA_BASE}/protocol/${AAVE_V4_SLUG}`, REQUEST_TIMEOUT_MS),
			fetchWithTimeout(`${DEFILLAMA_BASE}/v2/chains`, REQUEST_TIMEOUT_MS),
		]);

		if (!protocolRes.ok) {
			return json(
				{ error: true, message: `DeFiLlama responded with HTTP ${protocolRes.status}` },
				protocolRes.status,
			);
		}

		const protocol = await protocolRes.json();

		// Build current TVL by chain from currentChainTvls
		const currentChainTvls: Record<string, number> = protocol.currentChainTvls ?? {};

		// Filter to chains with meaningful TVL (> $1k)
		const chainEntries = Object.entries(currentChainTvls)
			.filter(([, tvl]) => tvl > 1000)
			.sort(([, a], [, b]) => b - a);

		// Build TVL history from protocol.tvl array (last 365 days)
		const now = Date.now() / 1000;
		const cutoff = now - 365 * 86400;
		const tvlHistory: Array<{ date: number; totalLiquidityUSD: number }> =
			(protocol.tvl ?? [])
				.filter((entry: { date: number; totalLiquidityUSD: number }) => entry.date >= cutoff)
				.map((entry: { date: number; totalLiquidityUSD: number }) => ({
					date: entry.date,
					totalLiquidityUSD: entry.totalLiquidityUSD,
				}));

		// Build token breakdown from latest tokens snapshot
		const tokensInUsd: Array<{ symbol: string; tvlUsd: number; chain: string }> = [];
		const tokensByChain: Record<string, Record<string, number>> = protocol.chainTvls ?? {};

		// Extract latest token snapshot for each chain
		for (const [chain, chainData] of Object.entries(tokensByChain)) {
			const tokens = (chainData as any).tokens ?? [];
			if (!tokens.length) continue;
			const latest = tokens[tokens.length - 1];
			for (const [symbol, rawAmount] of Object.entries(latest?.tokens ?? {})) {
				const tvlUsd = Number(rawAmount);
				if (tvlUsd > 1000) {
					tokensInUsd.push({ symbol, tvlUsd, chain });
				}
			}
		}

		// Aggregate by token symbol across chains
		const tokenAgg: Record<string, number> = {};
		for (const { symbol, tvlUsd } of tokensInUsd) {
			tokenAgg[symbol] = (tokenAgg[symbol] ?? 0) + tvlUsd;
		}
		const topTokens = Object.entries(tokenAgg)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 20)
			.map(([symbol, tvlUsd]) => ({ symbol, tvlUsd }));

		const totalTvl = chainEntries.reduce((sum, [, v]) => sum + v, 0);

		return new Response(
			JSON.stringify({
				name: protocol.name ?? 'Aave V4',
				totalTvl,
				currentChainTvls: Object.fromEntries(chainEntries),
				tvlHistory,
				topTokens,
				updatedAt: protocol.updatedAt ?? null,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
			},
		);
	} catch (error) {
		console.error('[aave-tvl] fetch failed', error);
		const message = error instanceof Error ? error.message : 'Unable to reach DeFiLlama';
		return json({ error: true, message }, 500);
	}
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(id);
	}
}
