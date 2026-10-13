import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { buildEtherscanV2Url, requestEtherscan, CHAIN_IDS } from '@/lib/etherscan';

export const prerender = false;

const SUPPORTED_CHAINS = ['ethereum', 'avalanche', 'polygon'] as const;
type Chain = (typeof SUPPORTED_CHAINS)[number];

function chainId(chain: Chain): number {
	return CHAIN_IDS[chain];
}

// ── GET /api/wallets/[id]/transactions?hash=<hash>&chain=<chain> ──────────────
// Look up a tx by hash and return pre-fill data. Returns 200 with data or 404.
export const GET: APIRoute = async ({ request, url, params }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id!;
		await requireWalletOwnedByTenant(walletId, tenantId);

		const hash = url.searchParams.get('hash')?.trim().toLowerCase();
		const chain = (url.searchParams.get('chain') ?? 'ethereum') as Chain;

		if (!hash || !/^0x[a-f0-9]{64}$/i.test(hash)) {
			return respond({ error: true, message: 'A valid 66-character 0x transaction hash is required.' }, 400);
		}
		if (!SUPPORTED_CHAINS.includes(chain)) {
			return respond({ error: true, message: `Unsupported chain. Use: ${SUPPORTED_CHAINS.join(', ')}.` }, 400);
		}

		// Fetch tx via Etherscan proxy
		const cid = chainId(chain);
		const txUrl = buildEtherscanV2Url(cid, {
			module: 'proxy',
			action: 'eth_getTransactionByHash',
			txhash: hash,
		});

		let txData: any = null;
		try {
			const raw = await requestEtherscan(txUrl);
			txData = raw?.result ?? null;
		} catch {
			// Explorer unreachable — return partial data so user can fill in manually
		}

		if (!txData) {
			return respond({ found: false, hash, chain }, 200);
		}

		// Try to get block timestamp
		let timestamp: string | null = null;
		if (txData.blockNumber) {
			try {
				const blockUrl = buildEtherscanV2Url(cid, {
					module: 'proxy',
					action: 'eth_getBlockByNumber',
					tag: txData.blockNumber,
					boolean: 'false',
				});
				const blockRaw = await requestEtherscan(blockUrl);
				const blockTs = blockRaw?.result?.timestamp;
				if (blockTs) {
					const unix = parseInt(blockTs, 16);
					timestamp = new Date(unix * 1000).toISOString();
				}
			} catch {
				// Non-critical — user can enter date manually
			}
		}

		return respond({
			found: true,
			hash,
			chain,
			from: txData.from ?? null,
			to: txData.to ?? null,
			value: txData.value ?? null,
			timestamp,
			blockNumber: txData.blockNumber ? parseInt(txData.blockNumber, 16) : null,
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[wallet transactions GET]', error);
		return respond({ error: true, message: 'Lookup failed.' }, 500);
	}
};

// ── POST /api/wallets/[id]/transactions ───────────────────────────────────────
// Save a custom transaction (hash-based or manual).
export const POST: APIRoute = async ({ request, params }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id!;
		await requireWalletOwnedByTenant(walletId, tenantId);

		const body = await request.json();
		const path: 'hash' | 'manual' = body.path === 'hash' ? 'hash' : 'manual';

		// Shared fields
		const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
		const notes = typeof body.notes === 'string' ? body.notes.trim() : null;

		if (path === 'hash') {
			const hash = typeof body.hash === 'string' ? body.hash.trim().toLowerCase() : '';
			if (!/^0x[a-f0-9]{64}$/.test(hash)) {
				return respond({ error: true, message: 'A valid 66-character 0x transaction hash is required.' }, 400);
			}
			const chain = SUPPORTED_CHAINS.includes(body.chain) ? (body.chain as Chain) : 'ethereum';
			const timestamp = body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString();
			const from = typeof body.from === 'string' ? body.from.toLowerCase() : null;
			const to = typeof body.to === 'string' ? body.to.toLowerCase() : null;
			const value = typeof body.value === 'string' ? body.value : null;
			const blockNumber = typeof body.blockNumber === 'number' ? body.blockNumber : null;
			const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : null;
			const usdValue = typeof body.usdValue === 'number' ? body.usdValue : null;

			const metadata = JSON.stringify({
				isCustomEntry: true,
				path: 'hash',
				kind: kind || null,
				notes: notes || null,
				usdValue,
			});

			const result = await db.execute({
				sql: `INSERT INTO transactions
					(tenant_id, wallet_id, hash, chain, block_number, timestamp, from_address, to_address, value, token_symbol, tx_type, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(tenant_id, hash, chain) DO UPDATE SET
						wallet_id = excluded.wallet_id,
						tx_type = excluded.tx_type,
						metadata_json = excluded.metadata_json
					RETURNING *`,
				args: [tenantId, walletId, hash, chain, blockNumber, timestamp, from, to, value, symbol, kind || null, metadata],
			});

			return respond({ ok: true, transaction: result.rows[0] }, 201);
		}

		// Manual path
		const dateRaw = typeof body.date === 'string' ? body.date : null;
		if (!dateRaw) {
			return respond({ error: true, message: 'Date is required for manual transactions.' }, 400);
		}
		const timestamp = new Date(dateRaw).toISOString();

		const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : null;
		if (!symbol) {
			return respond({ error: true, message: 'Symbol is required.' }, 400);
		}

		const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount);
		if (!isFinite(amount) || amount <= 0) {
			return respond({ error: true, message: 'A positive amount is required.' }, 400);
		}

		// Auto-derive direction from kind so sell always = out, buy always = in
	let direction: 'in' | 'out' = body.direction === 'out' ? 'out' : 'in';
	if (kind === 'sell' || kind === 'outbound') direction = 'out';
	if (kind === 'buy'  || kind === 'inbound')  direction = 'in';
		const usdValue = typeof body.usdValue === 'number' ? body.usdValue : null;
		const chain = SUPPORTED_CHAINS.includes(body.chain) ? (body.chain as Chain) : 'custom';

		// Synthetic hash so the UNIQUE constraint is satisfied
		const syntheticHash = `manual_${crypto.randomUUID().replace(/-/g, '')}`;

		const metadata = JSON.stringify({
			isCustomEntry: true,
			path: 'manual',
			direction,
			kind: kind || null,
			notes: notes || null,
			usdValue,
			amount,
		});

		const result = await db.execute({
			sql: `INSERT INTO transactions
				(tenant_id, wallet_id, hash, chain, timestamp, token_symbol, tx_type, metadata_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				RETURNING *`,
			args: [tenantId, walletId, syntheticHash, chain, timestamp, symbol, kind || null, metadata],
		});

		return respond({ ok: true, transaction: result.rows[0] }, 201);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[wallet transactions POST]', error);
		return respond({ error: true, message: 'Unable to save transaction. Please try again.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
