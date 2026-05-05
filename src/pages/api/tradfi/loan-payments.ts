import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request, url }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const loanId = url.searchParams.get('loanId')?.trim() ?? '';
		if (!loanId) {
			return new Response(JSON.stringify({ ok: false, error: 'Missing loanId.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const result = await db.execute({
			sql: `
        SELECT id, payment_date, amount_usd
        FROM tradfi_loan_payments
        WHERE loan_id = ? AND tenant_id = ?
        ORDER BY payment_date DESC
      `,
			args: [loanId, tenantId],
		});

		const payments = result.rows.map((row) => ({
			id: String(row.id),
			paymentDate: String(row.payment_date),
			amountUsd: Number(row.amount_usd),
		}));

		return new Response(JSON.stringify({ ok: true, payments }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err: unknown) {
		console.error('loan-payments GET error', err);
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const body = await request.json();
		const loanId = String(body?.loanId || '').trim();
		const paymentDate = String(body?.paymentDate || '').trim();
		const amountUsd = Number(body?.amountUsd);

		if (!loanId || !paymentDate || !Number.isFinite(amountUsd) || amountUsd <= 0) {
			return new Response(
				JSON.stringify({ ok: false, error: 'Invalid loanId, paymentDate, or amountUsd.' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const id = crypto.randomUUID();

		await db.execute(
			`
      INSERT INTO tradfi_loan_payments (
        id,
        tenant_id,
        loan_id,
        payment_date,
        amount_usd
      )
      VALUES (?, ?, ?, ?, ?)
      `,
			[id, tenantId, loanId, paymentDate, amountUsd],
		);

		return new Response(JSON.stringify({ ok: true, id }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err: unknown) {
		console.error('loan-payments error', err);
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

export const DELETE: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const body = await request.json();
		const id = String(body?.id || '').trim();
		if (!id) {
			return new Response(JSON.stringify({ ok: false, error: 'Missing id.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		await db.execute(
			`
      DELETE FROM tradfi_loan_payments
      WHERE id = ? AND tenant_id = ?
      `,
			[id, tenantId],
		);

		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err: unknown) {
		console.error('loan-payments DELETE error', err);
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ ok: false, error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
