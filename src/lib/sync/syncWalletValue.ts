import type { SupportedChain } from '@/lib/constants';
import { getAllActiveWallets } from '@/lib/wallets';
import { insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import { getAllBalancesForWallet, type TokenBalance } from '@/lib/balances';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';

export type TokenSnapshot = {
	chain: SupportedChain;
	symbol: string;
	tokenAddress: string | null;
	amount: number;
	priceUsd: number | null;
	valueUsd: number | null;
};

export interface WalletValueBreakdown {
	tenantId: string;
	walletId: string;
	chain: SupportedChain;
	totalUsd: number;
	tokens: TokenSnapshot[];
}

export interface WalletValueSyncResult {
	totalWallets: number;
	snapshotsInserted: number;
	perWallet: Array<{
		walletId: string;
		totalUsd: number;
		byChain: Array<{ chain: SupportedChain; totalUsd: number }>;
	}>;
}

export async function syncWalletValuesForAllWallets(tenantId: string): Promise<WalletValueSyncResult> {
	const wallets = await getAllActiveWallets(tenantId);
	let snapshotsInserted = 0;
	const perWallet: WalletValueSyncResult['perWallet'] = [];

	console.info('[VALUE] starting value sync, wallets =', wallets.length);

	for (const wallet of wallets) {
		const chains = (wallet.chains ?? []) as SupportedChain[];
		console.info('[VALUE] syncing wallet', wallet.id, wallet.address, chains);

		if (!chains.length) continue;

		try {
			const breakdowns = await computeWalletValue(tenantId, wallet.id, wallet.address, chains);
			const byChain: Array<{ chain: SupportedChain; totalUsd: number }> = [];

			for (const breakdown of breakdowns) {
				console.log('[VALUE] chain breakdown', {
					walletId: wallet.id,
					address: wallet.address,
					chain: breakdown.chain,
					totalUsd: breakdown.totalUsd,
					tokenCount: breakdown.tokens.length,
					sampleToken: breakdown.tokens[0] ?? null,
				});

				console.log('[VALUE] inserting snapshot', {
					walletId: wallet.id,
					chain: breakdown.chain,
					totalUsd: breakdown.totalUsd,
					tokenCount: breakdown.tokens.length,
				});

				await insertWalletSnapshotFromValueBreakdown(breakdown);
				snapshotsInserted += 1;
				byChain.push({ chain: breakdown.chain, totalUsd: breakdown.totalUsd });
				console.info('[VALUE] snapshot inserted', wallet.id, breakdown.chain, breakdown.totalUsd);
			}

			const totalUsd = byChain.reduce((sum, entry) => sum + entry.totalUsd, 0);
			perWallet.push({ walletId: wallet.id, totalUsd, byChain });
		} catch (error) {
			console.error('[syncWalletValue] Failed to sync wallet', wallet.id, error);
		}
	}

	console.info('[VALUE] done, snapshotsInserted =', snapshotsInserted);

	return {
		totalWallets: wallets.length,
		snapshotsInserted,
		perWallet,
	};
}

export async function computeWalletValue(
	tenantId: string,
	walletId: string,
	address: string,
	chains: SupportedChain[],
) {
	const balances: TokenBalance[] = [];

	for (const chain of chains) {
		try {
			const perChain = await getAllBalancesForWallet([chain], address);
			balances.push(...perChain);
		} catch (error) {
			console.error('[VALUE] chain failed, skipping', {
				walletId,
				address,
				chain,
				error: String(error),
			});
			continue;
		}
	}

	if (!balances.length) return [];

	const normalizePriceSymbol = (value: string) => {
		const upper = value.trim().toUpperCase();
		if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
		if (upper === 'WETH') return 'ETH';
		if (upper === 'WBTC') return 'BTC';
		if (upper.endsWith('.E')) return upper.replace(/\.E$/, '');
		return upper;
	};

	const symbolsToPrice = allowlistSymbols(
		balances.map((b) => normalizePriceSymbol(b.tokenSymbol ?? '')).filter(Boolean),
	);
	console.log('[price.provider] using=coinpaprika symbolCount=' + symbolsToPrice.length); // TEMP DEBUG

	const tickers = (await getTickersUSD()) as Array<{
		id?: string;
		symbol?: string;
		rank?: number;
		quotes?: { USD?: { price?: number } };
	}>;
	const symbolPriceMap: Record<string, number> = {};
	const symbolSet = new Set(symbolsToPrice);
	const candidates = new Map<string, Array<{ id: string; price: number; rank: number }>>();
	for (const ticker of tickers) {
		const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
		if (!symbol || !symbolSet.has(symbol)) continue;
		const price = ticker.quotes?.USD?.price;
		if (typeof price !== 'number' || price <= 0) continue;
		const id = String(ticker.id ?? '').trim();
		const rank = Number.isFinite(ticker.rank) ? (ticker.rank as number) : 999999;
		const list = candidates.get(symbol) ?? [];
		list.push({ id, price, rank });
		candidates.set(symbol, list);
	}
	for (const symbol of symbolSet) {
		const list = candidates.get(symbol);
		if (!list?.length) continue;
		list.sort((a, b) => a.rank - b.rank);
		symbolPriceMap[symbol] = list[0].price;
	}
	console.log('[price.map] keys=' + Object.keys(symbolPriceMap).join(',') + ' ETH=' + (symbolPriceMap.ETH ?? 'null')); // TEMP DEBUG
	if (!Object.keys(symbolPriceMap).length && balances.length) {
		console.warn('[VALUE] price fetch returned no data', { walletId, address, tokenCount: balances.length });
	}

	const byChain = new Map<SupportedChain, WalletValueBreakdown>();

	for (const balance of balances) {
		const symbol = normalizePriceSymbol(balance.tokenSymbol ?? '');
		const rawPriceUsd = symbol ? symbolPriceMap[symbol] : undefined;
		const priceUsd = typeof rawPriceUsd === 'number' && rawPriceUsd > 0 ? rawPriceUsd : null;
		const amount = balance.decimals ? Number(balance.rawBalance) / 10 ** balance.decimals : Number(balance.rawBalance);
		const valueUsd = priceUsd !== null ? amount * priceUsd : null;

		const entry =
			byChain.get(balance.chain) ??
			byChain
				.set(balance.chain, { tenantId, walletId, chain: balance.chain, totalUsd: 0, tokens: [] })
				.get(balance.chain)!;

		const tokenEntry: TokenSnapshot = {
			chain: balance.chain,
			symbol: balance.tokenSymbol,
			amount,
			priceUsd,
			valueUsd,
			tokenAddress: balance.tokenAddress,
		};

		if (tokenEntry.amount === 0 && (tokenEntry.valueUsd ?? 0) === 0) {
			continue;
		}

		entry.tokens.push(tokenEntry);
		entry.totalUsd += tokenEntry.valueUsd ?? 0;
	}

	const breakdowns = Array.from(byChain.values());
	for (const breakdown of breakdowns) {
		const firstToken = breakdown.tokens[0] ?? null;
		console.log('[snapshot.after] totals_usd=' + breakdown.totalUsd, {
			walletId,
			chain: breakdown.chain,
			firstToken: firstToken
				? {
						symbol: firstToken.symbol,
						amount: firstToken.amount,
						priceUsd: firstToken.priceUsd,
						valueUsd: firstToken.valueUsd,
				  }
				: null,
		}); // TEMP DEBUG
	}
	return breakdowns;
}
