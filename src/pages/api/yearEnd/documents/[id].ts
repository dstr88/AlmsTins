/**
 * GET    /api/yearEnd/documents/:id   — download the file
 * DELETE /api/yearEnd/documents/:id   — delete the document
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ params, request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const id = params.id ?? '';

	const t = getYearEndErrors(getLang(request));

	const result = await db.execute({
		sql: `SELECT filename, mime_type, file_data FROM tax_documents WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	if (!result.rows.length) return json({ error: t.notFound }, 404);

	const row      = result.rows[0];
	const filename = String(row.filename);
	const mimeType = String(row.mime_type ?? 'application/octet-stream');
	const b64      = String(row.file_data);

	// Decode base64 → binary
	const binary = atob(b64);
	const bytes  = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': mimeType,
			'Content-Disposition': `inline; filename="${filename}"`,
			'Cache-Control': 'private, max-age=3600',
		},
	});
};

export const DELETE: APIRoute = async ({ params, request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const id = params.id ?? '';

	const t = getYearEndErrors(getLang(request));

	const check = await db.execute({
		sql: `SELECT id FROM tax_documents WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});
	if (!check.rows.length) return json({ error: t.notFound }, 404);

	await db.execute({
		sql: `DELETE FROM tax_documents WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return json({ ok: true });
};
