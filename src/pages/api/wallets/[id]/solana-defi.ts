import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { getAllActiveWallets } from '@/lib/wallets';
import { getCache } from '@/lib/tursoCache';

export const prerender = false;

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// ── Known DeFi protocol definitions ──────────────────────────────────────────

type ProtocolDef = {
	name: string;
	programId: string;
	/** byte offset of the owner/authority pubkey in the account data */
	offset: number;
};

const DEFI_PROTOCOLS: ProtocolDef[] = [
	{ name: 'Kamino Finance',   programId: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', offset: 57 },
	{ name: 'MarginFi',         programId: 'MFv2hWf31Z9kbCa1snEPdcgp7vGKRuQHCX5iFZkZdj1', offset: 40 },
	{ name: 'Drift Protocol',   programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', offset: 8  },
	{ name: 'Orca Whirlpools',  programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', offset: 8  },
	{ name: 'Raydium AMM',      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', offset: 8  },
	{ name: 'Jupiter',          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', offset: 8  },
	{ name: 'Pyth Staking',     programId: 'pytS9TFNez6VM5kMon3apkp9zsEFXDfNnGFZ2aSbKbE', offset: 12 },
	{ name: 'Marinade Finance', programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', offset: 8  },
	{ name: 'Solend',           programId: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', offset: 8  },
	{ name: 'Native Staking',   programId: 'Stake11111111111111111111111111111111111111112', offset: 44 },
];

// Program IDs to suppress from recent-programs output (system noise)
const SYSTEM_PROGRAMS = new Set([
	'11111111111111111111111111111111',
	'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
	'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXB',
	'ComputeBudget111111111111111111111111111111',
	'SysvarRent111111111111111111111111111111111',
	'SysvarC1ock11111111111111111111111111111111',
	'Vote111111111111111111111111111111111111111h',
]);

const PROGRAM_ID_TO_NAME: Record<string, string> = {};
for (const p of DEFI_PROTOCOLS) PROGRAM_ID_TO_NAME[p.programId] = p.name;

// ── RPC helper ────────────────────────────────────────────────────────────────

async function solanaRpc<T = unknown>(method: string, params: unknown[]): Promise<T | null> {
	try {
		const res = await fetch(SOLANA_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		if (!res.ok) return null;
		const json = await res.json() as { result?: T; error?: unknown };
		if (json?.error) return null;
		return json?.result ?? null;
	} catch {
		return null;
	}
}

// ── Protocol detection ────────────────────────────────────────────────────────

async function detectProtocol(address: string, proto: ProtocolDef): Promise<string | null> {
	// Solana RPC accepts base58 address string directly in memcmp.bytes
	const result = await solanaRpc<unknown[]>('getProgramAccounts', [
		proto.programId,
		{
			encoding: 'base64',
			filters: [{ memcmp: { offset: proto.offset, bytes: address } }],
			dataSlice: { offset: 0, length: 0 }, // no data needed — just check existence
		},
	]);
	return Array.isArray(result) && result.length > 0 ? proto.name : null;
}

// ── Transaction history → recent programs ────────────────────────────────────

type SigInfo = { signature: string };
type TxResult = { transaction?: { message?: { accountKeys?: string[] } } };

async function fetchRecentPrograms(address: string): Promise<Array<{ programId: string; name: string | null }>> {
	const sigs = await solanaRpc<SigInfo[]>('getSignaturesForAddress', [address, { limit: 50 }]);
	if (!Array.isArray(sigs) || sigs.length === 0) return [];

	// Sample up to 10 evenly-spaced transactions
	const step = Math.max(1, Math.floor(sigs.length / 10));
	const sampled = sigs.filter((_, i) => i % step === 0).slice(0, 10);

	const txResults = await Promise.all(
		sampled.map((sig) =>
			solanaRpc<TxResult>('getTransaction', [
				sig.signature,
				{ encoding: 'json', maxSupportedTransactionVersion: 0 },
			]),
		),
	);

	const seen = new Set<string>();
	for (const tx of txResults) {
		for (const key of tx?.transaction?.message?.accountKeys ?? []) {
			if (typeof key === 'string' && !SYSTEM_PROGRAMS.has(key)) seen.add(key);
		}
	}

	return Array.from(seen).map((id) => ({ programId: id, name: PROGRAM_ID_TO_NAME[id] ?? null }));
}

// ── Route ─────────────────────────────────────────────────────────────────────

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

		// Check for seeded/cached data before hitting the live Solana RPC
		const cached = await getCache<{ protocols: string[]; recentPrograms: { programId: string; name: string | null }[] }>(
			`solana-defi:${walletId}`,
		);
		if (cached) {
			return respond({ ok: true, address, protocols: cached.protocols, recentPrograms: cached.recentPrograms }, 200);
		}

		const [detectedNames, recentPrograms] = await Promise.all([
			Promise.all(DEFI_PROTOCOLS.map((proto) => detectProtocol(address, proto))).then(
				(results) => results.filter((n): n is string => n !== null),
			),
			fetchRecentPrograms(address),
		]);

		return respond({ ok: true, address, protocols: detectedNames, recentPrograms }, 200);
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[solana-defi] error', err);
		return respond({ error: true, message: 'Failed to fetch Solana DeFi data.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
