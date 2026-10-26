// One-time, hand-run correction of Bitcoin and Litecoin USD values. NOT run by db:migrate or a cron.
//
//   npx vite-node --config vitest.config.ts src/scripts/correctUtxoPrices.ts                      # dry run, read-only
//   npx vite-node --config vitest.config.ts src/scripts/correctUtxoPrices.ts -- --tenant <id>     # one tenant
//   npx vite-node --config vitest.config.ts src/scripts/correctUtxoPrices.ts -- --apply           # write
//
// Needs DATABASE_URL (the owner connection, as the other scripts here; without it the app's db module
// stops the script before anything connects). Prices: CoinGecko for the days it reaches (the past
// 365 days without a Pro key), Coinbase Exchange's public candles for older days (Bitcoin from
// 2015-07-20, Litecoin from 2016-08-17); no key needed.
// vite-node resolves the app's '@/' imports through vitest.config.ts.
// Options: --tenant <id> (repeatable), --sample <n> (rows printed per tenant, default 5),
// --delay-ms <n> (wait before each day CoinGecko is asked for, default 2000, for its rate limit;
// Coinbase requests pace themselves).
//
// Until the sync priced rows on their own day, it stored every Bitcoin and Litecoin row at the
// price on the day of that sync. This re-prices those rows at their transaction's UTC day, the
// way the sync now does, and writes native_usd and price_source only. Which rows qualify, and why
// a value anyone else wrote is never touched: src/lib/sync/utxoPriceCorrection.ts.
//
// Safety: the dry run writes nothing (the price cache aside: lookups are cached in the app's cache
// table, as the app caches them). --apply writes each tenant in its own transaction; it rolls
// back that tenant if any row changed since it was read. A row with no price for its day keeps its
// value and is marked price_source = 'sync_date_estimate', so the figures still resting on the old
// sync-date price can be found (with the Coinbase fallback, essentially only Bitcoin days before
// 2015-07-20 and Litecoin days before 2016-08-17, or a day a request failed); a later run re-prices
// marked rows when it can. Re-running is safe: a corrected row has a real price_source and
// is not selected again. Prints counts and a few rows (date, amount, old and new value), never an address.
//
// Afterwards: cost basis and gains read these values once the tenant's lifecycles are rebuilt (Sync
// Tins, the sync buttons on Bookkeeping, Annual Records and Year Summary, Fill Missing Prices) and
// when Year-End is run again.
import pg from 'pg';
import { DEMO_TENANT_ID } from '@/lib/demo';
import { formatUsd } from '@/lib/format';
import { coingeckoReachesDay } from '@/lib/sync/utxoHistoricalPrice';
import {
	CANDIDATE_SQL, ESTIMATE_SOURCE, TENANTS_SQL, applyCorrections, planCorrections, selectSyncPricedRows, type CandidateRow,
} from '@/lib/sync/utxoPriceCorrection';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const APPLY = argv.includes('--apply');
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const intOf = (flag: string, fallback: number) => {
	const v = Number(valuesOf(flag)[0]);
	return Number.isInteger(v) && v >= 0 ? v : fallback;
};
const ONLY = valuesOf('--tenant');
const SAMPLE = intOf('--sample', 5);
const DELAY_MS = intOf('--delay-ms', 2000);

const usd = (n: number) => formatUsd(n);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<number> {
	const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
	await c.connect();
	try {
		const hasSource = (await c.query(
			`SELECT 1 FROM information_schema.columns
			  WHERE table_schema = current_schema() AND table_name = 'import_transactions' AND column_name = 'price_source'`,
		)).rows.length > 0;
		if (!hasSource) {
			console.log('import_transactions has no price_source column: apply migrations-pg/0045_import_price_source.sql first');
			return 1;
		}

		const tenants = ONLY.length ? ONLY : (await c.query(TENANTS_SQL)).rows.map((r) => String(r.tenant_id));
		console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}: ${tenants.length} tenant(s)`);
		const total = { candidates: 0, changes: 0, unchanged: 0, unpriced: 0, marks: 0, notSyncShape: 0, offBatchPrice: 0, applied: 0, marked: 0, failed: 0 };

		for (const tenantId of tenants) {
			if (tenantId === DEMO_TENANT_ID) continue;
			const rows = (await c.query(CANDIDATE_SQL, [tenantId])).rows as CandidateRow[];
			const sel = selectSyncPricedRows(rows);
			const plan = await planCorrections(sel.rows, {
				beforeLookup: async (_symbol, day) => { if (coingeckoReachesDay(day)) await sleep(DELAY_MS); },
			});
			total.candidates += sel.rows.length;
			total.changes += plan.changes.length;
			total.unchanged += plan.unchanged;
			total.unpriced += plan.unpriced.length;
			total.marks += plan.marks.length;
			total.notSyncShape += sel.notSyncShape;
			total.offBatchPrice += sel.offBatchPrice;

			const delta = plan.changes.reduce((s, ch) => s + ch.newUsd - ch.oldUsd, 0);
			console.log(`tenant ${tenantId}: sync rows=${sel.rows.length} to change=${plan.changes.length} (net ${delta >= 0 ? '+' : '-'}${usd(Math.abs(delta))})`
				+ ` already right=${plan.unchanged} no price=${plan.unpriced.length} (to mark as estimate=${plan.marks.length})`
				+ ` left alone: not sync shape=${sel.notSyncShape} off batch price=${sel.offBatchPrice}`);
			for (const ch of plan.changes.slice(0, SAMPLE)) {
				console.log(`    ${ch.day} ${ch.amount} ${ch.symbol}: ${usd(ch.oldUsd)} -> ${usd(ch.newUsd)} (${ch.source})`);
			}
			if (plan.unpriced.length) {
				const days = plan.unpriced.map((r) => r.day).sort();
				console.log(`    no price for ${plan.unpriced.length} row(s), ${days[0]} to ${days[days.length - 1]}; values kept, marked ${ESTIMATE_SOURCE}`);
			}

			if (APPLY && (plan.changes.length || plan.marks.length)) {
				try {
					const done = await applyCorrections(c, tenantId, plan.changes, plan.marks);
					total.applied += done.changed;
					total.marked += done.marked;
					console.log(`    applied ${done.changed}, marked ${done.marked} as estimates`);
				} catch (e) {
					total.failed++;
					console.log(`    ROLLED BACK, nothing changed for this tenant: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		}

		console.log(`total: sync rows=${total.candidates} to change=${total.changes} already right=${total.unchanged}`
			+ ` no price=${total.unpriced} (to mark=${total.marks}) not sync shape=${total.notSyncShape} off batch price=${total.offBatchPrice}`
			+ (APPLY ? ` applied=${total.applied} marked=${total.marked} tenants rolled back=${total.failed}` : ''));
		if (APPLY && total.applied) {
			console.log('next: lifecycles pick these values up on each tenant\'s next rebuild (Sync Tins and the other sync buttons); re-run Year-End for the years affected');
		}
		return total.failed ? 1 : 0;
	} finally {
		await c.end();
	}
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error('[correctUtxoPrices] failed', err instanceof Error ? err.message : String(err));
		process.exit(1);
	},
);
