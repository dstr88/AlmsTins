import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const result = await db.execute({
			sql: `SELECT id, loan_id, payment_date, amount_usd
            FROM tradfi_loan_payments
            WHERE tenant_id = ?
            ORDER BY payment_date DESC`,
			args: [tenantId],
		});
		const payments = result.rows.map((row) => ({
			id: String(row.id),
			loanId: String(row.loan_id),
			paymentDate: String(row.payment_date),
			amountUsd: Number(row.amount_usd),
		}));
		return new Response(JSON.stringify({ ok: true, payments }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
