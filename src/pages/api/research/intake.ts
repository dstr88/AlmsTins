import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

let tableEnsured = false;

async function ensureTable() {
	if (tableEnsured) return;
	await db.execute({
		sql: `CREATE TABLE IF NOT EXISTS tenant_intake (
			tenant_id TEXT PRIMARY KEY,
			answers   TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
		)`,
		args: [],
	});
	tableEnsured = true;
}

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	await ensureTable();

	const result = await db.execute({
		sql: `SELECT answers, updated_at FROM tenant_intake WHERE tenant_id = ?`,
		args: [tenantId],
	});

	const row = result.rows[0] as any;
	return new Response(
		JSON.stringify({
			ok: true,
			answers: row ? JSON.parse(String(row.answers)) : {},
			updatedAt: row?.updated_at ?? null,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return new Response('Bad Request', { status: 400 });
	}

	await ensureTable();

	await db.execute({
		sql: `INSERT INTO tenant_intake (tenant_id, answers, updated_at)
		      VALUES (?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
		      ON CONFLICT(tenant_id) DO UPDATE SET
		        answers    = excluded.answers,
		        updated_at = excluded.updated_at`,
		args: [tenantId, JSON.stringify(body)],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
