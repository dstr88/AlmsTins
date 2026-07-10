import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { getAuthSession } from '@/lib/authSession';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request }) => {
	// Dev-only test utility — must never be reachable in production. It writes a
	// fake wallet + snapshot, and being a GET it bypasses the demo mutation filter,
	// so a prefetch/CSRF could pollute a tenant's data.
	if (process.env.NODE_ENV === 'production') {
		return new Response('Not found', { status: 404 });
	}
	try {
		const tenant = await requireTenantSession(request);
		if (!tenant) return new Response('Unauthorized', { status: 401 });
		const session = await getAuthSession(request);
		const userId = session?.user?.id ? String(session.user.id) : '';
		if (!tenant || !userId) {
			return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const { tenantId } = tenant;
		const testWalletId = 'dev-test-wallet-1';

		await db.execute(
			`
      INSERT INTO wallets (
        id,
        tenant_id,
        user_id,
        address,
        label,
        chains,
        is_default
      )
      VALUES (?, ?, ?, ?, ?, ?, 1)
      
ON CONFLICT DO NOTHING`,
			[
				testWalletId,
				tenantId,
				userId,
				'0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEF',
				'Dev Test Wallet',
				'eth',
			],
		);

		await db.execute(
			`
      INSERT INTO wallet_snapshots (
        tenant_id,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
			[
				tenantId,
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
