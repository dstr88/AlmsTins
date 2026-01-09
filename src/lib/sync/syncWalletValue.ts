import type { SupportedChain } from '@/lib/constants';
import { getAllActiveWallets } from '@/lib/wallets';
import { insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import { getAllBalancesForWallet, type TokenBalance } from '@/lib/balances';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';

export type TokenSnapshot = {
	chain: SupportedChain;
	symbol: string;
	tokenAddress: string | null;
	amount: number;
	priceUsd: number;
	valueUsd: number;
};

export interface WalletValueBreakdown {
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

export async function syncWalletValuesForAllWallets(): Promise<WalletValueSyncResult> {
	const wallets = await getAllActiveWallets();
	let snapshotsInserted = 0;
	const perWallet: WalletValueSyncResult['perWallet'] = [];

	console.info('[VALUE] starting value sync, wallets =', wallets.length);

	for (const wallet of wallets) {
		const chains = (wallet.chains ?? []) as SupportedChain[];
		console.info('[VALUE] syncing wallet', wallet.id, wallet.address, chains);

		if (!chains.length) continue;

		try {
			const breakdowns = await computeWalletValue(wallet.id, wallet.address, chains);
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

				// Skip inserting empty zero-value snapshots to avoid clutter.
				if (breakdown.totalUsd === 0 && breakdown.tokens.length === 0) {
					console.log('[VALUE] skipping snapshot', {
						walletId: wallet.id,
						chain: breakdown.chain,
						reason: 'totalUsd===0 && tokens.length===0',
					});
					continue;
				}

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

export async function computeWalletValue(walletId: string, address: string, chains: SupportedChain[]) {
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

	const symbolPriceMap = await getSimpleTokenPrices(
		Array.from(
			new Set(
				balances
					.map((b) => (b.tokenSymbol ?? '').trim().toUpperCase())
					.filter((sym) => sym.length > 0 && sym.length <= 15),
			),
		),
	);

	const byChain = new Map<SupportedChain, WalletValueBreakdown>();

	for (const balance of balances) {
		const symbol = (balance.tokenSymbol ?? '').trim().toUpperCase();
		const priceUsd = symbol ? symbolPriceMap[symbol] ?? 0 : 0;
		const amount = balance.decimals ? Number(balance.rawBalance) / 10 ** balance.decimals : Number(balance.rawBalance);
		let valueUsd = amount * priceUsd;
		if (valueUsd < 0.01) {
			valueUsd = 0;
		}

		const entry =
			byChain.get(balance.chain) ??
			byChain.set(balance.chain, { walletId, chain: balance.chain, totalUsd: 0, tokens: [] }).get(balance.chain)!;

		const tokenEntry: TokenSnapshot = {
			chain: balance.chain,
			symbol: balance.tokenSymbol,
			amount,
			priceUsd,
			valueUsd,
			tokenAddress: balance.tokenAddress,
		};

		if (tokenEntry.amount === 0 && tokenEntry.valueUsd === 0) {
			continue;
		}

		entry.tokens.push(tokenEntry);
		entry.totalUsd += tokenEntry.valueUsd;
	}

	return Array.from(byChain.values());
}
