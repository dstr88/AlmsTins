/**
 * GET  /api/yearEnd/documents?year=2025   — list documents for tenant + year
 * POST /api/yearEnd/documents             — upload a tax document (PDF or image)
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const url = new URL(request.url);
	const year = parseInt(url.searchParams.get('year') ?? '', 10);

	if (!Number.isFinite(year)) return json({ ok: false, error: 'Missing year' }, 400);

	const result = await db.execute({
		sql: `SELECT id, doc_type, tax_year, filename, file_size, mime_type, created_at
		      FROM tax_documents
		      WHERE tenant_id = ? AND tax_year = ?
		      ORDER BY created_at ASC`,
		args: [tenantId, year],
	});

	const docs = result.rows.map(r => ({
		id:        String(r.id),
		docType:   String(r.doc_type),
		taxYear:   Number(r.tax_year),
		filename:  String(r.filename),
		fileSize:  r.file_size != null ? Number(r.file_size) : null,
		mimeType:  r.mime_type != null ? String(r.mime_type) : null,
		createdAt: String(r.created_at),
	}));

	return json({ ok: true, docs });
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const t = getYearEndErrors(getLang(request));

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ ok: false, error: 'Invalid form data' }, 400);
	}

	const file    = formData.get('file') as File | null;
	const docType = String(formData.get('docType') ?? '').trim().toLowerCase();
	const taxYear = parseInt(String(formData.get('taxYear') ?? ''), 10);

	const validTypes = ['w2', '1099-int', '1099-div', '1099-r', '1099-misc', 'ssa-1099'];
	if (!validTypes.includes(docType)) return json({ ok: false, error: t.invalidDocumentType }, 400);
	if (!Number.isFinite(taxYear) || taxYear < 2015 || taxYear > 2030) return json({ ok: false, error: t.invalidTaxYear }, 400);
	if (!file || file.size === 0) return json({ ok: false, error: t.noFileProvided }, 400);
	if (file.size > MAX_SIZE) return json({ ok: false, error: t.fileTooLarge5mb }, 400);

	const bytes = new Uint8Array(await file.arrayBuffer());
	// Convert to base64 in chunks to avoid stack overflow on large files
	let binary = '';
	for (let i = 0; i < bytes.length; i += 8192) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	}
	const fileData = btoa(binary);

	const id = randomUUID();
	await db.execute({
		sql: `INSERT INTO tax_documents (id, tenant_id, doc_type, tax_year, filename, file_size, mime_type, file_data)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [id, tenantId, docType, taxYear, file.name, file.size, file.type || 'application/octet-stream', fileData],
	});

	return json({
		ok: true,
		doc: { id, docType, taxYear, filename: file.name, fileSize: file.size, mimeType: file.type },
	});
};
