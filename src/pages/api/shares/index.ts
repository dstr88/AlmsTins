/**
 * GET  /api/shares   the owner's shares (no file data, no link)
 * POST /api/shares   multipart: file, label, and optional to (an address to email the link to)
 *
 * The link is returned once, here, and never again: only its hash is stored. Paid plans only, the
 * same rule as the history download (src/lib/historyAccess.ts). Demo sessions get a 403.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { canDownloadHistoryByWallet } from '@/lib/historyAccess';
import { sendMail } from '@/lib/email';
import { json } from '@/lib/http';
import {
	DEFAULT_EXPIRY_DAYS,
	DEFAULT_MAX_DOWNLOADS,
	MAX_ACTIVE_SHARES,
	countActiveShares,
	ensureShareTables,
	expiryFrom,
	hashToken,
	logShareEvent,
	newShareId,
	newToken,
	shareLink,
	shareStatus,
	uploadRefusal,
	type ShareRow,
} from '@/lib/fileShares';
import { db } from '@/lib/db';

export const prerender = false;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401, { noStore: true });
	if (session.isDemo) return json({ error: 'Not available in the demo.' }, 403, { noStore: true });
	await ensureShareTables();

	const r = await db.execute({
		sql: `SELECT id, tenant_id, label, filename, mime_type, file_size, expires_at, max_downloads, downloads, revoked_at, created_at
		      FROM file_shares WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`,
		args: [session.tenantId],
	});
	const now = new Date();
	const shares = r.rows.map((row) => {
		const s = row as unknown as ShareRow;
		return {
			id: s.id,
			label: s.label,
			filename: s.filename,
			fileSize: s.file_size,
			expiresAt: s.expires_at,
			maxDownloads: s.max_downloads,
			downloads: s.downloads,
			createdAt: s.created_at,
			status: shareStatus(s, now),
		};
	});
	return json({ ok: true, shares }, 200, { noStore: true });
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401, { noStore: true });
	if (session.isDemo) return json({ error: 'Not available in the demo.' }, 403, { noStore: true });

	const plan = await getActivePlan(session.tenantId);
	if (!canDownloadHistoryByWallet(plan.id, session.tenantId)) {
		return json({ error: 'Sharing files is included in every paid plan.', planRequired: 'paid' }, 403, { noStore: true });
	}

	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File) || file.size === 0) return json({ error: 'Choose a file to share.' }, 400, { noStore: true });
	const label = String(form?.get('label') ?? '').trim().slice(0, 120) || file.name;
	const to = String(form?.get('to') ?? '').trim();
	if (to && !EMAIL_PATTERN.test(to)) return json({ error: 'That email address does not look right.' }, 400, { noStore: true });

	const refusal = uploadRefusal({ filename: file.name, mimeType: file.type, size: file.size });
	if (refusal) return json({ error: refusal }, 400, { noStore: true });

	await ensureShareTables();
	const now = new Date();
	if ((await countActiveShares(session.tenantId, now)) >= MAX_ACTIVE_SHARES) {
		return json({ error: `You can have ${MAX_ACTIVE_SHARES} active shares. Revoke one first.` }, 409, { noStore: true });
	}

	const id = newShareId();
	const token = newToken();
	const expiresAt = expiryFrom(now);
	const data = Buffer.from(await file.arrayBuffer()).toString('base64');
	await db.execute({
		sql: `INSERT INTO file_shares
		        (id, tenant_id, label, filename, mime_type, file_size, data, token_hash, expires_at, max_downloads, downloads)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
		args: [id, session.tenantId, label, file.name, file.type, file.size, data, hashToken(token), expiresAt, DEFAULT_MAX_DOWNLOADS],
	});
	await logShareEvent(id, session.tenantId, 'created', now);

	const link = shareLink(new URL(request.url).origin, token);
	if (to) {
		// The email carries the link and nothing else: no file, and no name of the owner.
		await sendMail({
			to,
			subject: 'A file was shared with you',
			text: [
				`${label} is ready to download.`,
				'',
				'The file is not attached to this email. Open the link to download it:',
				link,
				'',
				`The link works until ${expiresAt.slice(0, 10)} and for up to ${DEFAULT_MAX_DOWNLOADS} downloads.`,
				`If you were not expecting this, you can ignore this email. The link stops working after ${DEFAULT_EXPIRY_DAYS} days.`,
			].join('\n'),
		});
	}

	return json(
		{ ok: true, id, link, expiresAt, maxDownloads: DEFAULT_MAX_DOWNLOADS, emailed: Boolean(to) },
		200,
		{ noStore: true },
	);
};
