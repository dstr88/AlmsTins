import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '../almsTins-2025-tax-summary.pdf');

const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
doc.pipe(createWriteStream(outPath));

// ─── Colors & helpers ───────────────────────────────────────────────────────
const BLACK   = '#0d0d0d';
const GRAY    = '#555555';
const LGRAY   = '#888888';
const RED     = '#c0392b';
const GREEN   = '#16a085';
const ACCENT  = '#2c3e50';
const LINE    = '#cccccc';

const W = doc.page.width - 120; // usable width

const hr = (y) => {
	doc.moveTo(60, y).lineTo(60 + W, y).strokeColor(LINE).lineWidth(0.5).stroke();
};

const money = (n) =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ─── Header ─────────────────────────────────────────────────────────────────
doc.fontSize(22).fillColor(ACCENT).font('Helvetica-Bold')
	.text('2025 Crypto Tax Summary', 60, 60);

doc.fontSize(10).fillColor(GRAY).font('Helvetica')
	.text('Prepared from almsTins Year-End Report  ·  Tax Year 2025', 60, 90);

doc.fontSize(9).fillColor(LGRAY)
	.text('For manual entry into TurboTax, H&R Block, or with a tax preparer.', 60, 105)
	.text('This document is not a substitute for professional tax advice.', 60, 118);

hr(140);

// ─── Summary boxes ──────────────────────────────────────────────────────────
const boxY = 155;
const boxH = 68;
const boxW = (W - 24) / 3;

const drawBox = (x, label, value, valueColor, sub) => {
	doc.roundedRect(x, boxY, boxW, boxH, 4)
		.strokeColor(LINE).lineWidth(0.8).stroke();

	doc.fontSize(8).fillColor(LGRAY).font('Helvetica')
		.text(label.toUpperCase(), x + 10, boxY + 10, { width: boxW - 20 });

	doc.fontSize(18).fillColor(valueColor).font('Helvetica-Bold')
		.text(value, x + 10, boxY + 24, { width: boxW - 20 });

	doc.fontSize(8).fillColor(LGRAY).font('Helvetica')
		.text(sub, x + 10, boxY + 50, { width: boxW - 20 });
};

drawBox(60,              'Short-Term Gain / Loss', money(-391.61), RED,   '126 disposal events  ·  held ≤ 1 year');
drawBox(60 + boxW + 12, 'Long-Term Gain / Loss',  money(148.22),  GREEN, '171 disposal events  ·  held > 1 year');
drawBox(60 + (boxW + 12) * 2, 'Income / Rewards', money(27.13),   ACCENT,'227 events  ·  staking, rewards, airdrops');

hr(boxY + boxH + 14);

// ─── Net section ────────────────────────────────────────────────────────────
const netY = boxY + boxH + 30;

doc.fontSize(11).fillColor(BLACK).font('Helvetica-Bold')
	.text('Net Realized Gain / Loss', 60, netY);
doc.fontSize(11).fillColor(RED).font('Helvetica-Bold')
	.text(money(-243.38), 60, netY, { align: 'right', width: W });

doc.fontSize(9).fillColor(LGRAY).font('Helvetica')
	.text('Short-term (-$391.61) + Long-term (+$148.22) = -$243.38', 60, netY + 16);

hr(netY + 36);

// ─── TurboTax entry guide ───────────────────────────────────────────────────
const guideY = netY + 52;

doc.fontSize(13).fillColor(ACCENT).font('Helvetica-Bold')
	.text('How to Enter in TurboTax', 60, guideY);

const steps = [
	['1', 'Federal Taxes → Wages & Income → Investment Income → Stocks, Crypto, Mutual Funds, Bonds, Other'],
	['2', "Select \"I'll type it in myself\" (manual entry)"],
	['3', 'Short-term transactions (held ≤ 1 year)\n   Box A  — proceeds & cost basis reported to IRS\n   OR\n   Box C  — proceeds & cost basis NOT reported to IRS\n   Net total: -$391.61  (126 trades)'],
	['4', 'Long-term transactions (held > 1 year)\n   Box D  — proceeds & cost basis reported to IRS\n   OR\n   Box F  — proceeds & cost basis NOT reported to IRS\n   Net total: +$148.22  (171 trades)'],
	['5', 'Income & Rewards → Cryptocurrency → "Other"\n   Report $27.13 as ordinary income (staking / rewards / airdrops)'],
	['6', 'Confirm Schedule D summary matches:\n   Short-term: -$391.61  ·  Long-term: +$148.22  ·  Net: -$243.38'],
];

let sy = guideY + 22;
for (const [num, text] of steps) {
	const before = doc.y;
	doc.fontSize(9).fillColor(ACCENT).font('Helvetica-Bold')
		.text(`Step ${num}`, 60, sy, { continued: false, width: 50 });
	doc.fontSize(9).fillColor(BLACK).font('Helvetica')
		.text(text, 116, sy, { width: W - 56 });
	sy = doc.y + 8;
}

hr(sy + 4);

// ─── Open Lots ──────────────────────────────────────────────────────────────
const openY = sy + 18;

doc.fontSize(13).fillColor(ACCENT).font('Helvetica-Bold')
	.text('Open Positions (Not Yet Sold)', 60, openY);

doc.fontSize(9).fillColor(GRAY).font('Helvetica')
	.text(
		'These are unrealized — no tax owed until sold. They will carry forward to 2026.',
		60, openY + 18, { width: W }
	);

const openData = [
	['Open Lots', '765'],
	['Total Cost Basis', money(51_740.78)],
	['Estimated Unrealized P&L', 'See almsTins report for current market value'],
];

let oy = openY + 36;
for (const [label, val] of openData) {
	doc.fontSize(9).fillColor(LGRAY).font('Helvetica').text(label, 60, oy, { width: 200 });
	doc.fontSize(9).fillColor(BLACK).font('Helvetica-Bold').text(val, 270, oy, { width: W - 210 });
	oy += 16;
}

hr(oy + 8);

// ─── Disclaimer ─────────────────────────────────────────────────────────────
doc.fontSize(8).fillColor(LGRAY).font('Helvetica')
	.text(
		'Disclaimer: This summary was compiled from the almsTins 2025 Year-End Report. ' +
		'It is provided for informational purposes only and does not constitute tax, legal, or financial advice. ' +
		'Verify all figures with your full transaction history before filing. ' +
		'Generated ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '.',
		60, oy + 22, { width: W }
	);

doc.end();

console.log(`PDF written to: ${outPath}`);
