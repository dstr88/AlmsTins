import type { AlchemyChain } from '@/lib/alchemy';
import { getAllTokenBalances, getNativeBalanceWei, getTokenMetadata } from '@/lib/alchemy';
import { trackedTokenForContract, type TokenBalance } from '@/lib/balances';
import { classifyContract, isSpamToken } from '@/lib/knownContracts';
import { extractSpamDomains, savePhishingDomains } from '@/lib/phishingDomains';

/**
 * Every token an Ethereum or Polygon wallet holds, read from Alchemy: the native coin plus each
 * ERC-20 with a balance, minus scam copies and phishing airdrops.
 *
 * Both writers of a wallet's Ethereum and Polygon snapshot use this (Sync Tins through
 * computeWalletValue, and the wallet card's refresh in /api/wallets/[id]/tokens). They used to
 * build the snapshot two different ways: Sync Tins read a short hand-kept list of contracts and
 * the card read Alchemy's ERC-20 list without the native coin. Whichever ran last became the
 * wallet's latest snapshot, so the same wallet showed different tokens depending on which
 * button had been pressed most recently, and neither list was complete.
 */
export type EvmDiscoveryChain = 'ethereum' | 'polygon';

const ALCHEMY_CHAIN: Record<EvmDiscoveryChain, AlchemyChain> = {
	ethereum: 'eth-mainnet',
	polygon: 'polygon-mainnet',
};

// Same symbols balances.ts gives the native coins, so both paths store identical rows.
const NATIVE_SYMBOL: Record<EvmDiscoveryChain, string> = {
	ethereum: 'ETH',
	polygon: 'MATIC',
};

const METADATA_CONCURRENCY = 5;
const METADATA_RETRY_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TokenMetadata = Awaited<ReturnType<typeof getTokenMetadata>>;

async function getMetadataWithRetry(chain: AlchemyChain, contract: string): Promise<TokenMetadata | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await getTokenMetadata(chain, contract);
		} catch {
			if (attempt === 0) await sleep(METADATA_RETRY_DELAY_MS);
		}
	}
	return null;
}

function parseBalance(raw: unknown): bigint {
	try {
		return BigInt(String(raw ?? '0'));
	} catch {
		return 0n;
	}
}

export async function discoverEvmBalances(chain: EvmDiscoveryChain, address: string): Promise<TokenBalance[]> {
	const alchemyChain = ALCHEMY_CHAIN[chain];
	const results: TokenBalance[] = [];

	const nativeWei = await getNativeBalanceWei(alchemyChain, address);
	if (nativeWei > 0n) {
		results.push({
			chain,
			address,
			tokenSymbol: NATIVE_SYMBOL[chain],
			tokenAddress: null,
			decimals: 18,
			rawBalance: nativeWei,
		});
	}

	const held = (await getAllTokenBalances(alchemyChain, address))
		.map((entry) => ({
			contract: String(entry.contractAddress ?? '').toLowerCase(),
			rawBalance: parseBalance(entry.tokenBalance),
		}))
		.filter((entry) => entry.contract && entry.rawBalance > 0n);

	const metadataByContract = new Map<string, TokenMetadata | null>();
	for (let i = 0; i < held.length; i += METADATA_CONCURRENCY) {
		const batch = held.slice(i, i + METADATA_CONCURRENCY);
		const metadata = await Promise.all(batch.map((entry) => getMetadataWithRetry(alchemyChain, entry.contract)));
		batch.forEach((entry, j) => metadataByContract.set(entry.contract, metadata[j]));
	}

	for (const { contract, rawBalance } of held) {
		const metadata = metadataByContract.get(contract) ?? null;
		const tracked = trackedTokenForContract(chain, contract);

		// A failed metadata lookup used to fall back to 18 decimals and no symbol, which stored a
		// nameless row the reader then threw away. A token we track by address keeps its own
		// symbol and decimals; an unknown contract with no metadata is skipped.
		const symbol = String(metadata?.symbol ?? tracked?.symbol ?? '').trim().toUpperCase();
		const decimals = typeof metadata?.decimals === 'number' ? metadata.decimals : tracked?.decimals;
		if (!symbol || typeof decimals !== 'number') {
			console.warn('[evmTokenDiscovery] no metadata, token skipped', { chain, contract });
			continue;
		}
		if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue;

		// A token using a real token's symbol from the wrong contract (fake AAVE, fake USDC).
		if (classifyContract(chain, symbol, contract) === 'scam') continue;

		// A phishing airdrop whose name or symbol carries a URL or Telegram link.
		const name = typeof metadata?.name === 'string' ? metadata.name : null;
		if (isSpamToken(symbol, name)) {
			const domains = extractSpamDomains(symbol, name);
			if (domains.length) void savePhishingDomains(domains);
			continue;
		}

		results.push({ chain, address, tokenSymbol: symbol, tokenAddress: contract, decimals, rawBalance });
	}

	return results;
}
