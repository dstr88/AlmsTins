// Hand-run, read-only diagnostic: what the move rule changed on ONE tenant's data. NOT run by db:migrate
// or a cron, writes nothing, has no --apply.
//
//   npx vite-node --config vitest.config.ts src/scripts/taxMovesBeforeAfter.ts -- --tenant <id>
//   npx vite-node --config vitest.config.ts src/scripts/taxMovesBeforeAfter.ts -- --tenant <id> --years 2023,2024,2025
//
// Needs DATABASE_URL (the owner connection, as the other scripts here; without it the app's db module
// stops the script before anything connects). --tenant is required and there is no default.
//
// It reads the tenant's lifecycle events once and runs the lot ledger twice over them:
//   before   every transfer leg is read as a plain purchase or sale, which is what the lifecycle engine
//            did before transfers became moves (the join columns that tell a transfer from a sale are
//            left out, and no wallet is known);
//   after    the way Bookkeeping reads them now.
// Both runs use the same ledger, so the difference is the move rule and nothing else.
//
// Prints counts only: never an address, an id, an amount or a date of one transaction. Per year, the
// realized rows (short-term, long-term, needing attention) and the coins still held at year end;
// then how many sales became moves (and how many arrivals stopped opening a lot), the pairs by how
// they were linked, and the review items by reason, plus how many rows the ledger could not date or read.
//
// Each statement is a SELECT, apart from the app's own CREATE TABLE IF NOT EXISTS wallet_identity guard
// (walletIdentity.ensureWalletIdentityTable), which does nothing when the table exists. It only
// reads the lifecycle as it is now: run "Sync" first if the lifecycle may be stale (not from this script).

import { loadLedgerContext } from '@/lib/tax/ledgerContext';
import { loadLifecycleRows } from '@/lib/tax/computeLedger';
import { lifecycleToLedger } from '@/lib/tax/ledgerAdapters/lifecycle';
import { runLotLedger, type LedgerEvent, type LedgerResult } from '@/lib/tax/lotLedger';

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
const yearsArg = arg('years');
const currentYear = new Date().getUTCFullYear();

const rows = await loadLifecycleRows(tenantId);
const ctx = await loadLedgerContext(tenantId);

const input = { wallets: ctx.wallets, walletIdByTxHash: ctx.walletIdByTxHash, transferMatches: ctx.transferMatches, ownerIndex: ctx.ownerIndex, manualBasis: ctx.manualBasis };
const noJoin = rows.map((r) => ({
	...r, import_source: null, import_kind: null, import_description: null, import_account_id: null, import_wallet_id: null, tx_wallet_id: null, from_address: null, to_address: null,
}));
const before = lifecycleToLedger({ ...input, events: noJoin, wallets: [], walletIdByTxHash: undefined, transferMatches: [] });
const after = lifecycleToLedger({ ...input, events: rows });

const yearEnds = (y: number) => `${y}-12-31T23:59:59.999Z`;
const years = yearsArg ? yearsArg.split(',').map(Number).filter(Number.isFinite) : [...Array(currentYear - 2019).keys()].map((i) => 2020 + i);
const snapshotsAt = years.map(yearEnds);
const runBefore = runLotLedger(before.events, { snapshotsAt });
const runAfter = runLotLedger(after.events, { snapshotsAt });

const yearOf = (iso: string) => Number(iso.slice(0, 4));
function perYear(r: LedgerResult, y: number) {
	const sales = r.slices.filter((s) => s.taxable && yearOf(s.disposedAt) === y);
	const held = r.snapshots.find((s) => s.at === yearEnds(y))?.lots.filter((l) => l.qty > 1e-10 && l.wallet !== 'unallocated') ?? [];
	return {
		short: sales.filter((s) => s.term === 'short').length,
		long: sales.filter((s) => s.term === 'long').length,
		needsAttention: r.unmatched.filter((u) => u.taxable && yearOf(u.at) === y).length,
		heldLots: held.length,
		heldCoins: new Set(held.map((l) => l.asset)).size,
	};
}
console.log('realized rows and holdings per year (before -> after):');
for (const y of years) {
	const b = perYear(runBefore, y);
	const a = perYear(runAfter, y);
	if (!b.short && !b.long && !b.needsAttention && !b.heldLots && !a.heldLots) continue;
	console.log(
		`  ${y}  short ${b.short} -> ${a.short}  long ${b.long} -> ${a.long}  needs attention ${b.needsAttention} -> ${a.needsAttention}  held lots ${b.heldLots} -> ${a.heldLots}  held coins ${b.heldCoins} -> ${a.heldCoins}`,
	);
}

// Which rows changed: a row that was a taxable sale before and is a leg of a move or an unmatched send now.
const refsOf = (events: LedgerEvent[], kind: 'move' | 'sendUnmatched') => {
	const out = new Set<string>();
	for (const e of events) {
		if (kind === 'move' && e.kind === 'move') {
			out.add(e.outRef);
			out.add(e.inRef);
		}
		if (kind === 'sendUnmatched' && e.kind === 'sendUnmatched') out.add(e.sourceRef);
	}
	return out;
};
const moveRefs = refsOf(after.events, 'move');
const sendRefs = refsOf(after.events, 'sendUnmatched');
const soldBefore = new Set(runBefore.slices.filter((s) => s.taxable).map((s) => s.sourceRef));
const soldBeforeByYear = new Map<number, Set<string>>();
for (const s of runBefore.slices) {
	if (!s.taxable) continue;
	const set = soldBeforeByYear.get(yearOf(s.disposedAt)) ?? new Set<string>();
	set.add(s.sourceRef);
	soldBeforeByYear.set(yearOf(s.disposedAt), set);
}
const lotBefore = new Set(runBefore.lots.map((l) => l.sourceRef));
console.log('\nrows that changed:');
console.log(`  sales before that are legs of a move now: ${[...soldBefore].filter((r) => moveRefs.has(r)).length}`);
for (const [y, refs] of [...soldBeforeByYear].sort((a, b) => a[0] - b[0])) {
	const n = [...refs].filter((r) => moveRefs.has(r)).length;
	if (n) console.log(`    in ${y}: ${n}`);
}
console.log(`  sales before that are unmatched sends now (used up, not a sale): ${[...soldBefore].filter((r) => sendRefs.has(r)).length}`);
console.log(`  arrivals that opened a lot before and are the other end of a move now: ${[...lotBefore].filter((r) => moveRefs.has(r)).length}`);
const moves = after.events.filter((e) => e.kind === 'move');
const byLink = (k: string) => moves.filter((e) => e.kind === 'move' && e.link === k).length;
console.log(`  moves: ${moves.length} (by transaction hash ${byLink('hash')}, confirmed ${byLink('confirmed')}, by amount and time ${byLink('heuristic')})`);

const byReason = new Map<string, number>();
for (const f of runAfter.findings) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
console.log('\nreview items by reason:');
for (const [reason, n] of [...byReason].sort()) console.log(`  ${reason}: ${n}`);
console.log(`\nrows the ledger could not date or read (left out): ${(byReason.get('unreadable_event_date') ?? 0) + (byReason.get('invalid_event') ?? 0)}`);
console.log(`lifecycle events read: ${rows.length}`);
process.exit(0);
