import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { parseWalletChains, sanitizeAddress, transformWalletRow } from '../../../lib/wallets-service';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import {
	OWNER_LABEL_MAX,
	ownerLabelDemoBlocked,
	ownerLabelDemoResponse,
	ownerLabelWriteAllowed,
	parseOwnerLabel,
	removeWalletIdentity,
	writeWalletOwnerLabel,
} from '@/lib/walletOwnerLabel';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(params.id, tenantId);
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains, is_default, created_at FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [params.id, tenantId],
		});
		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}
		return new Response(JSON.stringify(transformWalletRow(result.rows[0])), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Failed to fetch wallet', error);
		return responseWithError('Unable to load wallet.', 500);
	}
};

export const PATCH: APIRoute = async ({ params, request }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(params.id, tenantId);
		const raw = await request.json().catch(() => null);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return responseWithError('Invalid JSON body.', 400);
		}
		const body = raw as Record<string, any>;

		// "Whose account is this?": optional, free text, empty clears it. Validated before
		// anything is written; saved on every key of the wallet (src/lib/walletOwnerLabel.ts).
		const hasOwner = 'ownerLabel' in body;
		let ownerLabel: string | null = null;
		if (hasOwner) {
			if (ownerLabelDemoBlocked(tenantId)) return ownerLabelDemoResponse();
			const parsed = parseOwnerLabel(body.ownerLabel);
			if (!parsed.ok) return json({ ok: false, error: parsed.error, max: OWNER_LABEL_MAX }, 400);
			if (!ownerLabelWriteAllowed(tenantId)) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
			ownerLabel = parsed.value;
		}
		const saveOwner = async (row: Record<string, unknown>) => {
			if (!hasOwner) return;
			await writeWalletOwnerLabel(
				tenantId,
				{ id: String(row.id ?? params.id), address: String(row.address ?? ''), chains: row.chains },
				ownerLabel,
			);
		};
		const otherFields = 'address' in body || 'chains' in body || 'isDefault' in body;

		// Owner only
		if (hasOwner && !('label' in body) && !otherFields) {
			const found = await db.execute({
				sql: 'SELECT id, address, chains FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
				args: [params.id, tenantId],
			});
			if (!found.rows.length) {
				return responseWithError('Wallet not found.', 404);
			}
			await saveOwner(found.rows[0] as Record<string, unknown>);
			return json({ ok: true, id: params.id, ownerLabel });
		}

		// Fast path: rename only (and the owner, when given)
		if ('label' in body && !otherFields) {
			const nextLabel = typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : '';
			if (!nextLabel) {
				return new Response(JSON.stringify({ ok: false, error: 'EMPTY_LABEL' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const result = await db.execute({
				sql: 'UPDATE wallets SET label = ? WHERE id = ? AND tenant_id = ? RETURNING id, address, label, chains, is_default, created_at',
				args: [nextLabel, params.id, tenantId],
			});

			if (!result.rows.length) {
				return responseWithError('Wallet not found.', 404);
			}
			await saveOwner(result.rows[0] as Record<string, unknown>);

			return json({ ok: true, id: params.id, label: nextLabel, ...(hasOwner ? { ownerLabel } : {}) });
		}

		const updates: string[] = [];
		const args: any[] = [];

		if ('address' in body) {
			const nextAddress = sanitizeAddress(body.address);
			if (!nextAddress) {
				return responseWithError('Address must be a valid wallet address (0x… for EVM/Sui, bc1q… / bc1p… / 1… / 3… for Bitcoin).', 400);
			}
			updates.push('address = ?');
			args.push(nextAddress);
		}

		if ('label' in body) {
			const nextLabel = typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : null;
			updates.push('label = ?');
			args.push(nextLabel);
		}

		if ('chains' in body) {
			const chains = parseWalletChains(body.chains);
			updates.push('chains = ?');
			args.push(JSON.stringify(chains));
		}

		if ('isDefault' in body) {
			updates.push('is_default = ?');
			args.push(body.isDefault === true ? 1 : 0);
		}

		if (!updates.length) {
			return responseWithError('Provide at least one field to update.', 400);
		}

		args.push(params.id, tenantId);

		const result = await db.execute({
			sql: `UPDATE wallets SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? RETURNING id, address, label, chains, is_default, created_at`,
			args,
		});

		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}
		await saveOwner(result.rows[0] as Record<string, unknown>);

		return json({ ...transformWalletRow(result.rows[0]), ...(hasOwner ? { ownerLabel } : {}) });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Failed to update wallet', error);
		return responseWithError('Unable to update wallet.', 500);
	}
};

export const DELETE: APIRoute = async ({ params, request }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(params.id, tenantId);

		// Cascade-delete linked transactions before removing the wallet record
		await db.batch([
			{
				sql: 'DELETE FROM import_transactions WHERE wallet_id = ? AND tenant_id = ?',
				args: [params.id, tenantId],
			},
			{
				sql: 'DELETE FROM transactions WHERE wallet_id = ? AND tenant_id = ?',
				args: [params.id, tenantId],
			},
		], 'write');

		const result = await db.execute({
			sql: 'DELETE FROM wallets WHERE id = ? AND tenant_id = ? RETURNING id, address',
			args: [params.id, tenantId],
		});
		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}
		// Its owner label goes with it (this tenant's keys for that address only). The wallet is
		// already deleted, so a failure here is logged, not returned.
		try {
			await removeWalletIdentity(tenantId, String((result.rows[0] as Record<string, unknown>).address ?? ''));
		} catch (err) {
			console.error('Failed to remove wallet identity', err instanceof Error ? err.message : String(err));
		}
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Failed to delete wallet', error);
		return responseWithError('Unable to delete wallet.', 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
