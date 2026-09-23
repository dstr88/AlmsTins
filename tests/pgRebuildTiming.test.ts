// DIAGNOSTIC, NOT A CI TEST: opt-in only (RUN_PG_DIAGNOSTICS=1 + DATABASE_URL); it WRITES (full lifecycle rebuild), so never point it at production without intent.
import 'dotenv/config';
import { test } from 'vitest';

// Time rebuildAssetLifecycles for the owner tenant against Postgres, under the
// same RLS/web-pool context the endpoint uses, to see if it exceeds Render's ~60s
// synchronous cutoff (which would explain the hanging "Sync now"). Needs live PG.
process.env.DB_ENGINE = 'pg';

// Skips unless explicitly opted in. DATABASE_URL alone is NOT enough: a CI Postgres
// service or a local .env would otherwise switch this on.
// Run deliberately with: RUN_PG_DIAGNOSTICS=1 DB_ENGINE=pg npx vitest run tests/pgRebuildTiming.test.ts
const runPgDiagnostics = process.env.RUN_PG_DIAGNOSTICS === '1' && !!process.env.DATABASE_URL;

test.skipIf(!runPgDiagnostics)('time rebuildAssetLifecycles on PG', async () => {
	const { runWithDbContext } = await import('@/lib/dbContext');
	const { rebuildAssetLifecycles } = await import('@/lib/lifecycle');
	const tenantId = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
	const t0 = Date.now();
	await runWithDbContext({ tenantId, userId: null }, async () => {
		await rebuildAssetLifecycles(tenantId);
	});
	console.log(`\n##### rebuildAssetLifecycles took ${Date.now() - t0}ms #####`);
}, 600_000);
