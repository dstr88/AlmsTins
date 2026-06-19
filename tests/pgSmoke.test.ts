import 'dotenv/config';
import { test } from 'vitest';

// Broad PG smoke: run many of the app's real query paths against Postgres through
// the shim's web-role + app.tenant_id path. Collects EVERY failure in one run
// (no fail-fast) so PG-vs-SQLite issues can be batch-fixed. One-off; needs live
// DATABASE_URL / WEB_DATABASE_URL. Not a CI unit test.
process.env.DB_ENGINE = 'pg';

// Skips unless a live DATABASE_URL is present (so CI without PG creds is unaffected).
// Run deliberately with: DB_ENGINE=pg npx vitest run tests/pgSmoke.test.ts
test.skipIf(!process.env.DATABASE_URL)('broad PG query smoke (needs live PG)', async () => {
	const pg = (await import('pg')).default;
	const probe = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
	await probe.connect();
	const tenantId = (await probe.query('select tenant_id from import_transactions group by tenant_id order by count(*) desc limit 1')).rows[0].tenant_id;
	const userId = (await probe.query('select u.id from auth_users u join tenant_memberships m on m.user_id=u.id where m.tenant_id=$1 limit 1', [tenantId])).rows[0]?.id ?? null;
	const walletId = (await probe.query('select id from wallets where tenant_id=$1 limit 1', [tenantId])).rows[0]?.id ?? null;
	await probe.end();
	console.log(`[smoke] tenant=${tenantId} user=${userId} wallet=${walletId}`);

	const { runWithDbContext } = await import('@/lib/dbContext');
	const networth = await import('@/lib/networth');
	const na = await import('@/lib/getNeedsAttention');
	const subs = await import('@/lib/subscriptions');
	const jur = await import('@/lib/jurisdictionProfile');
	const wallets = await import('@/lib/wallets');
	const recon = await import('@/lib/monthlyReconciliation');
	const puller = await import('@/lib/db/puller');
	const tx = await import('@/lib/transactions');
	const lifecycle = await import('@/lib/lifecycle');

	const results: Array<[string, 'PASS' | 'FAIL', string]> = [];
	const run = async (name: string, fn: () => Promise<unknown>, ms = 30_000) => {
		try {
			const r = await Promise.race([
				fn(),
				new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms (likely external API, not a PG issue)`)), ms); (t as { unref?: () => void }).unref?.(); }),
			]);
			const d = Array.isArray(r) ? `[${r.length}]` : (r && typeof r === 'object' ? Object.keys(r).slice(0, 5).join(',') : String(r));
			results.push([name, 'PASS', d]);
		} catch (e) { results.push([name, 'FAIL', (e as Error).message.split('\n')[0]]); }
	};

	await runWithDbContext({ tenantId, userId }, async () => {
		// networth getLatest/getNetWorthSummary already validated ($16,780, 11 wallets);
		// they make live Aave calls per wallet, so skip here to keep the pass PG-focused.
		await run('getLatestSnapshotCapturedAtByChain', () => networth.getLatestSnapshotCapturedAtByChain(tenantId));
		await run('runNeedsAttentionQueries', () => na.runNeedsAttentionQueries(tenantId));
		await run('getActivePlan', () => subs.getActivePlan(tenantId));
		await run('getJurisdictionProfile', () => jur.getJurisdictionProfile(tenantId));
		await run('getAllActiveWallets', () => wallets.getAllActiveWallets(tenantId));
		await run('getAvailableReconciliationMonths', () => recon.getAvailableReconciliationMonths(tenantId));
		if (walletId) {
			await run('getWalletNfts', () => puller.getWalletNfts(tenantId, walletId));
			await run('getLatestAaveSnapshot', () => puller.getLatestAaveSnapshot(tenantId, walletId));
			await run('getWalletById', () => puller.getWalletById(tenantId, walletId));
			await run('getTransactionsForWallet', () => tx.getTransactionsForWallet(tenantId, walletId));
		}
		const months = await recon.getAvailableReconciliationMonths(tenantId).catch(() => [] as string[]);
		if (months.length) await run('computeMonthlyReconciliation', () => recon.computeMonthlyReconciliation(tenantId, months[0]));
		await run('rebuildAssetLifecycles (write)', () => lifecycle.rebuildAssetLifecycles(tenantId), 90_000);
	});

	const fails = results.filter((r) => r[1] === 'FAIL');
	console.log('\n=== RESULTS ===');
	for (const [n, s, d] of results) console.log(`  ${s}  ${n}  ${s === 'FAIL' ? '-> ' + d : '(' + d + ')'}`);
	console.log(`\n${results.length - fails.length}/${results.length} passed` + (fails.length ? `\nFAILURES:\n${fails.map((f) => `  ${f[0]}: ${f[2]}`).join('\n')}` : ''));
}, 300_000);
