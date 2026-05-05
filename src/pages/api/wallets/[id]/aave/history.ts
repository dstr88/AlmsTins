import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

/**
 * GET /api/wallets/:id/aave/history
 *
 * Returns all Aave-related transactions for a wallet, ordered by timestamp DESC.
 * Includes:
 *   - aave_supply, aave_borrow, aave_repay, aave_withdraw  (decoded from on-chain txlist)
 *   - aave_liquidation                                      (fetched from The Graph subgraph)
 *
 * Liquidation events are taxable — they represent a forced collateral sale.
 */
export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(walletId, tenantId);

		const result = await db.execute({
			sql: `SELECT
				id,
				hash,
				chain,
				block_number,
				timestamp,
				from_address,
				to_address,
				value,
				token_symbol,
				token_decimals,
				tx_type,
				status,
				fee_paid,
				metadata_json
			FROM transactions
			WHERE wallet_id = ? AND tenant_id = ? AND tx_type LIKE 'aave_%'
			ORDER BY timestamp DESC
			LIMIT 200`,
			args: [walletId, tenantId],
		});

		const events = result.rows.map((row: any) => {
			let metadata: Record<string, any> | null = null;
			try {
				metadata = row.metadata_json ? JSON.parse(row.metadata_json) : null;
			} catch {
				// malformed JSON — ignore
			}
			return {
				id: row.id,
				hash: row.hash,
				chain: row.chain,
				blockNumber: row.block_number,
				timestamp: row.timestamp,
				fromAddress: row.from_address,
				toAddress: row.to_address,
				value: row.value,
				tokenSymbol: row.token_symbol,
				tokenDecimals: row.token_decimals,
				txType: row.tx_type,
				status: row.status,
				feePaid: row.fee_paid,
				metadata,
			};
		});

		return new Response(JSON.stringify({ ok: true, events }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[aave/history] error', err);
		return new Response(JSON.stringify({ error: true, message: 'Internal error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
