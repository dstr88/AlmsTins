import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

const MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const url = new URL(request.url);
	const txHash = url.searchParams.get('txHash');
	const chain = url.searchParams.get('chain');

	if (!txHash || !chain) {
		return new Response(JSON.stringify({ error: 'Missing txHash or chain.' }), { status: 400 });
	}

	const result = await db.execute({
		sql: `SELECT id, filename, mime_type, data, created_at
		      FROM transaction_screenshots
		      WHERE tenant_id = ? AND tx_hash = ? AND chain = ?
		      ORDER BY created_at ASC`,
		args: [tenantId, txHash, chain],
	});

	const screenshots = result.rows.map((row) => ({
		id: row.id,
		filename: row.filename,
		mimeType: row.mime_type,
		dataUrl: `data:${row.mime_type};base64,${row.data}`,
		createdAt: row.created_at,
	}));

	return new Response(JSON.stringify({ screenshots }), { status: 200 });
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const formData = await request.formData();
	const txHash = formData.get('txHash');
	const chain = formData.get('chain');
	const file = formData.get('file');

	if (typeof txHash !== 'string' || typeof chain !== 'string') {
		return new Response(JSON.stringify({ error: 'Missing txHash or chain.' }), { status: 400 });
	}

	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file upload.' }), { status: 400 });
	}

	if (!file.type.startsWith('image/')) {
		return new Response(JSON.stringify({ error: 'Only image files are supported.' }), { status: 400 });
	}

	if (file.size > MAX_SIZE_BYTES) {
		return new Response(JSON.stringify({ error: 'File exceeds 3 MB limit.' }), { status: 400 });
	}

	const buffer = await file.arrayBuffer();
	const base64 = Buffer.from(buffer).toString('base64');
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();

	await db.execute({
		sql: `INSERT INTO transaction_screenshots (id, tenant_id, tx_hash, chain, filename, mime_type, data, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [id, tenantId, txHash, chain, file.name, file.type, base64, createdAt],
	});

	return new Response(
		JSON.stringify({
			id,
			filename: file.name,
			mimeType: file.type,
			dataUrl: `data:${file.type};base64,${base64}`,
			createdAt,
		}),
		{ status: 201 },
	);
};

export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const url = new URL(request.url);
	const id = url.searchParams.get('id');

	if (!id) {
		return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });
	}

	await db.execute({
		sql: `DELETE FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
