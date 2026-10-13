import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

let tableEnsured = false;

async function ensureTable() {
	if (tableEnsured) return;
	await db.execute({
		sql: `CREATE TABLE IF NOT EXISTS vault_notes (
			id          TEXT NOT NULL PRIMARY KEY,
			tenant_id   TEXT NOT NULL,
			body        TEXT NOT NULL,
			created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
			resolved_at TEXT
		)`,
		args: [],
	});
	await db.execute({
		sql: `CREATE INDEX IF NOT EXISTS idx_vault_notes_tenant ON vault_notes (tenant_id, created_at DESC)`,
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
		sql: `SELECT id, body, created_at, resolved_at
		      FROM vault_notes
		      WHERE tenant_id = ?
		      ORDER BY resolved_at IS NOT NULL, created_at DESC`,
		args: [tenantId],
	});

	const notes = result.rows.map((r: any) => ({
		id:         String(r.id),
		body:       String(r.body),
		createdAt:  String(r.created_at),
		resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
	}));

	return new Response(JSON.stringify({ ok: true, notes }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	let body: { body?: string };
	try {
		body = await request.json();
	} catch {
		return new Response('Bad Request', { status: 400 });
	}

	const text = body?.body?.trim();
	if (!text) return new Response(JSON.stringify({ ok: false, error: 'body required' }), { status: 400 });
	if (text.length > 500) return new Response(JSON.stringify({ ok: false, error: 'too long' }), { status: 400 });

	await ensureTable();

	const id = crypto.randomUUID();
	await db.execute({
		sql: `INSERT INTO vault_notes (id, tenant_id, body) VALUES (?, ?, ?)`,
		args: [id, tenantId, text],
	});

	const row = await db.execute({
		sql: `SELECT id, body, created_at, resolved_at FROM vault_notes WHERE id = ?`,
		args: [id],
	});
	const r = row.rows[0] as any;

	return new Response(
		JSON.stringify({
			ok: true,
			note: {
				id:         String(r.id),
				body:       String(r.body),
				createdAt:  String(r.created_at),
				resolvedAt: null,
			},
		}),
		{ status: 201, headers: { 'Content-Type': 'application/json' } },
	);
};
