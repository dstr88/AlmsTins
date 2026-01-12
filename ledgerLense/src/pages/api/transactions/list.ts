import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const walletId = url.searchParams.get('walletId');
	const chain = url.searchParams.get('chain');
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');

	if (!walletId) {
		return respond({ error: true, message: 'walletId is required.' }, 400);
	}

	try {
		const clauses = ['t.wallet_id = ?'];
		const args: any[] = [walletId];

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
      LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
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
