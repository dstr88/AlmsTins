import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { db } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	try {
		await requireAdminSession(request);
	} catch {
		return new Response('Forbidden', { status: 403 });
	}

	const tenantFilter = url.searchParams.get('tenant') ?? null;
	const sourceFilter = url.searchParams.get('source') ?? null;
	const chainFilter  = url.searchParams.get('chain')  ?? null;
	const limit = Math.min(Number(url.searchParams.get('limit') ?? 300), 500);

	const conditions: string[] = [];
	const args: unknown[] = [];

	if (tenantFilter) { conditions.push('tenant_id = ?'); args.push(tenantFilter); }
	if (sourceFilter) { conditions.push('source = ?');    args.push(sourceFilter); }
	if (chainFilter)  { conditions.push('chain = ?');     args.push(chainFilter); }

	const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
	args.push(limit);

	const [entries, tenantCount, sources, chains] = await Promise.all([
		db.execute({
			sql: `SELECT id, tenant_id, event_type, source, chain, summary, payload, created_at
			      FROM admin_activity_log ${where}
			      ORDER BY created_at DESC LIMIT ?`,
			args,
		}),
		db.execute({
			sql: `SELECT COUNT(DISTINCT tenant_id) AS cnt FROM admin_activity_log`,
			args: [],
		}),
		db.execute({
			sql: `SELECT DISTINCT source FROM admin_activity_log WHERE source IS NOT NULL ORDER BY source`,
			args: [],
		}),
		db.execute({
			sql: `SELECT DISTINCT chain FROM admin_activity_log WHERE chain IS NOT NULL ORDER BY chain`,
			args: [],
		}),
	]);

	return new Response(
		JSON.stringify({
			ok: true,
			entries: entries.rows,
			tenants: Number((tenantCount.rows[0] as any)?.cnt ?? 0),
			sources: sources.rows.map((r: any) => r.source),
			chains:  chains.rows.map((r: any) => r.chain),
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
