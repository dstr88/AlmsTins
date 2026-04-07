import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { normalizeChains, sanitizeAddress, transformWalletRow } from '../../lib/wallets-service';
import { deriveDefaultLabel } from '../../lib/wallets';
import { requireTenantSession } from '../../lib/requireTenantSession';
import { checkWalletLimit } from '../../lib/subscriptions';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains, is_default, wallet_type, created_at FROM wallets WHERE tenant_id = ? ORDER BY created_at DESC',
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
		const { tenantId } = await requireTenantSession(request);

		// ── Plan limit check ──────────────────────────────────────────────
		const limitCheck = await checkWalletLimit(tenantId);
		if (!limitCheck.allowed) {
			return new Response(
				JSON.stringify({
					error: true,
					code: 'PLAN_LIMIT_REACHED',
					message: limitCheck.message,
					current: limitCheck.current,
					limit: limitCheck.limit,
					plan: limitCheck.plan.id,
				}),
				{ status: 402, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const body = await request.json();
		const walletType: 'onchain' | 'custom' =
			body.walletType === 'custom' ? 'custom' : 'onchain';

		if (walletType === 'custom') {
			const label = typeof body.label === 'string' ? body.label.trim() : '';
			if (!label) {
				return responseWithError('A label is required for custom wallets.', 400);
			}
			// Address is optional for custom wallets — generate a stable placeholder if omitted.
			const rawAddress = typeof body.address === 'string' ? body.address.trim() : '';
			const address = sanitizeAddress(rawAddress) || `custom_${crypto.randomUUID().replace(/-/g, '')}`;
			const chains = normalizeChains(body.chains ?? []);

			const inserted = await db.execute({
				sql: `INSERT INTO wallets (tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, 0, 'custom')
				      RETURNING id, address, label, chains, is_default, created_at, wallet_type`,
				args: [tenantId, address, label, JSON.stringify(chains)],
			});

			const wallet = transformWalletRow(inserted.rows[0]);
			return new Response(JSON.stringify(wallet), {
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Standard on-chain wallet (EVM, Sui, or Bitcoin — address validation handles all)
		const address = sanitizeAddress(body.address);
		if (!address) {
			return responseWithError('A valid wallet address is required (0x… for EVM/Sui, bc1q… / bc1p… / 1… / 3… for Bitcoin, ltc1q… for Litecoin).', 400);
		}
		const label =
			typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : deriveDefaultLabel(address);
		const chains = normalizeChains(body.chains ?? ['ethereum', 'polygon', 'avalanche']);
		const isDefault = body.isDefault === true ? 1 : 0;

		const inserted = await db.execute({
			sql: `INSERT INTO wallets (tenant_id, address, label, chains, is_default, wallet_type)
			      VALUES (?, ?, ?, ?, ?, 'onchain')
			      RETURNING id, address, label, chains, is_default, created_at, wallet_type`,
			args: [tenantId, address, label, JSON.stringify(chains), isDefault],
		});

		const wallet = transformWalletRow(inserted.rows[0]);
		return new Response(JSON.stringify(wallet), {
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to create wallet', error);
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes('UNIQUE') || msg.includes('unique')) {
			return responseWithError('That address is already being tracked. Edit the existing wallet instead.', 409);
		}
		return responseWithError('Unable to save wallet. Please try again.', 500);
	}
};

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
