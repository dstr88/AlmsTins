import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const GET: APIRoute = async () => {
	try {
		const walletTableInfo = await db.execute(/* sql */ `PRAGMA table_info(wallets);`);
		const snapshotTableInfo = await db.execute(/* sql */ `PRAGMA table_info(wallet_snapshots);`);

		const wallets = await db.execute(
			/* sql */ `SELECT id, address, label, chains, created_at FROM wallets ORDER BY created_at ASC LIMIT 20;`,
		);
		const snapshots = await db.execute(
			/* sql */ `SELECT wallet_id, chain, totals_usd, collateral_usd, debt_usd, captured_at FROM wallet_snapshots ORDER BY captured_at DESC LIMIT 20;`,
		);

		return new Response(
			JSON.stringify(
				{
					ok: true,
					wallet_table: walletTableInfo,
					snapshot_table: snapshotTableInfo,
					wallets,
					snapshots,
				},
				null,
				2,
			),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: unknown) {
		console.error('GET /api/debug-snapshots error', err);
		const message = err instanceof Error ? err.message : 'debug failed';
		return new Response(
			JSON.stringify({ ok: false, error: message }),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
