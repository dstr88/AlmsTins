/**
 * POST /api/shares/download/:token   the recipient's download. Counts one download and returns the file.
 *
 * POST, not GET: mail scanners open links before a person does, and a GET would use up the
 * downloads. The landing page at /shares/:token shows the share and holds this button.
 *
 * The token is the only key. An unknown token answers 404 with no detail; a share that has expired,
 * was revoked or used up answers 410. Each attempt is logged against the share.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import {
	ensureShareTables,
	hashToken,
	logShareEvent,
	shareStatus,
	takeDownload,
	type ShareRow,
} from '@/lib/fileShares';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ params }) => {
	const token = String(params.token ?? '');
	if (!token) return json({ error: 'Not found' }, 404, { noStore: true });
	await ensureShareTables();

	const r = await db.execute({
		sql: `SELECT id, tenant_id, label, filename, mime_type, file_size, expires_at, max_downloads, downloads, revoked_at, data
		      FROM file_shares WHERE token_hash = ?`,
		args: [hashToken(token)],
	});
	const row = r.rows[0] as unknown as (ShareRow & { data: string | null }) | undefined;
	if (!row) return json({ error: 'Not found' }, 404, { noStore: true });

	const now = new Date();
	const status = shareStatus(row, now);
	if (status !== 'active') {
		await logShareEvent(row.id, row.tenant_id, `refused:${status}`, now);
		return json({ error: 'This link is no longer available.', status }, 410, { noStore: true });
	}

	// The count is taken only if the share is still usable at the update, so two requests at once
	// cannot both take the last download.
	if (!(await takeDownload(row.id, now))) {
		await logShareEvent(row.id, row.tenant_id, 'refused:race', now);
		return json({ error: 'This link is no longer available.' }, 410, { noStore: true });
	}
	if (!row.data) return json({ error: 'Not found' }, 404, { noStore: true });

	await logShareEvent(row.id, row.tenant_id, 'downloaded', now);
	const bytes = Buffer.from(row.data, 'base64');
	const safeName = row.filename.replace(/[^\w.\- ]+/g, '_');
	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': row.mime_type,
			'Content-Disposition': `attachment; filename="${safeName}"`,
			'Content-Length': String(bytes.length),
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
		},
	});
};
