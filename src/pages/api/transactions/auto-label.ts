import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { getAllActiveWallets } from '../../../lib/wallets';
import {
	isInternalTransfer,
	isLikelyLost,
	upsertTransactionAnnotation,
	type TransactionRow,
} from '../../../lib/transactions';

export const prerender = false;

type DbRow = Record<string, unknown>;

const toTransactionRows = (rows: unknown): TransactionRow[] => {
	if (!Array.isArray(rows)) return [];
	const out: TransactionRow[] = [];
	for (const row of rows) {
		if (row && typeof row === 'object') {
			out.push(row as DbRow as TransactionRow);
		}
	}
	return out;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const wallets = await getAllActiveWallets(tenantId);
		const addressSet = wallets.map((wallet) => wallet.address.toLowerCase());

		const result = await db.execute({
			sql: `SELECT t.*, a.id AS annotation_id
          FROM transactions t
          LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
          WHERE t.tenant_id = ? AND a.id IS NULL
          ORDER BY t.timestamp DESC
          LIMIT 500`,
			args: [tenantId],
		});

		let internalCount = 0;
		let lostCount = 0;

		for (const row of toTransactionRows(result.rows)) {
			if (isInternalTransfer(row, addressSet)) {
				await upsertTransactionAnnotation(tenantId, {
					transactionId: row.id,
					category: 'internal_transfer',
					note: 'Auto-labeled as internal transfer',
				});
				internalCount += 1;
			} else if (isLikelyLost(row)) {
				await upsertTransactionAnnotation(tenantId, {
					transactionId: row.id,
					category: 'lost',
					note: 'Auto-labeled as likely burn/lost',
				});
				lostCount += 1;
			}
		}

		return respond({
			ok: true,
			internalCount,
			lostCount,
			processed: result.rows.length,
		});
	} catch (error) {
		console.error('Auto-label failed', error);
		return respond({ error: true, message: 'Unable to auto-label transactions.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
