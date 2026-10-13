/**
 * Diagnostic script: show every import_transaction row classified as an
 * owned_acquisition for BTC, so we can understand why total_quantity is too high.
 *
 * Run:
 *   node --import dotenv/config src/scripts/diagnoseBtcQty.mjs
 *
 * Override tenant: TENANT_ID=xxx node --import dotenv/config src/scripts/diagnoseBtcQty.mjs
 */

import { createClient } from '@libsql/client';

const url       = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const tenantId  = process.env.TENANT_ID;

if (!url)       throw new Error('Missing TURSO_DATABASE_URL');
if (!authToken) throw new Error('Missing TURSO_AUTH_TOKEN');

const db = createClient({ url, authToken });

// Helper: classify just like classifyImportTx in lifecycle.ts
function classifyImportTx(description, kind, direction) {
	const text = `${description ?? ''} ${kind ?? ''}`.toLowerCase();
	if (text.includes('borrow') || text.includes('loan') || text.includes('margin credit') || text.includes('flash loan')) return 'liability_increase';
	if (text.includes('repay') || text.includes('repayment') || text.includes('interest payment')) return 'liability_repayment';
	if (direction === 'in') return 'owned_acquisition';
	return 'other';
}

// Helper: pick quantity just like lifecycle.ts
function normalizeSymbol(s) { return (s ?? '').toUpperCase(); }
function pickQty(row) {
	const sym   = normalizeSymbol(row.asset_symbol);
	const cur   = normalizeSymbol(row.currency);
	const toCur = normalizeSymbol(row.to_currency);
	const rawAmt = row.amount   === null || row.amount   === undefined ? null : Number(row.amount);
	const rawTo  = row.to_amount === null || row.to_amount === undefined ? null : Number(row.to_amount);
	let qty;
	if (sym && toCur && sym === toCur && rawTo !== null)   qty = rawTo;
	else if (sym && cur && sym === cur && rawAmt !== null)  qty = rawAmt;
	else                                                    qty = rawTo ?? rawAmt;
	return qty === null ? null : Math.abs(qty);
}

