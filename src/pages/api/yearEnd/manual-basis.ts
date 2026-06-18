/**
 * /api/yearEnd/manual-basis
 *
 * GET    →  list all saved entries for the authenticated tenant
 * POST   →  upsert a manual cost basis entry (idempotent)
 * DELETE →  remove a single entry by sellSourceId
 *
 * Manual cost basis entries persist the user-supplied average price per token
 * for disposal rows that have no matching buy lots in their FIFO history.
 * They are loaded on page mount and applied automatically so P/L survives
 * page refreshes and session changes.
 */

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { randomUUID } from 'crypto';

export const prerender = false;

// ── GET ──────────────────────────────────────────────────────────────────────
// Returns all saved manual basis entries for the tenant.
//
// Response:
// {
//   ok: true,
//   entries: Array<{
//     sellSourceId: string;
//     quantity:      number;
//     pricePerToken: number;
//     buyDateIso:    string | null;
//   }>
// }

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	try {
		await ensureTable();

		const res = await db.execute({
			sql: `SELECT sell_source_id, quantity, price_per_token, buy_date_iso
			      FROM manual_cost_basis
			      WHERE tenant_id = ?
			      ORDER BY updated_at DESC`,
			args: [tenantId],
		});

		const entries = res.rows.map((r) => ({
			sellSourceId:  String(r.sell_source_id ?? ''),
			quantity:      Number(r.quantity      ?? 0),
			pricePerToken: Number(r.price_per_token ?? 0),
			buyDateIso:    r.buy_date_iso ? String(r.buy_date_iso) : null,
		}));

		return respond({ ok: true, entries });
	} catch (error) {
		console.error('[tax/manual-basis GET] failed:', error);
		return respond({ ok: false, error: 'Failed to load manual basis entries.' }, 500);
	}
};

// ── POST ─────────────────────────────────────────────────────────────────────
// Upserts a manual cost basis entry.
//
// Body: { sellSourceId, quantity, pricePerToken, buyDateIso? }

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return respond({ ok: false, error: 'Invalid JSON body.' }, 400);
	}

	if (!body || typeof body !== 'object') {
		return respond({ ok: false, error: 'Body must be a JSON object.' }, 400);
	}

	const { sellSourceId, quantity, pricePerToken, buyDateIso } = body as Record<string, unknown>;

	if (typeof sellSourceId !== 'string' || !sellSourceId.trim()) {
		return respond({ ok: false, error: 'sellSourceId is required.' }, 400);
	}
	if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
		return respond({ ok: false, error: 'quantity must be a positive number.' }, 400);
	}
	if (typeof pricePerToken !== 'number' || !Number.isFinite(pricePerToken) || pricePerToken <= 0) {
		return respond({ ok: false, error: 'pricePerToken must be a positive number.' }, 400);
	}

	const buyDate: string | null = (() => {
		if (buyDateIso === undefined || buyDateIso === null || buyDateIso === '') return null;
		if (typeof buyDateIso !== 'string') return null;
		const d = new Date(buyDateIso);
		return Number.isNaN(d.getTime()) ? null : buyDateIso.trim();
	})();

	try {
		await ensureTable();

		await db.execute({
			sql: `INSERT INTO manual_cost_basis
			        (id, tenant_id, sell_source_id, quantity, price_per_token, buy_date_iso, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
			      ON CONFLICT (tenant_id, sell_source_id) DO UPDATE SET
			        quantity        = excluded.quantity,
			        price_per_token = excluded.price_per_token,
			        buy_date_iso    = excluded.buy_date_iso,
			        updated_at      = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
			args: [
				randomUUID(),
				tenantId,
				sellSourceId.trim(),
				quantity,
				pricePerToken,
				buyDate,
			],
		});

		return respond({ ok: true });
	} catch (error) {
		console.error('[tax/manual-basis POST] failed:', error);
		return respond({ ok: false, error: 'Failed to save cost basis.' }, 500);
	}
};

// ── DELETE ───────────────────────────────────────────────────────────────────
// Removes a single saved manual cost basis entry.
//
// Body: { sellSourceId: string }

export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return respond({ ok: false, error: 'Invalid JSON body.' }, 400);
	}

	const { sellSourceId } = (body ?? {}) as Record<string, unknown>;
	if (typeof sellSourceId !== 'string' || !sellSourceId.trim()) {
		return respond({ ok: false, error: 'sellSourceId is required.' }, 400);
	}

	try {
		await ensureTable();

		await db.execute({
			sql: `DELETE FROM manual_cost_basis WHERE tenant_id = ? AND sell_source_id = ?`,
			args: [tenantId, sellSourceId.trim()],
		});

		return respond({ ok: true });
	} catch (error) {
		console.error('[tax/manual-basis DELETE] failed:', error);
		return respond({ ok: false, error: 'Failed to remove cost basis entry.' }, 500);
	}
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Idempotent DDL — safe to call before every operation. */
async function ensureTable() {
	await db.execute({
		sql: `CREATE TABLE IF NOT EXISTS manual_cost_basis (
			id              TEXT NOT NULL,
			tenant_id       TEXT NOT NULL,
			sell_source_id  TEXT NOT NULL,
			quantity        REAL NOT NULL,
			price_per_token REAL NOT NULL,
			buy_date_iso    TEXT,
			created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
			updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
			PRIMARY KEY (id),
			UNIQUE (tenant_id, sell_source_id)
		)`,
		args: [],
	});
}

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
