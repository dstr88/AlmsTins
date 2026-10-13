import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const { id } = params;
	if (!id) return new Response('Not Found', { status: 404 });

	let body: { resolved?: boolean };
	try {
		body = await request.json();
	} catch {
		return new Response('Bad Request', { status: 400 });
	}

	await db.execute({
		sql: `UPDATE vault_notes
		      SET resolved_at = ${body.resolved ? "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')" : 'NULL'}
		      WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};

export const DELETE: APIRoute = async ({ request, params }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const { id } = params;
	if (!id) return new Response('Not Found', { status: 404 });

	await db.execute({
		sql: `DELETE FROM vault_notes WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
