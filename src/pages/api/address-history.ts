/**
 * GET /api/address-history?address=...
 *
 * The signed-in user's own transactions with one address, with totals, for the address details
 * modal on the Wallets page's Address Labels list. Only the user's own records: never the
 * address's on-chain history, and nothing here calls an explorer or any outside service.
 *
 * EVM rows store full counterparties; Bitcoin, Solana and Sui rows store one since
 * counterparty_address was added (rows synced before that have none). Litecoin history is not
 * imported at all. So:
 *   - an exchange account id (cex:...) or anything that is not an address → not_onchain
 *   - a Litecoin address → not_kept_yet, with its network
 *   - an EVM, Bitcoin, Solana or Sui address → the rows and totals
 *
 * Totals cover every matching row (up to MAX_ADDRESS_ROWS, counted before any row is loaded);
 * the list shows the newest MAX_LISTED_ROWS, with truncated set when there are more. Above
 * MAX_ADDRESS_ROWS the answer is too_many.
 *
 * Every read is scoped by the session's tenant_id. The queried address is never logged and
 * nothing is cached.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addressNetwork } from '@/lib/addressNetwork';
import { HistoryTooLargeError, loadHistoryRows } from '@/lib/historyRows';
import { summarizeAddressHistory } from '@/lib/addressHistory';
import { explorerTxUrl } from '@/lib/explorerLinks';

const MAX_ADDRESS_LENGTH = 128;
/** Networks whose rows keep a counterparty (src/lib/historyRows.ts). */
const KEPT_NETWORKS = new Set(['evm', 'btc', 'sol', 'sui']);
/** Rows the list shows, newest first. */
export const MAX_LISTED_ROWS = 500;
/** Rows the totals read; more is refused before any row is loaded. */
export const MAX_ADDRESS_ROWS = 5_000;

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	const address = (new URL(request.url).searchParams.get('address') ?? '').trim();
	if (!address || address.length > MAX_ADDRESS_LENGTH) return json({ error: 'A valid address is required.' }, 400);

	const network = addressNetwork(address);
	if (network === null) return json({ supported: false, reason: 'not_onchain' }, 200);
	if (!KEPT_NETWORKS.has(network)) return json({ supported: false, reason: 'not_kept_yet', network }, 200);

	try {
		const walletRes = await db.execute({
			sql: 'SELECT id, label FROM wallets WHERE tenant_id = ? AND lower(address) = ? ORDER BY id LIMIT 1',
			args: [tenantId, address.toLowerCase()],
		});
		const wallet = walletRes.rows[0] as Record<string, unknown> | undefined;
		const ownWallet = wallet ? { id: String(wallet.id), label: wallet.label == null ? null : String(wallet.label) } : null;

		// As typed: base58 is case-sensitive; historyRows puts each network's value in its stored form.
		const rows = await loadHistoryRows(tenantId, { counterparty: address }, MAX_ADDRESS_ROWS);
		const { totals, firstDate, lastDate } = summarizeAddressHistory(rows);
		const listed = rows.slice(-MAX_LISTED_ROWS).reverse();

		return json(
			{
				supported: true,
				network,
				ownWallet,
				totals,
				firstDate,
				lastDate,
				rows: listed.map((r) => ({
					date: r.date,
					direction: r.direction,
					chain: r.chain,
					asset: r.asset,
					amount: r.amount,
					usdValue: r.usdValue,
					txHash: r.txHash,
					txUrl: r.txHash ? explorerTxUrl(r.chain, r.txHash) : null,
					failed: r.failed,
				})),
				truncated: rows.length > MAX_LISTED_ROWS,
			},
			200,
		);
	} catch (err) {
		if (err instanceof HistoryTooLargeError) {
			return json({ supported: false, reason: 'too_many' }, 200);
		}
		// Generic on purpose: the address never reaches the logs.
		console.error('[address-history] lookup failed');
		return json({ error: 'Could not load this history.' }, 500);
	}
};
