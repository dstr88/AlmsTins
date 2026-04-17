/**
 * generate-form8949.mjs
 *
 * Generates a Form 8949-style PDF from live Turso database data.
 * Requires: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env
 *
 * Usage:
 *   node --env-file=.env scripts/generate-form8949.mjs [year]
 *   node --env-file=.env scripts/generate-form8949.mjs 2025
 */

import { createClient } from '@libsql/client';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const year = Number(process.argv[2] ?? 2025);

// ─── DB connection ───────────────────────────────────────────────────────────
const db = createClient({
	url:       process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Get tenant ──────────────────────────────────────────────────────────────
const tenantRes = await db.execute({
	sql: `SELECT DISTINCT tenant_id FROM tax_disposals LIMIT 1`,
	args: [],
});

if (!tenantRes.rows.length) {
	console.error('No tax_disposals found. Have you run the tax pipeline?');
	process.exit(1);
}
const tenantId = tenantRes.rows[0].tenant_id;
console.log(`Using tenant: ${tenantId}`);

// ─── Query disposals for the year (joined to lot for acquired_at) ─────────────
const startIso = `${year}-01-01T00:00:00Z`;
const endIso   = `${year + 1}-01-01T00:00:00Z`;

const result = await db.execute({
	sql: `
		SELECT
			d.asset_symbol,
			d.quantity,
			d.disposed_at,
			d.proceeds_usd,
			d.cost_basis_usd,
			d.gain_loss_usd,
			d.is_short_term,
			l.acquired_at
		FROM tax_disposals d
		LEFT JOIN tax_lots l ON l.id = d.lot_id
		WHERE d.tenant_id = ?
		  AND d.disposed_at >= ?
		  AND d.disposed_at <  ?
		ORDER BY d.is_short_term DESC, d.disposed_at ASC
	`,
	args: [tenantId, startIso, endIso],
});

console.log(`Found ${result.rows.length} disposal rows for ${year}`);

// ─── Cleanup: remove duplicates and known transfers ───────────────────────────
const dedupeKey = (r) =>
	`${r.asset_symbol}|${r.quantity}|${r.acquired_at}|${r.disposed_at}|${r.proceeds_usd}|${r.cost_basis_usd}`;

const isTransfer = (r) => {
	const proceeds = r.proceeds_usd != null ? Number(r.proceeds_usd) : 0;
	const basis    = r.cost_basis_usd != null ? Number(r.cost_basis_usd) : 0;
	// AVAX deposited to Aave (all $0-proceeds AVAX entries)
	if (r.asset_symbol === 'AVAX' && proceeds === 0) return true;
	// LTC wallet transfers to Coinbase ($0 proceeds)
	if (r.asset_symbol === 'LTC'  && proceeds === 0) return true;
	// Dust/zero-value entries for non-BTC assets
	if (r.asset_symbol !== 'BTC'  && proceeds === 0 && basis === 0) return true;
	return false;
};

const seen = new Set();
const cleanedRows = result.rows.filter(r => {
	if (isTransfer(r)) { console.log(`  [transfer] ${r.asset_symbol} ${r.quantity} disposed ${r.disposed_at}`); return false; }
	const key = dedupeKey(r);
	if (seen.has(key))  { console.log(`  [duplicate] ${r.asset_symbol} ${r.quantity} disposed ${r.disposed_at}`); return false; }
	seen.add(key);
	return true;
});

console.log(`After cleanup: ${cleanedRows.length} rows (removed ${result.rows.length - cleanedRows.length})`);

// ─── Split into short-term (Box C) and long-term (Box F) ─────────────────────
const shortTerm = cleanedRows.filter(r => Number(r.is_short_term) === 1);
const longTerm  = cleanedRows.filter(r => Number(r.is_short_term) !== 1);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const money = (n) => {
	if (n == null) return '—';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(n));
};

const fmtDate = (iso) => {
	if (!iso) return 'VARIOUS';
	try {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
	} catch { return iso; }
};

const sum = (rows, field) =>
	rows.reduce((s, r) => s + (r[field] != null ? Number(r[field]) : 0), 0);

// ─── Colors & layout constants ────────────────────────────────────────────────
const BLACK   = '#0d0d0d';
const GRAY    = '#444444';
const LGRAY   = '#888888';
const RED     = '#c0392b';
const GREEN   = '#16a085';
const ACCENT  = '#1a3a5c';
const LINE    = '#bbbbbb';
const HLITE   = '#f0f4f8'; // alternating row bg

// Column widths for the 8949 table (points)
const COLS = {
	desc:     130,  // (a) Description
	acquired:  62,  // (b) Date Acquired
	sold:      62,  // (c) Date Sold
	proceeds:  68,  // (d) Proceeds
	basis:     68,  // (e) Cost Basis
	codes:     28,  // (f) Code
	adj:       52,  // (g) Adjustment
	gain:      68,  // (h) Gain/Loss
};
const COL_TOTAL = Object.values(COLS).reduce((a, b) => a + b, 0); // ~538
const LEFT_MARGIN = 36;
const ROW_H = 14;
const HEADER_H = 18;

// ─── PDF setup ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, `../form-8949-${year}-clean.pdf`);
const doc = new PDFDocument({ margin: 36, size: 'LETTER', autoFirstPage: true });
doc.pipe(createWriteStream(outPath));

let pageNum = 0;

// ─── Draw page header ─────────────────────────────────────────────────────────
const drawPageHeader = (part, box, term, pageLabel) => {
	pageNum++;
	if (pageNum > 1) doc.addPage();

	doc.fontSize(14).fillColor(ACCENT).font('Helvetica-Bold')
		.text('Form 8949', LEFT_MARGIN, 36, { continued: true });
	doc.fontSize(10).fillColor(GRAY).font('Helvetica')
		.text(`  Sales and Other Dispositions of Capital Assets`, { continued: false });

	doc.fontSize(9).fillColor(GRAY).font('Helvetica')
		.text(`Tax Year ${year}  ·  Part ${part}  ·  Box ${box} — ${term}  ·  ${pageLabel}`, LEFT_MARGIN, 54);

	doc.fontSize(8).fillColor(LGRAY).font('Helvetica')
		.text(
			box === 'C' || box === 'F'
				? `Check Box ${box}: All other — basis NOT reported to IRS (no 1099-B issued)`
				: `Check Box ${box}`,
			LEFT_MARGIN, 66
		);

	doc.moveTo(LEFT_MARGIN, 78).lineTo(LEFT_MARGIN + COL_TOTAL, 78)
		.strokeColor(ACCENT).lineWidth(1).stroke();
};

// ─── Draw column headers ──────────────────────────────────────────────────────
const drawTableHeader = (y) => {
	const headers = [
		['(a) Description of property', COLS.desc],
		['(b) Date\nacquired', COLS.acquired],
		['(c) Date\nsold', COLS.sold],
		['(d) Proceeds\n(sales price)', COLS.proceeds],
		['(e) Cost or\nother basis', COLS.basis],
		['(f)\nCode', COLS.codes],
		['(g)\nAdjust.', COLS.adj],
		['(h) Gain or (loss)', COLS.gain],
	];

	doc.rect(LEFT_MARGIN, y, COL_TOTAL, HEADER_H + 2).fillColor('#dce6f0').fill();

	let x = LEFT_MARGIN;
	for (const [label, w] of headers) {
		doc.fontSize(6.5).fillColor(ACCENT).font('Helvetica-Bold')
			.text(label, x + 2, y + 2, { width: w - 4, lineGap: 0 });
		x += w;
	}

	// vertical dividers
	x = LEFT_MARGIN;
	for (const [, w] of headers) {
		x += w;
		doc.moveTo(x, y).lineTo(x, y + HEADER_H + 2).strokeColor(LINE).lineWidth(0.4).stroke();
	}
	doc.moveTo(LEFT_MARGIN, y + HEADER_H + 2).lineTo(LEFT_MARGIN + COL_TOTAL, y + HEADER_H + 2)
		.strokeColor(ACCENT).lineWidth(0.6).stroke();

	return y + HEADER_H + 2;
};

// ─── Draw one data row ────────────────────────────────────────────────────────
const drawRow = (row, y, rowIdx) => {
	const isEven = rowIdx % 2 === 0;
	if (isEven) {
		doc.rect(LEFT_MARGIN, y, COL_TOTAL, ROW_H).fillColor(HLITE).fill();
	}

	const proceeds = row.proceeds_usd != null ? Number(row.proceeds_usd) : null;
	const basis    = row.cost_basis_usd != null ? Number(row.cost_basis_usd) : null;
	const gainLoss = row.gain_loss_usd != null ? Number(row.gain_loss_usd) : (proceeds != null && basis != null ? proceeds - basis : null);
	const hasNoBasis = basis == null;
	const qty      = Number(row.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 });
	const desc     = `${qty} ${row.asset_symbol}`;

	const cells = [
		[desc,                       COLS.desc,     'left',   BLACK],
		[fmtDate(row.acquired_at),   COLS.acquired, 'center', GRAY],
		[fmtDate(row.disposed_at),   COLS.sold,     'center', GRAY],
		[proceeds != null ? money(proceeds) : '—', COLS.proceeds, 'right', BLACK],
		[basis    != null ? money(basis)    : '—', COLS.basis,    'right', hasNoBasis ? RED : BLACK],
		[hasNoBasis ? 'BO' : '',     COLS.codes,    'center', RED],
		['—',                        COLS.adj,      'center', LGRAY],
		[gainLoss != null ? money(gainLoss) : '—', COLS.gain, 'right',
			gainLoss == null ? LGRAY : gainLoss < 0 ? RED : GREEN],
	];

	let x = LEFT_MARGIN;
	for (const [val, w, align, color] of cells) {
		doc.fontSize(6.8).fillColor(color).font('Helvetica')
			.text(String(val), x + 2, y + 3, { width: w - 4, align, lineBreak: false });
		doc.moveTo(x + w, y).lineTo(x + w, y + ROW_H).strokeColor(LINE).lineWidth(0.3).stroke();
		x += w;
	}

	doc.moveTo(LEFT_MARGIN, y + ROW_H).lineTo(LEFT_MARGIN + COL_TOTAL, y + ROW_H)
		.strokeColor(LINE).lineWidth(0.3).stroke();
};

