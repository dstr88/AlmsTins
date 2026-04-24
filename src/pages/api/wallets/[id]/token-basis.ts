/**
 * POST /api/wallets/[id]/token-basis
 *
 * Saves a manually-entered purchase date and/or cost basis (price per coin)
 * for a single token in a wallet.  Works for both demo and personal accounts.
 *
 * The record is inserted into import_transactions with source='manual' so the
 * existing getWalletTokenBreakdown enrichment query picks it up automatically —
 * no extra code path needed.
 *
 * Body: { symbol: string, purchaseDate?: string, pricePerCoin?: number }
 *
 * Allowed for demo users (see DEMO_ALLOWED_MUTATION_PATTERNS in middleware).
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { db } from '@/lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	if (!walletId) {
		return respond({ error: true, message: 'Wallet id is required.' }, 400);
	}

	let body: { symbol?: string; purchaseDate?: string; pricePerCoin?: number };
	try {
		body = await request.json();
	} catch {
		return respond({ error: true, message: 'Invalid JSON body.' }, 400);
	}

	const symbol = String(body.symbol ?? '').trim().toUpperCase();
	if (!symbol) {
		return respond({ error: true, message: 'symbol is required.' }, 400);
	}

	const purchaseDate = body.purchaseDate ? String(body.purchaseDate).trim() : null;
	const pricePerCoin = typeof body.pricePerCoin === 'number' && body.pricePerCoin > 0
		? body.pricePerCoin
		: null;

	if (!purchaseDate && pricePerCoin === null) {
		return respond({ error: true, message: 'At least one of purchaseDate or pricePerCoin is required.' }, 400);
	}

	// Validate date format
	if (purchaseDate) {
		const stamp = Date.parse(purchaseDate);
		if (!Number.isFinite(stamp) || stamp > Date.now()) {
			return respond({ error: true, message: 'purchaseDate must be a valid past date.' }, 400);
		}
	}

	const session = await requireTenantSession(request);
	if (!session) return respond({ error: true, message: 'Unauthorized.' }, 401);
	const { tenantId } = session;
	await requireWalletOwnedByTenant(walletId, tenantId);

	// Use purchaseDate if provided, otherwise today (for price-only entries)
	const timestampUtc = purchaseDate
		? new Date(purchaseDate).toISOString()
		: new Date().toISOString();

	// Unique id: tenant + wallet + symbol + date so re-submitting the same
	// values is idempotent (upserts without duplicating).
	const id = `manual::${tenantId}::${walletId}::${symbol}::${timestampUtc.slice(0, 10)}`;
	const rowHash = id; // same uniqueness scope

	await db.execute({
		sql: `INSERT INTO import_transactions
		        (id, source, import_batch_id, timestamp_utc, direction, asset_symbol,
		         currency, amount, native_usd, kind, row_hash, tenant_id)
		      VALUES (?, 'manual', ?, ?, 'in', ?, ?, 1, ?, 'purchase', ?, ?)
		      ON CONFLICT(id) DO UPDATE SET
		        timestamp_utc = excluded.timestamp_utc,
		        native_usd    = excluded.native_usd`,
		args: [
			id,
			`manual-${walletId}`,
			timestampUtc,
			symbol,
			symbol,           // currency = symbol
			pricePerCoin,     // native_usd = price per coin (amount=1 → avg = pricePerCoin)
			rowHash,
			tenantId,
		],
	});

	return respond({ ok: true, symbol, purchaseDate: timestampUtc, pricePerCoin }, 200);
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