async function run() {
	// ── Find tenant if not provided ───────────────────────────────────────────
	let tid = tenantId;
	if (!tid) {
		const res = await db.execute(`SELECT DISTINCT tenant_id FROM import_transactions LIMIT 5`);
		console.log('Available tenant_ids:', res.rows.map(r => r.tenant_id));
		if (res.rows.length === 1) {
			tid = String(res.rows[0].tenant_id);
			console.log(`Auto-selected tenant: ${tid}\n`);
		} else {
			console.log('Set TENANT_ID env var to one of the above and re-run.');
			process.exit(0);
		}
	}

	// ── 1. All BTC import rows ────────────────────────────────────────────────
	const { rows } = await db.execute({
		sql: `SELECT id, asset_symbol, currency, amount, to_currency, to_amount,
		             native_usd, timestamp_utc, direction, tx_hash,
		             exchange_withdrawal_id, description, kind
		      FROM import_transactions
		      WHERE tenant_id = ?
		        AND UPPER(asset_symbol) = 'BTC'
		      ORDER BY timestamp_utc`,
		args: [tid],
	});

	console.log(`\n=== Total BTC import rows: ${rows.length} ===\n`);

	let acquisitionTotal = 0;
	let acquisitionCount = 0;

	for (const row of rows) {
		const txClass = classifyImportTx(row.description, row.kind, row.direction);
		const qty     = pickQty(row);
		const isAcq   = txClass === 'owned_acquisition' && (row.native_usd ?? 0) > 0;

		if (isAcq) {
			acquisitionTotal += qty ?? 0;
			acquisitionCount++;
		}

		console.log([
			`[${String(row.timestamp_utc).slice(0,10)}]`,
			`dir=${row.direction ?? '?'}`,
			`class=${txClass}`,
			`qty=${qty != null ? qty.toFixed(8) : 'null'}`,
			`native_usd=${row.native_usd != null ? Number(row.native_usd).toFixed(2) : 'null'}`,
			`is_acq=${isAcq}`,
			`cur=${row.currency ?? ''}→${row.to_currency ?? ''}`,
			`amt=${row.amount ?? 'null'}`,
			`to_amt=${row.to_amount ?? 'null'}`,
			`kind=${row.kind ?? ''}`,
			`desc=${String(row.description ?? '').slice(0, 60)}`,
		].join('  '));
	}

	console.log(`\n=== Acquisition summary ===`);
	console.log(`  Count : ${acquisitionCount}`);
	console.log(`  Total : ${acquisitionTotal.toFixed(8)} BTC`);

	// ── 2. Check for duplicate source rows ───────────────────────────────────
	console.log('\n=== Duplicate tx_hash check (BTC in-direction) ===');
	const dupes = await db.execute({
		sql: `SELECT tx_hash, COUNT(*) as cnt
		      FROM import_transactions
		      WHERE tenant_id = ?
		        AND UPPER(asset_symbol) = 'BTC'
		        AND tx_hash IS NOT NULL
		      GROUP BY tx_hash
		      HAVING cnt > 1`,
		args: [tid],
	});
	if (dupes.rows.length === 0) {
		console.log('  No duplicate tx_hash entries found.');
	} else {
		for (const d of dupes.rows) {
			console.log(`  tx_hash=${d.tx_hash}  count=${d.cnt}`);
		}
	}

	// ── 3. Check for duplicate ID / same timestamp + same amount combos ───────
	console.log('\n=== Near-duplicate rows (same timestamp + amount, different id) ===');
	const nearDupes = await db.execute({
		sql: `SELECT timestamp_utc, amount, to_amount, COUNT(*) as cnt
		      FROM import_transactions
		      WHERE tenant_id = ?
		        AND UPPER(asset_symbol) = 'BTC'
		      GROUP BY timestamp_utc, amount, to_amount
		      HAVING cnt > 1`,
		args: [tid],
	});
	if (nearDupes.rows.length === 0) {
		console.log('  No near-duplicates found.');
	} else {
		for (const d of nearDupes.rows) {
			console.log(`  ts=${d.timestamp_utc}  amt=${d.amount}  to_amt=${d.to_amount}  count=${d.cnt}`);
		}
	}

	// ── 4. Cross-check against asset_lifecycle_groups ────────────────────────
	console.log('\n=== asset_lifecycle_groups for BTC ===');
	const groups = await db.execute({
		sql: `SELECT id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at
		      FROM asset_lifecycle_groups
		      WHERE tenant_id = ?
		        AND UPPER(asset_symbol) = 'BTC'`,
		args: [tid],
	});
	for (const g of groups.rows) {
		console.log(`  group_id=${g.id}  qty=${g.total_quantity}  wac=${g.weighted_avg_cost_usd}  last=${g.latest_acquired_at}`);
	}

	// ── 5. Count events in asset_lifecycle_events for those groups ────────────
	console.log('\n=== asset_lifecycle_events for BTC (owned_acquisition only) ===');
	const groupIds = groups.rows.map(g => g.id);
	if (groupIds.length > 0) {
		const placeholders = groupIds.map(() => '?').join(',');
		const events = await db.execute({
			sql: `SELECT e.id, e.group_id, e.source_type, e.source_id, e.direction,
			             e.amount, e.native_usd, e.timestamp_utc, e.transaction_class, e.linked_transfer
			      FROM asset_lifecycle_events e
			      WHERE e.group_id IN (${placeholders})
			        AND e.transaction_class = 'owned_acquisition'
			      ORDER BY e.timestamp_utc`,
			args: groupIds,
		});
		let evtTotal = 0;
		for (const e of events.rows) {
			const amt = e.amount != null ? Number(e.amount) : 0;
			evtTotal += amt;
			console.log(`  [${String(e.timestamp_utc).slice(0,10)}] src=${e.source_type}/${e.source_id}  amt=${amt.toFixed(8)}  usd=${e.native_usd != null ? Number(e.native_usd).toFixed(2) : 'null'}`);
		}
		console.log(`  ─────────────────────────────────────────────`);
		console.log(`  Event total: ${evtTotal.toFixed(8)} BTC  (${events.rows.length} events)`);
	}

	process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
