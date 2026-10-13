// src/lib/sui.ts — Alchemy Sui JSON-RPC client

export type SuiCoinBalance = {
	coinType: string;
	coinObjectCount: number;
	totalBalance: string;
	lockedBalance: Record<string, string>;
};

export type SuiCoinMetadata = {
	decimals: number;
	name: string;
	symbol: string;
	description: string;
	iconUrl?: string | null;
};

export type SuiBalanceChange = {
	owner: { AddressOwner?: string } | string;
	coinType: string;
	amount: string;
};

export type SuiGasUsed = {
	computationCost: string;
	storageCost: string;
	storageRebate: string;
	nonRefundableStorageFee?: string;
};

export type SuiTransaction = {
	digest: string;
	timestampMs?: string | null;
	transaction?: {
		data?: {
			sender?: string;
		};
	};
	effects?: {
		status?: { status: string };
		gasUsed?: SuiGasUsed;
	};
	balanceChanges?: SuiBalanceChange[];
};

export type SuiQueryResult = {
	data: SuiTransaction[];
	nextCursor: string | null;
	hasNextPage: boolean;
};

async function suiRpc(method: string, params: unknown[]) {
	const apiKey = process.env.ALCHEMY_API_KEY ?? import.meta.env.ALCHEMY_API_KEY;
	if (!apiKey) throw new Error('Missing ALCHEMY_API_KEY');

	const url = `https://sui-mainnet.g.alchemy.com/v2/${apiKey}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});

	const payload = await response.json();
	if (!response.ok) throw new Error(`Sui RPC HTTP ${response.status}`);
	if (payload?.error) throw new Error(`Sui RPC error: ${payload.error?.message ?? 'unknown'}`);
	return payload?.result;
}

export async function getAllBalances(address: string): Promise<SuiCoinBalance[]> {
	const result = await suiRpc('suix_getAllBalances', [address]);
	return Array.isArray(result) ? result : [];
}

export async function getCoinMetadata(coinType: string): Promise<SuiCoinMetadata | null> {
	try {
		return await suiRpc('suix_getCoinMetadata', [coinType]);
	} catch {
		return null;
	}
}

export async function queryTransactionBlocks(
	address: string,
	cursor?: string | null,
	limit = 50,
): Promise<SuiQueryResult> {
	return suiRpc('suix_queryTransactionBlocks', [
		{
			filter: { FromOrToAddress: { addr: address } },
			options: {
				showEffects: true,
				showInput: true,
				showBalanceChanges: true,
			},
		},
		cursor ?? null,
		limit,
		false, // ascending — oldest first so cursor-based incremental sync works
	]);
}

/** Extract a short human-readable symbol from a Sui coin type string.
 *  e.g. "0x2::sui::SUI" → "SUI"
 *       "0xabc::usdc::USDC" → "USDC"
 */
export function parseSuiSymbol(coinType: string): string {
	const parts = coinType.split('::');
	return (parts[parts.length - 1] ?? coinType).toUpperCase();
}

/** Validate and normalize a Sui address (0x + 1–64 hex chars). */
export function sanitizeSuiAddress(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim().toLowerCase();
	if (!/^0x[a-f0-9]{1,64}$/.test(trimmed)) return null;
	// Pad to canonical 64-char form
	return '0x' + trimmed.slice(2).padStart(64, '0');
}

export const SUI_NATIVE_TYPE =
	'0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
export const SUI_DECIMALS = 9;
