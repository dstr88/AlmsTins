import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { normalizeChains, sanitizeAddress, transformWalletRow } from '../../lib/wallets-service';
import { deriveDefaultLabel } from '../../lib/wallets';
import { requireTenantSession } from '../../lib/requireTenantSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains, is_default, created_at FROM wallets WHERE tenant_id = ? ORDER BY created_at DESC',
			args: [tenantId],
		});
		const wallets = result.rows.map(transformWalletRow);
		return new Response(JSON.stringify(wallets), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to load wallets', error);
		return new Response(JSON.stringify({ error: true, message: 'Unable to fetch wallets' }), { status: 500 });
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const { userId, tenantId } = await requireTenantSession(request);
		const body = await request.json();
		const address = sanitizeAddress(body.address);
		if (!address) {
			return responseWithError('A valid 42-character 0x address is required.', 400);
		}
		const label =
			typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : deriveDefaultLabel(address);
		const chains = normalizeChains(body.chains ?? ['ethereum', 'polygon', 'avalanche']);
		const isDefault = body.isDefault === true ? 1 : 0;

		const inserted = await db.execute({
			sql: `INSERT INTO wallets (tenant_id, user_id, address, label, chains, is_default)
			      VALUES (?, ?, ?, ?, ?, ?)
			      RETURNING id, address, label, chains, is_default, created_at`,
			args: [tenantId, userId, address, label, JSON.stringify(chains), isDefault],
		});

		const wallet = transformWalletRow(inserted.rows[0]);
		return new Response(JSON.stringify(wallet), {
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to create wallet', error);
		return responseWithError('Unable to save wallet. Please try again.', 500);
	}
};

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
