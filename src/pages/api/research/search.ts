import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const url       = new URL(request.url);
	const q         = url.searchParams.get('q')?.trim()         ?? '';
	const symbol    = url.searchParams.get('symbol')?.trim().toUpperCase() ?? '';
	const from      = url.searchParams.get('from')?.trim()      ?? '';
	const to        = url.searchParams.get('to')?.trim()        ?? '';
	const note      = url.searchParams.get('note')?.trim()      ?? '';
	const direction = url.searchParams.get('direction')?.trim().toLowerCase() ?? '';

	// At least one filter must be present
	if (!q && !symbol && !from && !to && !note && !direction) {
		return new Response(JSON.stringify({ rows: [], total: 0 }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const conditions: string[] = ['t.tenant_id = ?'];
	const args: unknown[]      = [tenantId];

	if (symbol) {
		conditions.push('upper(t.asset_symbol) = ?');
		args.push(symbol);
	}
	if (direction === 'in' || direction === 'out') {
		conditions.push('t.direction = ?');
		args.push(direction);
	}
	if (from) {
		conditions.push("t.timestamp_utc >= ?");
		args.push(from);
	}
	if (to) {
		conditions.push("t.timestamp_utc <= ?");
		args.push(to + 'T23:59:59Z');
	}
	if (note) {
		conditions.push('(lower(t.notes) LIKE ? OR lower(t.description) LIKE ?)');
		args.push(`%${note.toLowerCase()}%`);
		args.push(`%${note.toLowerCase()}%`);
	}
	if (q) {
		// q matches: tx_hash, description, kind, asset_symbol, notes
		conditions.push(`(
			t.tx_hash       LIKE ? OR
			lower(t.description) LIKE ? OR
			lower(t.kind)        LIKE ? OR
			upper(t.asset_symbol) LIKE ? OR
			lower(t.notes)       LIKE ?
		)`);
		const lq = `%${q.toLowerCase()}%`;
		args.push(lq, lq, lq, `%${q.toUpperCase()}%`, lq);
	}

	const where = conditions.join(' AND ');

	const result = await db.execute({
		sql: `SELECT
		        t.id, t.source, t.account_id, t.timestamp_utc,
		        t.direction, t.asset_symbol, t.amount, t.to_currency, t.to_amount,
		        t.native_usd, t.kind, t.tx_hash, t.description, t.notes,
		        -- match info if this tx is part of a confirmed/auto match
		        m_out.id          AS match_id_as_out,
		        m_out.status      AS match_status_as_out,
		        m_out.in_tx_id    AS matched_in_tx_id,
		        m_out.confidence_score AS match_score_out,
		        m_in.id           AS match_id_as_in,
		        m_in.status       AS match_status_as_in,
		        m_in.out_tx_id    AS matched_out_tx_id,
		        m_in.confidence_score AS match_score_in,
		        -- address label if known
		        al.label          AS address_label,
		        -- exchange account name
		        ea.name           AS account_name
		      FROM import_transactions t
		      LEFT JOIN transfer_matches m_out ON m_out.tenant_id = t.tenant_id
		                                      AND m_out.out_tx_id = t.id
		                                      AND m_out.status != 'rejected'
		      LEFT JOIN transfer_matches m_in  ON m_in.tenant_id  = t.tenant_id
		                                      AND m_in.in_tx_id   = t.id
		                                      AND m_in.status != 'rejected'
		      LEFT JOIN address_labels al      ON al.tenant_id = t.tenant_id
		                                      AND al.address IN (
		                                        'cex:' || t.source || ':' || COALESCE(t.account_id,''),
		                                        COALESCE(t.tx_hash, '')
		                                      )
		      LEFT JOIN exchange_accounts ea   ON ea.id = t.account_id
		                                      AND ea.tenant_id = t.tenant_id
		      WHERE ${where}
		      ORDER BY t.timestamp_utc DESC
		      LIMIT 500`,
		args,
	});

	return new Response(JSON.stringify({ rows: result.rows, total: result.rows.length }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
