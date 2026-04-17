/**
 * generate-form8949.ts
 *
 * Generates a Form 8949-style PDF by calling buildAnnualBreakdown directly.
 *
 * Usage:
 *   cd /path/to/interestTracker
 *   npx tsx --env-file=.env scripts/generate-form8949.ts [year]
 */

// @ts-nocheck
import { buildAnnualBreakdown } from '../src/lib/annualBreakdown';
import { createClient } from '@libsql/client';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const year = Number(process.argv[2] ?? 2025);

// ─── Find the tenant ──────────────────────────────────────────────────────────
const db = createClient({
	url:       process.env.TURSO_DATABASE_URL!,
	authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Pick the tenant with the most lifecycle activity (excluding demo)
const tenantRes = await db.execute({
	sql: `
		SELECT tenant_id, COUNT(*) as n
		FROM asset_lifecycle_events
		WHERE tenant_id != 'demo-00000000000000000000000000000001'
		GROUP BY tenant_id
		ORDER BY n DESC
		LIMIT 1
	`,
	args: [],
});

if (!tenantRes.rows.length) {
	console.error('No lifecycle events found.');
	process.exit(1);
}

const tenantId = tenantRes.rows[0].tenant_id as string;
db.close();
console.log(`Tenant: ${tenantId}`);
console.log(`Building FIFO breakdown for ${year}...`);

// ─── Build FIFO breakdown ─────────────────────────────────────────────────────
const bd = await buildAnnualBreakdown(tenantId, year, 'fifo', undefined, 'auto');

console.log(`Short-term: ${bd.shortTerm.length} lots`);
console.log(`Long-term:  ${bd.longTerm.length} lots`);
console.log(`Income:     ${bd.income.length} events`);

if (!bd.shortTerm.length && !bd.longTerm.length) {
	console.error(`No settled lots found for ${year}. Check that transactions exist for this year.`);
	process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (n: number | null | undefined): string => {
	if (n == null) return '—';
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
};

const fmtDate = (iso: string | null | undefined): string => {
	if (!iso) return 'VARIOUS';
	try {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
	} catch { return iso; }
};

const sumLots = (lots: typeof bd.shortTerm, field: 'costUsd' | 'proceedsUsd' | 'gainLossUsd') =>
	lots.reduce((s, l) => s + (l[field] ?? 0), 0);

// ─── Colors & layout ──────────────────────────────────────────────────────────
const BLACK  = '#0d0d0d';
const GRAY   = '#444444';
const LGRAY  = '#888888';
const RED    = '#c0392b';
const GREEN  = '#16a085';
const ACCENT = '#1a3a5c';
const LINE   = '#bbbbbb';
const HLITE  = '#f0f4f8';

const COLS = {
	desc:     130,
	acquired:  62,
	sold:      62,
	proceeds:  68,
	basis:     68,
	codes:     28,
	adj:       52,
	gain:      68,
};
const COL_TOTAL = Object.values(COLS).reduce((a, b) => a + b, 0);
const LEFT = 36;
const ROW_H = 14;
const HEADER_H = 18;

// ─── PDF setup ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, `../form-8949-${year}.pdf`);
const doc = new PDFDocument({ margin: 36, size: 'LETTER', autoFirstPage: true });
doc.pipe(createWriteStream(outPath));

let pageNum = 0;

const drawPageHeader = (part: string, box: string, termLabel: string, pageLabel: string) => {
	pageNum++;
	if (pageNum > 1) doc.addPage();

	doc.fontSize(14).fillColor(ACCENT).font('Helvetica-Bold')
		.text('Form 8949', LEFT, 36, { continued: true });
	doc.fontSize(10).fillColor(GRAY).font('Helvetica')
		.text('  Sales and Other Dispositions of Capital Assets');

	doc.fontSize(9).fillColor(GRAY).font('Helvetica')
		.text(`Tax Year ${year}  ·  Part ${part}  ·  Box ${box} — ${termLabel}  ·  ${pageLabel}`, LEFT, 54);

	doc.fontSize(8).fillColor(LGRAY).font('Helvetica')
		.text(
			`Check Box ${box}: All other — basis NOT reported to IRS (no 1099-B issued)`,
			LEFT, 66,
		);

	doc.moveTo(LEFT, 78).lineTo(LEFT + COL_TOTAL, 78)
		.strokeColor(ACCENT).lineWidth(1).stroke();
};

const drawTableHeader = (y: number): number => {
	const headers: [string, number][] = [
		['(a) Description of property', COLS.desc],
		['(b) Date\nacquired', COLS.acquired],
		['(c) Date\nsold', COLS.sold],
		['(d) Proceeds\n(sales price)', COLS.proceeds],
		['(e) Cost or\nother basis', COLS.basis],
		['(f)\nCode', COLS.codes],
		['(g)\nAdjust.', COLS.adj],
		['(h) Gain or (loss)', COLS.gain],
	];

	doc.rect(LEFT, y, COL_TOTAL, HEADER_H + 2).fillColor('#dce6f0').fill();

	let x = LEFT;
	for (const [label, w] of headers) {
		doc.fontSize(6.5).fillColor(ACCENT).font('Helvetica-Bold')
			.text(label, x + 2, y + 2, { width: w - 4, lineGap: 0 });
		x += w;
	}

	x = LEFT;
	for (const [, w] of headers) {
		x += w;
		doc.moveTo(x, y).lineTo(x, y + HEADER_H + 2).strokeColor(LINE).lineWidth(0.4).stroke();
	}
	doc.moveTo(LEFT, y + HEADER_H + 2).lineTo(LEFT + COL_TOTAL, y + HEADER_H + 2)
		.strokeColor(ACCENT).lineWidth(0.6).stroke();

	return y + HEADER_H + 2;
};

const drawRow = (lot: typeof bd.shortTerm[0], y: number, rowIdx: number) => {
	if (rowIdx % 2 === 0) {
		doc.rect(LEFT, y, COL_TOTAL, ROW_H).fillColor(HLITE).fill();
	}

	const proceeds  = lot.proceedsUsd ?? 0;
	const basis     = lot.costUsd ?? 0;
	const gainLoss  = lot.gainLossUsd ?? (proceeds - basis);
	const noBasis   = lot.costUsd == null;
	const qty       = lot.amount.toLocaleString('en-US', { maximumFractionDigits: 6 });
	const desc      = `${qty} ${lot.asset}`;

	const cells: [string, number, string, string][] = [
		[desc,                   COLS.desc,     'left',   BLACK],
		[fmtDate(lot.buyDate),   COLS.acquired, 'center', GRAY],
		[fmtDate(lot.sellDate),  COLS.sold,     'center', GRAY],
		[money(proceeds),        COLS.proceeds, 'right',  BLACK],
		[money(basis),           COLS.basis,    'right',  noBasis ? RED : BLACK],
		[noBasis ? 'BO' : '',    COLS.codes,    'center', RED],
		['—',                    COLS.adj,      'center', LGRAY],
		[money(gainLoss),        COLS.gain,     'right',  gainLoss < 0 ? RED : GREEN],
	];

	let x = LEFT;
	for (const [val, w, align, color] of cells) {
		doc.fontSize(6.8).fillColor(color).font('Helvetica')
			.text(val, x + 2, y + 3, { width: w - 4, align: align as any, lineBreak: false });
		doc.moveTo(x + w, y).lineTo(x + w, y + ROW_H).strokeColor(LINE).lineWidth(0.3).stroke();
		x += w;
	}

	doc.moveTo(LEFT, y + ROW_H).lineTo(LEFT + COL_TOTAL, y + ROW_H)
		.strokeColor(LINE).lineWidth(0.3).stroke();
};

const drawTotals = (lots: typeof bd.shortTerm, y: number) => {
	const tp = sumLots(lots, 'proceedsUsd');
	const tb = sumLots(lots, 'costUsd');
	const tg = sumLots(lots, 'gainLossUsd');

	doc.rect(LEFT, y, COL_TOTAL, ROW_H + 2).fillColor('#dce6f0').fill();

	const skipW = COLS.desc + COLS.acquired + COLS.sold;
	doc.fontSize(7).fillColor(ACCENT).font('Helvetica-Bold')
		.text(`Totals (${lots.length} transactions)`, LEFT + 2, y + 3, { width: skipW - 4 });

	let x = LEFT + skipW;
	const totals: [string, number, string][] = [
		[money(tp), COLS.proceeds, BLACK],
		[money(tb), COLS.basis,    BLACK],
		['—',        COLS.codes,   LGRAY],
		['—',        COLS.adj,     LGRAY],
		[money(tg), COLS.gain,    tg < 0 ? RED : GREEN],
	];
	for (const [val, w, color] of totals) {
		doc.fontSize(7).fillColor(color).font('Helvetica-Bold')
			.text(val, x + 2, y + 3, { width: w - 4, align: 'right' });
		x += w;
	}

	doc.moveTo(LEFT, y + ROW_H + 2).lineTo(LEFT + COL_TOTAL, y + ROW_H + 2)
		.strokeColor(ACCENT).lineWidth(1).stroke();
};

// ─── Render section ───────────────────────────────────────────────────────────
const USABLE_H = (doc.page.height as number) - 36 - 90;
const ROWS_PER_PAGE = Math.floor((USABLE_H - (HEADER_H + 2) - (ROW_H + 2)) / ROW_H);

const renderSection = (lots: typeof bd.shortTerm, part: string, box: string, termLabel: string) => {
	if (!lots.length) return;
	const totalPages = Math.ceil(lots.length / ROWS_PER_PAGE);

	for (let p = 0; p < totalPages; p++) {
		const slice = lots.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
		const pageLabel = totalPages > 1 ? `Page ${p + 1} of ${totalPages}` : '';

		drawPageHeader(part, box, termLabel, pageLabel);
		let y = drawTableHeader(82);

		slice.forEach((lot, i) => {
			drawRow(lot, y, p * ROWS_PER_PAGE + i);
			y += ROW_H;
		});

		if (p === totalPages - 1) {
			drawTotals(lots, y + 4);
		}
	}
};

renderSection(bd.shortTerm, 'I',  'C', 'Short-term — held ≤ 1 year');
renderSection(bd.longTerm,  'II', 'F', 'Long-term — held > 1 year');

// ─── Summary page ─────────────────────────────────────────────────────────────
pageNum++;
doc.addPage();

doc.fontSize(14).fillColor(ACCENT).font('Helvetica-Bold')
	.text('Schedule D Summary', LEFT, 36);
doc.fontSize(9).fillColor(GRAY).font('Helvetica')
	.text(`Tax Year ${year}  ·  Transfer totals from Form 8949 to Schedule D`, LEFT, 54);
doc.moveTo(LEFT, 68).lineTo(LEFT + COL_TOTAL, 68).strokeColor(ACCENT).lineWidth(1).stroke();

const stP = sumLots(bd.shortTerm, 'proceedsUsd');
const stB = sumLots(bd.shortTerm, 'costUsd');
const stG = sumLots(bd.shortTerm, 'gainLossUsd');
const ltP = sumLots(bd.longTerm,  'proceedsUsd');
const ltB = sumLots(bd.longTerm,  'costUsd');
const ltG = sumLots(bd.longTerm,  'gainLossUsd');
const net = stG + ltG;

let sy = 84;

// Header
doc.rect(LEFT, sy, COL_TOTAL, 16).fillColor('#dce6f0').fill();
for (const [label, x] of [['Section', 0], ['Proceeds', 220], ['Basis', 300], ['Gain/Loss', 380], ['Count', 460]] as [string, number][]) {
	doc.fontSize(7.5).fillColor(ACCENT).font('Helvetica-Bold')
		.text(label, LEFT + x + 2, sy + 4, { width: 78, align: x === 0 ? 'left' : 'right' });
}
sy += 16;

for (const [label, p, b, g, count] of [
	['Part I — Short-Term (Box C)',  stP, stB, stG, bd.shortTerm.length],
	['Part II — Long-Term  (Box F)', ltP, ltB, ltG, bd.longTerm.length],
] as [string, number, number, number, number][]) {
	const gc = g < 0 ? RED : GREEN;
	doc.rect(LEFT, sy, COL_TOTAL, 20).fillColor(sy % 40 === 0 ? HLITE : '#ffffff').fill();
	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica-Bold')
		.text(label, LEFT + 2, sy + 5, { width: 215 });
	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica')
		.text(money(p), LEFT + 222, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(BLACK).font('Helvetica')
		.text(money(b), LEFT + 302, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(gc).font('Helvetica-Bold')
		.text(money(g), LEFT + 382, sy + 5, { width: 75, align: 'right' });
	doc.fontSize(8.5).fillColor(LGRAY).font('Helvetica')
		.text(String(count), LEFT + 462, sy + 5, { width: 50, align: 'right' });
	doc.moveTo(LEFT, sy + 20).lineTo(LEFT + COL_TOTAL, sy + 20).strokeColor(LINE).lineWidth(0.4).stroke();
	sy += 20;
}

sy += 6;
doc.rect(LEFT, sy, COL_TOTAL, 22).fillColor(ACCENT).fill();
doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold')
	.text('Net Realized Gain / Loss', LEFT + 2, sy + 6, { width: 215 });
doc.fontSize(9).fillColor(net < 0 ? '#ffb3b3' : '#b3ffe8').font('Helvetica-Bold')
	.text(money(net), LEFT + 382, sy + 6, { width: 75, align: 'right' });
sy += 22;

sy += 24;
doc.fontSize(9).fillColor(ACCENT).font('Helvetica-Bold').text('Filing notes:', LEFT, sy);
sy += 14;
const notes = [
	`• Box C transactions (${bd.shortTerm.length} short-term): select "I'll enter a summary" in TurboTax, then attach this PDF.`,
	`• Box F transactions (${bd.longTerm.length} long-term): same as above.`,
	`• "BO" in column (f) means cost basis was not reported to the IRS.`,
	net < 0
		? `• Net capital loss of ${money(Math.abs(net))} may offset up to $3,000 of ordinary income in ${year}; remainder carries to ${year + 1}.`
		: `• Net capital gain of ${money(net)} — enter on Schedule D line 1a (short-term) and line 8a (long-term).`,
];
for (const note of notes) {
	doc.fontSize(8.5).fillColor(GRAY).font('Helvetica')
		.text(note, LEFT, sy, { width: COL_TOTAL });
	sy += 16;
}

sy += 16;
doc.fontSize(7.5).fillColor(LGRAY).font('Helvetica')
	.text(
		`This document is generated from almsTins tax pipeline data (FIFO method). ` +
		`It is not a certified tax form — verify all figures with your tax professional before filing. ` +
		`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
		LEFT, sy, { width: COL_TOTAL },
	);

doc.end();
console.log(`\nForm 8949 PDF → ${outPath}`);
console.log(`  Short-term (Box C): ${bd.shortTerm.length} lots  |  gain/loss: ${money(stG)}`);
console.log(`  Long-term  (Box F): ${bd.longTerm.length} lots  |  gain/loss: ${money(ltG)}`);
console.log(`  Net: ${money(net)}`);