// ─── Draw totals row ──────────────────────────────────────────────────────────
const drawTotals = (rows, y) => {
	const totalProceeds = sum(rows, 'proceeds_usd');
	const totalBasis    = sum(rows, 'cost_basis_usd');
	const totalGain     = sum(rows, 'gain_loss_usd');

	doc.rect(LEFT_MARGIN, y, COL_TOTAL, ROW_H + 2).fillColor('#dce6f0').fill();

	const label = `Totals (${rows.length} transactions)`;
	doc.fontSize(7).fillColor(ACCENT).font('Helvetica-Bold')
		.text(label, LEFT_MARGIN + 2, y + 3, { width: COLS.desc + COLS.acquired + COLS.sold - 4, align: 'left' });

	const totX = LEFT_MARGIN + COLS.desc + COLS.acquired + COLS.sold;
	doc.fontSize(7).fillColor(BLACK).font('Helvetica-Bold')
		.text(money(totalProceeds), totX + 2, y + 3, { width: COLS.proceeds - 4, align: 'right' });

	doc.fontSize(7).fillColor(BLACK).font('Helvetica-Bold')
		.text(money(totalBasis), totX + COLS.proceeds + 2, y + 3, { width: COLS.basis - 4, align: 'right' });

	const gainColor = totalGain < 0 ? RED : GREEN;
	doc.fontSize(7).fillColor(gainColor).font('Helvetica-Bold')
		.text(money(totalGain), totX + COLS.proceeds + COLS.basis + COLS.codes + COLS.adj + 2, y + 3,
			{ width: COLS.gain - 4, align: 'right' });

	doc.moveTo(LEFT_MARGIN, y + ROW_H + 2).lineTo(LEFT_MARGIN + COL_TOTAL, y + ROW_H + 2)
		.strokeColor(ACCENT).lineWidth(1).stroke();
};

