import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const walletId = url.searchParams.get('walletId');
	const chain = url.searchParams.get('chain');
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');

	if (!walletId) {
		return respond({ error: true, message: 'Wallet id is required.' }, 400);
	}

	try {
		await requireWalletOwnedByTenant(walletId, tenantId);

		const clauses = ['t.wallet_id = ?', 't.tenant_id = ?', '(t.is_duplicate IS NULL OR t.is_duplicate = 0 OR t.is_duplicate = -1)'];
		const args: any[] = [walletId, tenantId];

		if (chain) {
			clauses.push('t.chain = ?');
			args.push(chain);
		}
		if (from) {
			clauses.push('t.timestamp >= ?');
			args.push(new Date(from).toISOString());
		}
		if (to) {
			clauses.push('t.timestamp <= ?');
			args.push(new Date(to).toISOString());
		}

		const query = `SELECT t.*, a.category, a.note
      FROM transactions t
      LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.timestamp DESC
      LIMIT ${limit} OFFSET ${offset}`;

		const result = await db.execute({
			sql: query,
			args,
		});

		return respond({
			transactions: result.rows,
			limit,
			offset,
			count: result.rows.length,
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Failed to load transactions', error);
		return respond({ error: true, message: 'Unable to load transactions.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
