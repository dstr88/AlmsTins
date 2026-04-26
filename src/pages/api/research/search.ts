import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL = 300; // 5 minutes

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

	const cacheKey = `t:${tenantId}:research:search:${[q, symbol, from, to, note, direction].join('|')}`;
	const cached   = await getCache<object>(cacheKey);
	if (cached !== null) {
		return new Response(JSON.stringify(cached), {
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

	// Run main search and matched-ID lookup in parallel — avoids the expensive
	// double transfer_matches JOIN on the main query.
	const [result, matchResult] = await Promise.all([
		db.execute({
			sql: `SELECT
			        t.id, t.source, t.account_id, t.timestamp_utc,
			        t.direction, t.asset_symbol, t.amount, t.to_currency, t.to_amount,
			        t.native_usd, t.kind, t.tx_hash, t.description, t.notes, t.category,
			        ea.name AS account_name
			      FROM import_transactions t
			      LEFT JOIN exchange_accounts ea ON ea.id = t.account_id
			                                    AND ea.tenant_id = t.tenant_id
			      WHERE ${where}
			      ORDER BY t.timestamp_utc DESC
			      LIMIT 500`,
			args,
		}),
		db.execute({
			sql: `SELECT out_tx_id AS tx_id, id AS match_id, status, in_tx_id AS other_tx_id, confidence_score
			      FROM transfer_matches WHERE tenant_id = ? AND status != 'rejected'
			      UNION ALL
			      SELECT in_tx_id AS tx_id, id AS match_id, status, out_tx_id AS other_tx_id, confidence_score
			      FROM transfer_matches WHERE tenant_id = ? AND status != 'rejected'`,
			args: [tenantId, tenantId],
		}),
	]);

	// Annotate each row with match info using a Map lookup (O(1))
	const matchMap = new Map<string, { match_id: string; status: string; other_tx_id: string; score: number }>();
	for (const m of matchResult.rows as any[]) {
		matchMap.set(String(m.tx_id), {
			match_id:    String(m.match_id),
			status:      String(m.status),
			other_tx_id: String(m.other_tx_id),
			score:       Number(m.confidence_score),
		});
	}
	const rows = (result.rows as any[]).map(r => {
		const m = matchMap.get(String(r.id));
		return m ? {
			...r,
			match_id_as_out:   r.direction === 'out' ? m.match_id : null,
			match_status_as_out: r.direction === 'out' ? m.status : null,
			matched_in_tx_id:  r.direction === 'out' ? m.other_tx_id : null,
			match_score_out:   r.direction === 'out' ? m.score : null,
			match_id_as_in:    r.direction === 'in'  ? m.match_id : null,
			match_status_as_in:  r.direction === 'in'  ? m.status : null,
			matched_out_tx_id: r.direction === 'in'  ? m.other_tx_id : null,
			match_score_in:    r.direction === 'in'  ? m.score : null,
		} : r;
	});

	const payload = { rows, total: rows.length };
	void setCache(cacheKey, payload, CACHE_TTL);

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
