import 'dotenv/config';
import { test } from 'vitest';

// Time rebuildAssetLifecycles for the owner tenant against Postgres, under the
// same RLS/web-pool context the endpoint uses, to see if it exceeds Render's ~60s
// synchronous cutoff (which would explain the hanging "Sync now"). Needs live PG.
process.env.DB_ENGINE = 'pg';

test.skipIf(!process.env.DATABASE_URL)('time rebuildAssetLifecycles on PG', async () => {
	const { runWithDbContext } = await import('@/lib/dbContext');
	const { rebuildAssetLifecycles } = await import('@/lib/lifecycle');
	const tenantId = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
	const t0 = Date.now();
	await runWithDbContext({ tenantId, userId: null }, async () => {
		await rebuildAssetLifecycles(tenantId);
	});
	console.log(`\n##### rebuildAssetLifecycles took ${Date.now() - t0}ms #####`);
}, 600_000);
