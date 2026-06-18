/**
 * GET /api/demo/stats
 *
 * Returns demo session counts for the admin. Requires an authenticated
 * session — not accessible to demo or anonymous users.
 *
 * Response:
 *   { total, today, last7days, last30days }
 */

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { isDemo } = session;
		if (isDemo) {
			return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
		}

		const [total, today, last7, last30] = await Promise.all([
			db.execute({ sql: `SELECT COUNT(*) as n FROM demo_sessions`, args: [] }),
			db.execute({ sql: `SELECT COUNT(*) as n FROM demo_sessions WHERE started_at >= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"00:00:00"Z"')`, args: [] }),
			db.execute({ sql: `SELECT COUNT(*) as n FROM demo_sessions WHERE started_at >= to_char((now() - interval '7 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`, args: [] }),
			db.execute({ sql: `SELECT COUNT(*) as n FROM demo_sessions WHERE started_at >= to_char((now() - interval '30 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`, args: [] }),
		]);

		return new Response(
			JSON.stringify({
				total:    Number((total.rows[0]  as Record<string,unknown>).n ?? 0),
				today:    Number((today.rows[0]  as Record<string,unknown>).n ?? 0),
				last7days:  Number((last7.rows[0]  as Record<string,unknown>).n ?? 0),
				last30days: Number((last30.rows[0] as Record<string,unknown>).n ?? 0),
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}
};
