import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { upsertTransactionAnnotation } from '../../../lib/transactions';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { transactionId, category, note } = body ?? {};

		if (!transactionId) {
			return new Response(JSON.stringify({ error: true, message: 'transactionId is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const txResult = await db.execute({
			sql: 'SELECT id FROM transactions WHERE id = ? LIMIT 1',
			args: [transactionId],
		});

		if (!txResult.rows.length) {
			return new Response(JSON.stringify({ error: true, message: 'Transaction not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		await upsertTransactionAnnotation({
			transactionId,
			category: category ?? null,
			note: note ?? null,
		});

		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('Failed to annotate transaction', err);
		return new Response(JSON.stringify({ error: true, message: 'Unable to save annotation.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
