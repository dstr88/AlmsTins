import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { normalizeChains, sanitizeAddress, transformWalletRow } from '../../../lib/wallets-service';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains, is_default, created_at FROM wallets WHERE id = ? LIMIT 1',
			args: [params.id],
		});
		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}
		return new Response(JSON.stringify(transformWalletRow(result.rows[0])), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to fetch wallet', error);
		return responseWithError('Unable to load wallet.', 500);
	}
};

export const PATCH: APIRoute = async ({ params, request }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const body = await request.json();

		// Fast path: rename only
		if ('label' in body && !('address' in body) && !('chains' in body) && !('isDefault' in body)) {
			const nextLabel = typeof body.label === 'string' && body.label.trim().length ? body.label.trim() : '';
			if (!nextLabel) {
				return new Response(JSON.stringify({ ok: false, error: 'EMPTY_LABEL' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const result = await db.execute({
				sql: 'UPDATE wallets SET label = ? WHERE id = ? RETURNING id, address, label, chains, is_default, created_at',
				args: [nextLabel, params.id],
			});

			if (!result.rows.length) {
				return responseWithError('Wallet not found.', 404);
			}

			return new Response(JSON.stringify({ ok: true, id: params.id, label: nextLabel }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const updates: string[] = [];
		const args: any[] = [];

		if ('address' in body) {
			const nextAddress = sanitizeAddress(body.address);
			if (!nextAddress) {
				return responseWithError('Address must be a valid 0x string.', 400);
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
			const chains = normalizeChains(body.chains);
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

		args.push(params.id);

		const result = await db.execute({
			sql: `UPDATE wallets SET ${updates.join(', ')} WHERE id = ? RETURNING id, address, label, chains, is_default, created_at`,
			args,
		});

		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}

		return new Response(JSON.stringify(transformWalletRow(result.rows[0])), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to update wallet', error);
		return responseWithError('Unable to update wallet.', 500);
	}
};

export const DELETE: APIRoute = async ({ params }) => {
	if (!params.id) {
		return responseWithError('Wallet id is required.', 400);
	}

	try {
		const result = await db.execute({
			sql: 'DELETE FROM wallets WHERE id = ? RETURNING id',
			args: [params.id],
		});
		if (!result.rows.length) {
			return responseWithError('Wallet not found.', 404);
		}
		return new Response(null, { status: 204 });
	} catch (error) {
		console.error('Failed to delete wallet', error);
		return responseWithError('Unable to delete wallet.', 500);
	}
};

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