// ─── Render a section (Box C or Box F) ───────────────────────────────────────
const ROWS_PER_PAGE = Math.floor((doc.page.height - 36 - 90 - (ROW_H + 2) - (ROW_H + 2)) / ROW_H);

const renderSection = (rows, part, box, term, termLabel) => {
	if (!rows.length) return;

	const totalPages = Math.ceil(rows.length / ROWS_PER_PAGE);

	for (let p = 0; p < totalPages; p++) {
		const slice = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
		const pageLabel = totalPages > 1 ? `Page ${p + 1} of ${totalPages}` : '';

		drawPageHeader(part, box, termLabel, pageLabel);

		let y = drawTableHeader(82);

		slice.forEach((row, i) => {
			drawRow(row, y, p * ROWS_PER_PAGE + i);
			y += ROW_H;
		});

		// Totals only on the last page of this section
		if (p === totalPages - 1) {
			drawTotals(rows, y + 4);
		}
	}
};

// ─── Render both sections ─────────────────────────────────────────────────────
renderSection(shortTerm, 'I',  'C', 'short', 'Short-term — held ≤ 1 year');
renderSection(longTerm,  'II', 'F', 'long',  'Long-term — held > 1 year');

// ─── Final summary page ───────────────────────────────────────────────────────
pageNum++;
doc.addPage();

doc.fontSize(14).fillColor(ACCENT).font('Helvetica-Bold')
	.text('Schedule D Summary', LEFT_MARGIN, 36);
doc.fontSize(9).fillColor(GRAY).font('Helvetica')
	.text(`Tax Year ${year}  ·  Transfer totals from Form 8949 to Schedule D`, LEFT_MARGIN, 54);
doc.moveTo(LEFT_MARGIN, 68).lineTo(LEFT_MARGIN + COL_TOTAL, 68)
	.strokeColor(ACCENT).lineWidth(1).stroke();

