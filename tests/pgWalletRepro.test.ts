import 'dotenv/config';
import { test } from 'vitest';

// Reproduce the vault tin load (getWalletTokenBreakdown) for EVERY real wallet of
// the owner tenant against Postgres, to find which wallets 500 (the "Vault load
// error" emails). Per-wallet timeout guards against external-API hangs. Needs live PG.
process.env.DB_ENGINE = 'pg';

test.skipIf(!process.env.DATABASE_URL)('getWalletTokenBreakdown for all real wallets on PG', async () => {
	const pg = (await import('pg')).default;
	const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
	await c.connect();
	const tenantId = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
	const wallets = (await c.query('select id, label, chains from wallets where tenant_id=$1 order by chains', [tenantId])).rows;
	await c.end();

	const { runWithDbContext } = await import('@/lib/dbContext');
	const { getWalletTokenBreakdown } = await import('@/lib/networth');

	const out: string[] = [`\n##### ${wallets.length} wallets for ${tenantId} #####`];
	await runWithDbContext({ tenantId, userId: null }, async () => {
		for (const w of wallets) {
			const tag = `${String(w.chains ?? '').slice(0, 18).padEnd(18)} ${String(w.label ?? '').slice(0, 16).padEnd(16)}`;
			try {
				const r = await Promise.race([
					getWalletTokenBreakdown(tenantId, w.id),
					new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('TIMEOUT 15s (external API, not PG)')), 15000); (t as { unref?: () => void }).unref?.(); }),
				]) as { tokens?: unknown[] };
				out.push(`##OK##   ${tag} tokens=${r?.tokens?.length ?? '?'}`);
			} catch (e) {
				out.push(`##FAIL## ${tag} -> ${(e as Error).message.split('\n')[0].slice(0, 90)}`);
			}
		}
	});
	console.log(out.join('\n'));
}, 300_000);
