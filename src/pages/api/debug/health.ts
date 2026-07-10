import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { fetchAccountData } from '@/lib/scanSync';
import { requireAdminSession } from '@/lib/adminGuard';

export const prerender = false;

type Status = 'ok' | 'fail' | 'warn';

export const GET: APIRoute = async ({ request }) => {
	try { await requireAdminSession(request); }
	catch (e) { return e instanceof Response ? e : new Response('Unauthorized', { status: 401 }); }

	const startedAt = Date.now();

	const envVars = {
		ETHERSCAN_API_KEY: Boolean(import.meta.env.ETHERSCAN_API_KEY),
		SNOWTRACE_API_KEY: Boolean(import.meta.env.SNOWTRACE_API_KEY),
		TURSO_DATABASE_URL: Boolean(import.meta.env.TURSO_DATABASE_URL),
		TURSO_AUTH_TOKEN: Boolean(import.meta.env.TURSO_AUTH_TOKEN),
		AAVE_V3_SUBGRAPH_API_KEY: Boolean(import.meta.env.AAVE_V3_SUBGRAPH_API_KEY ?? import.meta.env.AAVE_API_KEY),
		AAVE_V3_SUBGRAPH_ETHEREUM: Boolean(import.meta.env.AAVE_V3_SUBGRAPH_ETHEREUM),
		AAVE_V3_SUBGRAPH_POLYGON: Boolean(import.meta.env.AAVE_V3_SUBGRAPH_POLYGON),
		AAVE_V3_SUBGRAPH_AVALANCHE: Boolean(import.meta.env.AAVE_V3_SUBGRAPH_AVALANCHE),
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
		details.push('missing env vars for scanner/Aave/DB');
	}

	const summary = {
		ok: dbStatus === 'ok' && scannerStatus === 'ok' && envStatus === 'ok',
		db: dbStatus,
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
