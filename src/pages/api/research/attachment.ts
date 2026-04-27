import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
	'image/png', 'image/jpeg', 'image/gif', 'image/webp',
	'application/pdf',
];

export const prerender = false;

// GET ?txId=xxx  — list attachments for a transaction
export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const url  = new URL(request.url);
	const txId = url.searchParams.get('txId');
	if (!txId) {
		return new Response(JSON.stringify({ error: 'Missing txId' }), { status: 400 });
	}

	const result = await db.execute({
		sql: `SELECT id, filename, mime_type, created_at
		      FROM transaction_screenshots
		      WHERE tenant_id = ? AND tx_hash = ? AND chain = 'import'
		      ORDER BY created_at ASC`,
		args: [tenantId, txId],
	});

	return new Response(JSON.stringify({
		attachments: result.rows.map(r => ({
			id:        r.id,
			filename:  r.filename,
			mimeType:  r.mime_type,
			createdAt: r.created_at,
		})),
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// POST (multipart) — upload a file for a transaction
export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const formData = await request.formData();
	const txId = formData.get('txId');
	const file = formData.get('file');

	if (typeof txId !== 'string' || !txId) {
		return new Response(JSON.stringify({ error: 'Missing txId' }), { status: 400 });
	}
	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file' }), { status: 400 });
	}
	if (!ALLOWED_TYPES.includes(file.type)) {
		return new Response(JSON.stringify({ error: 'Unsupported file type. Use PNG, JPG, GIF, WEBP, or PDF.' }), { status: 400 });
	}
	if (file.size > MAX_SIZE_BYTES) {
		return new Response(JSON.stringify({ error: 'File exceeds 5 MB limit.' }), { status: 400 });
	}

	const buffer  = await file.arrayBuffer();
	const base64  = Buffer.from(buffer).toString('base64');
	const id      = crypto.randomUUID();
	const created = new Date().toISOString();

	await db.execute({
		sql: `INSERT INTO transaction_screenshots
		        (id, tenant_id, tx_hash, chain, filename, mime_type, data, created_at)
		      VALUES (?, ?, ?, 'import', ?, ?, ?, ?)`,
		args: [id, tenantId, txId, file.name, file.type, base64, created],
	});

	return new Response(JSON.stringify({ ok: true, id, filename: file.name, createdAt: created }), {
		status: 201,
		headers: { 'Content-Type': 'application/json' },
	});
};

// DELETE ?id=xxx  — remove an attachment
export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const url = new URL(request.url);
	const id  = url.searchParams.get('id');
	if (!id) {
		return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });
	}

	await db.execute({
		sql: `DELETE FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
