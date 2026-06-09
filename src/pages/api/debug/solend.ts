import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getSolendPositions } from '@/lib/solend';

export const prerender = false;

const SOLEND_PROGRAM = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

function rpcUrl(): string {
	return (
		process.env.SOLANA_RPC_URL ||
		(import.meta as { env?: Record<string, string | undefined> }).env?.SOLANA_RPC_URL ||
		PUBLIC_SOLANA_RPC
	);
}

function maskRpc(url: string): string {
	try {
		const u = new URL(url);
		return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?…(key masked)' : ''}`;
	} catch {
		return 'invalid-url';
	}
}

/** Raw RPC call that surfaces errors instead of swallowing them. */
async function rawRpc(method: string, params: unknown[], url: string) {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
		return { httpStatus: res.status, error: json?.error?.message ?? null, result: json?.result ?? null };
	} catch (e) {
		return { httpStatus: 0, error: (e as Error).message, result: null };
	}
}

/**
 * GET /api/debug/solend?address=<solana wallet>
 * Auth-gated diagnostic — reports whether getProgramAccounts works on the
 * configured RPC and what Solend obligations the wallet owns.
 */
export const GET: APIRoute = async ({ url, request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);

	const address = url.searchParams.get('address') ?? '';
	if (!address) return json({ error: 'Pass ?address=<solana wallet>' }, 400);

	const rpc = rpcUrl();
	const usingPublicFallback = rpc === PUBLIC_SOLANA_RPC;

	// 1. Does getProgramAccounts work at all on this RPC? (narrowed by size)
	const gpa = await rawRpc(
		'getProgramAccounts',
		[
			SOLEND_PROGRAM,
			{
				encoding: 'base64',
				dataSlice: { offset: 0, length: 0 },
				filters: [
					{ dataSize: 1300 },
					{ memcmp: { offset: 42, bytes: address } },
				],
			},
		],
		rpc,
	);

	// 2. Same query WITHOUT the size filter (broad scan) — to compare.
	const gpaBroad = await rawRpc(
		'getProgramAccounts',
		[
			SOLEND_PROGRAM,
			{
				encoding: 'base64',
				dataSlice: { offset: 0, length: 0 },
				filters: [{ memcmp: { offset: 42, bytes: address } }],
			},
		],
		rpc,
	);

	// 3. What the production reader returns.
	let readerPositions: unknown = null;
	let readerError: string | null = null;
	try {
		readerPositions = await getSolendPositions(address);
	} catch (e) {
		readerError = (e as Error).message;
	}

	const obligations = Array.isArray(gpa.result)
		? (gpa.result as Array<{ pubkey: string }>).map((a) => a.pubkey)
		: null;

	return json({
		address,
		rpc: maskRpc(rpc),
		usingPublicFallback,
		getProgramAccounts_sized: {
			httpStatus: gpa.httpStatus,
			error: gpa.error,
			count: Array.isArray(gpa.result) ? gpa.result.length : null,
			obligationPubkeys: obligations,
		},
		getProgramAccounts_broad: {
			httpStatus: gpaBroad.httpStatus,
			error: gpaBroad.error,
			count: Array.isArray(gpaBroad.result) ? gpaBroad.result.length : null,
		},
		reader: { positions: readerPositions, error: readerError },
	});
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
