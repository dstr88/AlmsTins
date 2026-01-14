import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	const { tenantId } = await requireTenantSession(request);
	const yearParam = url.searchParams.get('year');
	const group = url.searchParams.get('group') ?? 'personal';
	const year = Number(yearParam);

	if (!yearParam || Number.isNaN(year)) {
		return respond({ ok: false, error: 'Invalid or missing year' }, 400);
	}

	try {
		const from = `${year}-01-01T00:00:00.000Z`;
		const to = `${year}-12-31T23:59:59.999Z`;

		const result = await db.execute({
			sql: `
        SELECT a.category, t.token_symbol, t.tx_type, t.value, t.timestamp
        FROM transactions t
        LEFT JOIN transaction_annotations a ON a.transaction_id = t.id AND a.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND t.timestamp BETWEEN ? AND ?
      `,
			args: [tenantId, from, to],
		});

		return respond({
			ok: true,
			year,
			group,
			rows: result.rows.map((row) => ({
				category: row.category ?? null,
				tokenSymbol: row.token_symbol ?? null,
				txType: row.tx_type ?? null,
				value: row.value,
				timestamp: row.timestamp,
			})),
		});
	} catch (error) {
		console.error('Failed to build tax summary', error);
		return respond({ ok: false, error: 'Unable to build tax summary.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
