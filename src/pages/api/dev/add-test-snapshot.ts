import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

export const GET: APIRoute = async () => {
	try {
		const testWalletId = 'dev-test-wallet-1';

		await db.execute(
			`
      INSERT OR IGNORE INTO wallets (
        id,
        user_id,
        address,
        label,
        chains,
        is_default
      )
      VALUES (?, NULL, ?, ?, ?, 1)
      `,
			[testWalletId, '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEF', 'Dev Test Wallet', 'eth'],
		);

		await db.execute(
			`
      INSERT INTO wallet_snapshots (
        wallet_id,
        chain,
        totals_usd,
        collateral_usd,
        debt_usd,
        collateral_apy_pct,
        borrow_apy_pct,
        net_rate_pct,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
			[
				testWalletId,
				'eth',
				1234.56,
				200,
				50,
				4.5,
				2.1,
				2.4,
				JSON.stringify({ note: 'dev test snapshot' }),
			],
		);

		return new Response(
			JSON.stringify({
				ok: true,
				walletId: testWalletId,
				message: 'Inserted dev wallet + snapshot',
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: unknown) {
		console.error('add-test-snapshot error', err);
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({
				ok: false,
				error: message,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
