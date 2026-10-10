import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { fetchAccountData } from '@/lib/scanSync';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isOwner } from '@/lib/owner';
import { runWithDbContext } from '@/lib/dbContext';

export const prerender = false;

type Status = 'ok' | 'fail' | 'warn';

export const GET: APIRoute = async ({ request }) => {
	// Lists which services and settings exist and echoes their errors: the owner's only
	// (any signed-in or demo session used to pass).
	const session = await requireTenantSession(request);
	if (!session || !isOwner(session.tenantId)) return new Response('Not found', { status: 404 });

	const startedAt = Date.now();

	const envVars = {
		ETHERSCAN_API_KEY: Boolean(import.meta.env.ETHERSCAN_API_KEY),
		SNOWTRACE_API_KEY: Boolean(import.meta.env.SNOWTRACE_API_KEY),
		AAVE_V3_SUBGRAPH_API_KEY: Boolean(import.meta.env.AAVE_V3_SUBGRAPH_API_KEY ?? import.meta.env.AAVE_API_KEY),
		// The database is checked by connecting (below), not by a variable being present.
		// Turso (deleted 2026-06-21) and the per-chain Aave subgraph URLs are read nowhere.
	};

	const details: string[] = [];

	// DB check
	let dbStatus: Status = 'ok';
	try {
		await db.execute('SELECT 1');
		details.push('db ok');
	} catch (err) {
		dbStatus = 'fail';
		details.push(`db error: ${err instanceof Error ? err.message : String(err)}`);
	}

	// The second database login, WEB_DATABASE_URL, used by every signed-in page (requests
	// with a tenant context; see dbContext.ts). On 2026-10-10 it still held a deleted
	// credential: public pages kept working while every signed-in dashboard page failed.
	let webDbStatus: Status = 'ok';
	try {
		await runWithDbContext({ tenantId: session.tenantId, userId: null }, () => db.execute('SELECT 1'));
		details.push('signed-in db ok');
	} catch (err) {
		webDbStatus = 'fail';
		details.push(`signed-in db error: ${err instanceof Error ? err.message : String(err)}`);
	}

	// Scanner check (Etherscan V2)
	let scannerStatus: Status = 'ok';
	try {
		const payload = await fetchAccountData('ethereum', {
			module: 'account',
			action: 'balance',
			address: '0x0000000000000000000000000000000000000000',
			tag: 'latest',
		});
		details.push(`scanner eth status=${payload.status ?? 'unknown'} message=${payload.message ?? 'n/a'}`);
		if (payload.status === '0' && payload.message !== 'No transactions found') {
			scannerStatus = 'warn';
		}
	} catch (err) {
		scannerStatus = 'fail';
		details.push(`scanner error: ${err instanceof Error ? err.message : String(err)}`);
	}

	// Env check rollup
	const envStatus: Status = Object.values(envVars).every(Boolean) ? 'ok' : 'warn';
	if (envStatus !== 'ok') {
		details.push('missing env vars for scanner/Aave');
	}

	const summary = {
		ok: dbStatus === 'ok' && webDbStatus === 'ok' && scannerStatus === 'ok' && envStatus === 'ok',
		db: dbStatus,
		webDb: webDbStatus,
		scanners: scannerStatus,
		env: envStatus,
		envVars,
		details,
		elapsedMs: Date.now() - startedAt,
	};

	console.log('[debug/health]', summary);

	return new Response(JSON.stringify(summary), {
		status: summary.ok ? 200 : 500,
		headers: { 'Content-Type': 'application/json' },
	});
};