const stProceeds = sum(shortTerm, 'proceeds_usd');
const stBasis    = sum(shortTerm, 'cost_basis_usd');
const stGain     = sum(shortTerm, 'gain_loss_usd');
const ltProceeds = sum(longTerm,  'proceeds_usd');
const ltBasis    = sum(longTerm,  'cost_basis_usd');
const ltGain     = sum(longTerm,  'gain_loss_usd');
const netGain    = stGain + ltGain;

const summaryRows = [
	['Part I — Short-Term (Box C)',  stProceeds, stBasis, stGain,  shortTerm.length],
	['Part II — Long-Term (Box F)',  ltProceeds, ltBasis, ltGain,  longTerm.length],
];

let sy = 84;

// Header
doc.rect(LEFT_MARGIN, sy, COL_TOTAL, 16).fillColor('#dce6f0').fill();
for (const [label, x] of [
	['Section', 0], ['Proceeds (d)', 220], ['Basis (e)', 300], ['Gain/Loss (h)', 380], ['Tx Count', 460],
]) {
	doc.fontSize(7.5).fillColor(ACCENT).font('Helvetica-Bold')
		.text(label, LEFT_MARGIN + x + 2, sy + 4, { width: 80, align: x === 0 ? 'left' : 'right' });
}
sy += 16;

for (const [label, proceeds, basis, gain, count] of summaryRows) {
	const gc = gain < 0 ? RED : GREEN;
	doc.rect(LEFT_MARGIN, sy, COL_TOTAL, 20).fillColor(sy % 40 === 0 ? HLITE : '#ffffff').fill();

	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica-Bold')
		.text(label, LEFT_MARGIN + 2, sy + 5, { width: 215 });
	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica')
		.text(money(proceeds), LEFT_MARGIN + 222, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica')
		.text(money(basis),    LEFT_MARGIN + 302, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(gc).font('Helvetica-Bold')
		.text(money(gain),     LEFT_MARGIN + 382, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(LGRAY).font('Helvetica')
		.text(String(count),   LEFT_MARGIN + 462, sy + 5, { width: 50, align: 'right' });

	doc.moveTo(LEFT_MARGIN, sy + 20).lineTo(LEFT_MARGIN + COL_TOTAL, sy + 20)
		.strokeColor(LINE).lineWidth(0.4).stroke();
	sy += 20;
}

// Net total row
sy += 6;
doc.rect(LEFT_MARGIN, sy, COL_TOTAL, 22).fillColor(ACCENT).fill();
doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold')
	.text('Net Realized Gain / Loss', LEFT_MARGIN + 2, sy + 6, { width: 215 });
doc.fontSize(9).fillColor(netGain < 0 ? '#ffb3b3' : '#b3ffe8').font('Helvetica-Bold')
	.text(money(netGain), LEFT_MARGIN + 382, sy + 6, { width: 75, align: 'right' });
sy += 22;

// Notes box
sy += 24;
doc.fontSize(9).fillColor(ACCENT).font('Helvetica-Bold').text('Filing notes:', LEFT_MARGIN, sy);
sy += 14;
const notes = [
	`• Box C transactions (${shortTerm.length} short-term): no 1099-B was issued — select "I'll enter a summary" in TurboTax and attach this PDF.`,
	`• Box F transactions (${longTerm.length} long-term): same as above.`,
	`• "BO" code in column (f) means cost basis was not reported to the IRS.`,
	`• Net capital loss of ${money(Math.abs(netGain))} may offset up to $3,000 of ordinary income in ${year}; remainder carries to ${year + 1}.`,
	`• Carry forward: if loss exceeds $3,000, track the carryforward amount on Schedule D line 6/14.`,
];
for (const note of notes) {
	doc.fontSize(8.5).fillColor(GRAY).font('Helvetica')
		.text(note, LEFT_MARGIN, sy, { width: COL_TOTAL });
	sy += 16;
}

// Disclaimer
sy += 16;
doc.fontSize(7.5).fillColor(LGRAY).font('Helvetica')
	.text(
		`This document is generated from almsTins tax pipeline data for tenant ${tenantId}. ` +
		`It is not a certified tax form — verify with your tax professional before filing. ` +
		`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
		LEFT_MARGIN, sy, { width: COL_TOTAL }
	);

doc.end();

db.close();
console.log(`\nForm 8949 PDF written to: ${outPath}`);
console.log(`  Short-term (Box C): ${shortTerm.length} rows — gain/loss: ${money(stGain)}`);
console.log(`  Long-term  (Box F): ${longTerm.length} rows — gain/loss: ${money(ltGain)}`);
console.log(`  Net: ${money(netGain)}`);
