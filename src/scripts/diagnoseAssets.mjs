/**
 * Quick summary: gross acquisitions vs disposals for a list of assets.
 * Run: TENANT_ID=xxx SYMBOLS=BNB,LINK,DOT node --import dotenv/config src/scripts/diagnoseAssets.mjs
 */
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tid = process.env.TENANT_ID ?? 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';
const symbols = (process.env.SYMBOLS ?? 'BNB,LINK,DOT').split(',').map(s => s.trim().toUpperCase());

function classifyImportTx(description, kind, direction) {
	const text = `${description ?? ''} ${kind ?? ''}`.toLowerCase();
	if (text.includes('borrow') || text.includes('loan') || text.includes('margin credit') || text.includes('flash loan')) return 'liability_increase';
	if (text.includes('repay') || text.includes('repayment') || text.includes('interest payment')) return 'liability_repayment';
	if (direction === 'in') return 'owned_acquisition';
	return 'other';
}

function pickQty(row) {
	const sym   = (row.asset_symbol ?? '').toUpperCase();
	const cur   = (row.currency ?? '').toUpperCase();
	const toCur = (row.to_currency ?? '').toUpperCase();
	const rawAmt = row.amount    == null ? null : Number(row.amount);
	const rawTo  = row.to_amount == null ? null : Number(row.to_amount);
	let qty;
	if (sym && toCur && sym === toCur && rawTo !== null)   qty = rawTo;
	else if (sym && cur && sym === cur && rawAmt !== null)  qty = rawAmt;
	else                                                    qty = rawTo ?? rawAmt;
	return qty == null ? null : Math.abs(qty);
}

for (const sym of symbols) {
	const { rows } = await db.execute({
		sql: `SELECT asset_symbol, currency, amount, to_currency, to_amount,
		             native_usd, timestamp_utc, direction, kind, description
		      FROM import_transactions
		      WHERE tenant_id = ? AND UPPER(asset_symbol) = ?
		      ORDER BY timestamp_utc`,
		args: [tid, sym],
	});

	let grossAcq = 0, acqCount = 0, disposed = 0, dispCount = 0;
	const acqRows = [];
	const dispRows = [];

	for (const r of rows) {
		const txClass = classifyImportTx(r.description, r.kind, r.direction);
		const qty = pickQty(r) ?? 0;
		const isAcq = txClass === 'owned_acquisition' && (r.native_usd ?? 0) > 0;

		if (isAcq) { grossAcq += qty; acqCount++; acqRows.push(r); }
		else if (r.direction === 'out') { disposed += qty; dispCount++; dispRows.push(r); }
	}

	const net = grossAcq - disposed;

	console.log(`\n══ ${sym} ══════════════════════════════════════════`);
	console.log(`  Total import rows   : ${rows.length}`);
	console.log(`  Gross acquisitions  : ${grossAcq.toFixed(6)}  (${acqCount} rows)`);
	console.log(`  Total disposed      : ${disposed.toFixed(6)}  (${dispCount} rows)`);
	console.log(`  Net holdings        : ${net.toFixed(6)}`);

	// Check lifecycle groups
	const { rows: grp } = await db.execute({
		sql: `SELECT total_quantity, weighted_avg_cost_usd FROM asset_lifecycle_groups
		      WHERE tenant_id = ? AND UPPER(asset_symbol) = ?`,
		args: [tid, sym],
	});
	if (grp.length > 0) {
		console.log(`  Lifecycle qty (DB)  : ${Number(grp[0].total_quantity).toFixed(6)}  wac=$${Number(grp[0].weighted_avg_cost_usd).toFixed(4)}`);
	}

	// Breakdown of acquisition kinds
	const kindMap = {};
	for (const r of acqRows) {
		const k = r.kind ?? 'unknown';
		kindMap[k] = (kindMap[k] ?? 0) + (pickQty(r) ?? 0);
	}
	console.log(`  Acquisition sources:`);
	for (const [k, v] of Object.entries(kindMap).sort((a,b) => b[1]-a[1])) {
		console.log(`    ${k.padEnd(35)} ${v.toFixed(6)}`);
	}

	// Breakdown of disposal kinds
	const dispKindMap = {};
	for (const r of dispRows) {
		const k = r.kind ?? 'unknown';
		dispKindMap[k] = (dispKindMap[k] ?? 0) + (pickQty(r) ?? 0);
	}
	console.log(`  Disposal sources:`);
	for (const [k, v] of Object.entries(dispKindMap).sort((a,b) => b[1]-a[1])) {
		console.log(`    ${k.padEnd(35)} ${v.toFixed(6)}`);
	}
}

process.exit(0);
