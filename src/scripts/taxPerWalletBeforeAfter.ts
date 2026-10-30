// Hand-run, read-only diagnostic: what the per-wallet rule changes on ONE tenant's data. NOT run by
// db:migrate or a cron, writes nothing, has no --apply.
//
//   npx vite-node --config vitest.config.ts src/scripts/taxPerWalletBeforeAfter.ts -- --tenant <id>
//   npx vite-node --config vitest.config.ts src/scripts/taxPerWalletBeforeAfter.ts -- --tenant <id> --engine lifecycle
//
// Needs DATABASE_URL (the owner connection, as the other scripts here). --tenant is required and
// there is no default. --engine is pipeline (the default: what the owner's tax pages read once
// classify has run) or lifecycle.
//
// It reads the tenant's history once, turns it into ledger events, and runs the lot ledger twice:
//   one pool     every year, one pool per coin (what every figure was before the per-wallet rule);
//   per wallet   one pool per coin up to the end of 2024, then one pool per coin and wallet.
// Both runs use the same ledger and the same events, so the difference is the lot rule and nothing
// else. The tenant's saved January 1 allocations are used in the per-wallet run, as in the app.
//
// Prints counts only: never an address, an id, an amount or the date of one transaction. For each
// year from 2025: sales (a sale is one row, however many lots it drew on), how many drew on different
// lots under the two rules, how many changed between short-term and long-term, and how many are
// unmatched. Then, for the opening positions: coins and wallets with a January 1, 2025 position,
// the coins that need a look and why, and the review items of the per-wallet run by reason.
//
// Each statement is a SELECT, apart from the app's own CREATE TABLE IF NOT EXISTS guards, which do
// nothing when the table exists.

import { loadAllocationOverrides } from '@/lib/tax/allocationOverride';
import { PER_WALLET_FROM } from '@/lib/tax/basisMethod';
import { loadLedgerEvents, type LedgerEngine } from '@/lib/tax/computeLedger';
import { runLotLedger, type LedgerResult } from '@/lib/tax/lotLedger';

if (process.argv.includes('--apply')) {
	console.error('This script is read-only; there is nothing to apply.');
	process.exit(2);
}
const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const tenantId = arg('tenant');
if (!tenantId) {
	console.error('Missing --tenant <id>');
	process.exit(1);
}
const engine: LedgerEngine = arg('engine') === 'lifecycle' ? 'lifecycle' : 'pipeline';

const { events } = await loadLedgerEvents(tenantId, engine);
const overrides = await loadAllocationOverrides(tenantId);
const currentYear = new Date().getUTCFullYear();
const pooled = runLotLedger(events, { perWalletFrom: null });
const perWallet = runLotLedger(events, {
	perWalletFrom: PER_WALLET_FROM,
	allocationOverrides: overrides,
	snapshotsAt: [`${currentYear}-12-31T23:59:59.999Z`],
});

const yearOf = (iso: string): number => new Date(Date.parse(iso)).getUTCFullYear();

/** For each taxable sale in a year: what it drew on and the terms of it. */
function salesOf(r: LedgerResult, year: number): Map<string, { lots: string; terms: string }> {
	const by = new Map<string, { lots: string[]; terms: Set<string> }>();
	for (const s of r.slices) {
		if (!s.taxable || yearOf(s.disposedAt) !== year) continue;
		const e = by.get(s.sourceRef) ?? { lots: [], terms: new Set<string>() };
		e.lots.push(`${s.acquiredAt}|${s.qty}`);
		e.terms.add(s.term);
		by.set(s.sourceRef, e);
	}
	for (const u of r.unmatched) {
		if (!u.taxable || yearOf(u.at) !== year) continue;
		const e = by.get(u.sourceRef) ?? { lots: [], terms: new Set<string>() };
		e.lots.push(`unmatched|${u.qty}`);
		by.set(u.sourceRef, e);
	}
	return new Map([...by].map(([ref, e]) => [ref, { lots: e.lots.sort().join(';'), terms: [...e.terms].sort().join(',') }]));
}

console.log(`engine: ${engine}   events: ${events.length}   saved allocations (coins): ${overrides.length}`);
console.log('\nsales per year (one pool -> per wallet):');
for (let y = 2025; y <= currentYear; y++) {
	const a = salesOf(pooled, y);
	const b = salesOf(perWallet, y);
	if (a.size === 0 && b.size === 0) continue;
	let drewDifferently = 0;
	let termChanged = 0;
	for (const [ref, sale] of b) {
		const was = a.get(ref);
		if (!was) continue;
		if (was.lots !== sale.lots) drewDifferently++;
		if (was.terms !== sale.terms) termChanged++;
	}
	const unmatched = (r: LedgerResult) => r.unmatched.filter((u) => u.taxable && yearOf(u.at) === y).length;
	console.log(`  ${y}: sales ${a.size} -> ${b.size}; drew on different lots: ${drewDifferently}; short/long changed: ${termChanged}; unmatched ${unmatched(pooled)} -> ${unmatched(perWallet)}`);
}

console.log(`\nopening positions on ${PER_WALLET_FROM}:`);
let wallets = 0;
const gapDetails = new Map<string, number>();
const coinsToLook = new Set<string>();
for (const j of perWallet.jan1) wallets += j.positions.filter((p) => p.units > 0).length;
for (const f of perWallet.findings) {
	if (f.reason !== 'jan1_position_gap' && f.reason !== 'allocation_override_rejected') continue;
	coinsToLook.add(f.asset);
	const key = `${f.reason}: ${f.detail ?? '-'}`;
	gapDetails.set(key, (gapDetails.get(key) ?? 0) + 1);
}
console.log(`  coins with a position: ${perWallet.jan1.length}   wallet positions: ${wallets}   coins that need a look: ${coinsToLook.size}`);
console.log(`  placed by your allocation: ${perWallet.jan1.filter((j) => j.source === 'override').length}   allocations refused: ${perWallet.jan1.filter((j) => j.overrideRejected).length}`);
for (const [k, n] of [...gapDetails].sort()) console.log(`    ${k}: ${n}`);

console.log('\nreview items in the per-wallet run, by reason:');
const byReason = new Map<string, number>();
for (const f of perWallet.findings) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
for (const [reason, n] of [...byReason].sort()) console.log(`  ${reason}: ${n}`);

console.log('\nheld at the end of the last year, by coin and wallet (counts of positions only):');
const last = perWallet.snapshots[perWallet.snapshots.length - 1];
const held = new Set((last?.lots ?? []).filter((l) => l.qty > 1e-10).map((l) => `${l.asset}|${l.wallet}`));
console.log(`  coin/wallet positions held: ${held.size}   coins: ${new Set([...held].map((h) => h.split('|')[0])).size}`);
process.exit(0);
