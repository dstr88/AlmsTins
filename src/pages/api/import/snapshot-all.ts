import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { snapshotCexAccount } from '@/lib/cexSnapshot';

// Display names for known sources
const SOURCE_DISPLAY: Record<string, string> = {
	coinbase:   'Coinbase',
	kraken:     'Kraken',
	gemini:     'Gemini',
	crypto_com: 'Crypto.com',
	exodus:     'Exodus',
	cashapp:    'Cash App',
	venmo:      'Venmo',
	robinhood:  'Robinhood',
};

/**
 * POST /api/import/snapshot-all
 *
 * Backfills wallet_snapshots for every exchange_account that belongs to the
 * current tenant. Safe to call multiple times — each run writes a fresh
 * snapshot row and the getLatestNetWorthSummary query always picks the newest.
 *
 * Returns the list of accounts processed and any per-account errors.
 */
export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) {
		return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401 });
	}
	const { tenantId } = session;

	const result = await db.execute({
		sql: `SELECT id, source, name FROM exchange_accounts WHERE tenant_id = ? ORDER BY created_at ASC`,
		args: [tenantId],
	});

	const accounts = (result.rows ?? []).map((row: any) => ({
		id: String(row.id ?? ''),
		source: String(row.source ?? ''),
		name: String(row.name ?? ''),
	})).filter((a) => a.id && a.source);

	if (!accounts.length) {
		return new Response(
			JSON.stringify({ ok: true, processed: 0, results: [] }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const results: Array<{ accountId: string; source: string; ok: boolean; error?: string }> = [];

	for (const account of accounts) {
		const displayName =
			SOURCE_DISPLAY[account.source] ??
			account.name ??
			account.source;

		try {
			await snapshotCexAccount(tenantId, account.id, account.source, displayName);
			results.push({ accountId: account.id, source: account.source, ok: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[snapshot-all] account failed', { accountId: account.id, source: account.source, err });
			results.push({ accountId: account.id, source: account.source, ok: false, error: message });
		}
	}

	const failed = results.filter((r) => !r.ok).length;

	return new Response(
		JSON.stringify({
			ok: failed === 0,
			processed: results.length,
			failed,
			results,
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
