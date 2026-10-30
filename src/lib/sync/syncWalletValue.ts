import type { SupportedChain } from '@/lib/constants';
import { getAllActiveWallets } from '@/lib/wallets';
import { insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import { getAllBalancesForWallet, type TokenBalance } from '@/lib/balances';
import { discoverEvmBalances } from '@/lib/evmTokenDiscovery';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { buildTickerPriceMap } from '@/lib/aave/pricing';
import { walletTokenUsdPrice } from '@/lib/prices/walletTokenPricing';
import { normalizeChain } from '@/lib/chains';

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
		// XPR Network is read by its own sync (/api/import/xpr-sync): an account name is no address for the EVM readers here.
		const chains = ((wallet.chains ?? []) as SupportedChain[]).filter((c) => normalizeChain(c) !== 'xpr');
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

/**
 * Ethereum and Polygon balances come from Alchemy's full token list, the same source the wallet
 * card's refresh uses, so the two never disagree about what the wallet holds. The short list in
 * balances.ts is the fallback when Alchemy is unreachable, and the only source for other chains.
 */
async function getChainBalances(chain: SupportedChain, address: string, walletId: string): Promise<TokenBalance[]> {
	if (chain === 'ethereum' || chain === 'polygon') {
		try {
			return await discoverEvmBalances(chain, address);
		} catch (error) {
			console.warn('[VALUE] Alchemy discovery failed, using the tracked-token list', {
				walletId,
				chain,
				error: String(error),
			});
		}
	}
	return getAllBalancesForWallet([chain], address);
}

/**
 * Ticker prices for pricing a snapshot at write time. A feed outage returns an empty map, so every
 * token is stored unpriced (null) rather than the whole wallet failing or anything reading as $0.
 */
export async function getWalletTickerPrices(walletId: string): Promise<Map<string, number>> {
	try {
		return buildTickerPriceMap(await getTickersUSD());
	} catch (error) {
		console.warn('[VALUE] ticker fetch failed, storing tokens unpriced', { walletId, error: String(error) });
		return new Map();
	}
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
			const perChain = await getChainBalances(chain, address, walletId);
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

	const tickerPrices = await getWalletTickerPrices(walletId);
	if (!tickerPrices.size && balances.length) {
		console.warn('[VALUE] price fetch returned no data', { walletId, address, tokenCount: balances.length });
	}

	const byChain = new Map<SupportedChain, WalletValueBreakdown>();

	for (const balance of balances) {
		const priceUsd = walletTokenUsdPrice(balance.tokenSymbol ?? '', tickerPrices);
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
