/**
 * GET /api/annual-records/report?year=2024
 *
 * Generates an Annual Records PDF for the requested calendar year — owner-only, international-friendly.
 * No tax-form references, generic descriptive section names.
 *
 * Sections:
 *   1. Cover — year, generated date, ownership note
 *   2. Summary — gains/losses by holding period, income, held cost basis
 *   3. Disposals — Less than 1 year
 *   4. Disposals — More than 1 year
 *   5. Income & Inflows
 *   6. Open Positions
 */

import type { APIRoute } from 'astro';
import PDFDocument from 'pdfkit';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { buildAnnualBreakdown, type AnnualBreakdownSource } from '@/lib/annualBreakdown';
import { isOwner } from '@/lib/owner';

export const prerender = false;

// ── Colour palette ────────────────────────────────────────────────────────────
const SALMON   = '#c0392b';
const DARK_BG  = '#1a1a1a';
const HEADING  = '#000000';   // true black
const BODY     = '#000000';   // true black
const LABEL    = '#333333';   // dark gray labels
const ALT_ROW  = '#f5f5f5';   // light alternate rows
const RULE     = '#bbbbbb';   // divider lines
const POS      = '#15803d';
const NEG      = '#b91c1c';

// legacy aliases
const MID_GRAY = LABEL;
const LIGHT    = BODY;
const WHITE    = HEADING;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso; }
}

function fUsd(v: number | null, showSign = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = showSign ? (v >= 0 ? '+' : '-') : (v < 0 ? '-' : '');
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

function fQty(v: number): string {
  return Number.isFinite(v)
    ? v.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : '—';
}

// ── PDF builder ───────────────────────────────────────────────────────────────
function buildPdf(
  bd: Awaited<ReturnType<typeof buildAnnualBreakdown>>,
  year: number,
  tenantLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: {
        Title: `${year} Annual Records — almsTins`,
        Author: 'almsTins',
        Creator: 'almsTins',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width;
    const MARGIN = 52;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ── helpers ──────────────────────────────────────────────────────────────
    const newPage = () => {
      doc.addPage();
      drawPageHeader();
    };

    const drawPageHeader = () => {
      doc
        .rect(0, 0, PAGE_W, 32)
        .fill(DARK_BG);
      doc
        .fontSize(8)
        .fillColor(SALMON)
        .font('Helvetica-Bold')
        .text('almsTins', MARGIN, 10, { continued: true })
        .fillColor(MID_GRAY)
        .font('Helvetica')
        .text(`  ·  ${year} Annual Records  ·  ${tenantLabel}`, { align: 'left' })
        .fillColor(MID_GRAY)
        .text(`Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
          MARGIN, 10, { align: 'right', width: CONTENT_W });
      doc.moveDown(2);
    };

    const sectionTitle = (title: string) => {
      if (doc.y > doc.page.height - 120) newPage();
      doc
        .moveDown(0.6)
        .rect(MARGIN, doc.y, CONTENT_W, 20)
        .fill('#2a2a2a');
      doc
        .fontSize(9)
        .fillColor(SALMON)
        .font('Helvetica-Bold')
        .text(title.toUpperCase(), MARGIN + 6, doc.y - 15)
        .moveDown(0.4);
    };

    const ROW_H   = 22;
    const HDR_H   = 24;

    const tableHeaders = (cols: { label: string; width: number; align?: 'left' | 'right' | 'center' }[]) => {
      const hdrY = doc.y;
      doc.rect(MARGIN, hdrY, CONTENT_W, HDR_H).fill('#eeeeee');
      let x = MARGIN;
      doc.fontSize(12).fillColor(HEADING).font('Helvetica-Bold');
      for (const col of cols) {
        // pin every header cell to the same Y
        doc.text(col.label, x + 4, hdrY + 6, { width: col.width - 8, align: col.align ?? 'left', lineBreak: false });
        x += col.width;
      }
      doc.y = hdrY + HDR_H + 2;
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor(RULE).lineWidth(0.75).stroke();
      doc.y += 3;
    };

    const tableRow = (
      cols: { label: string; width: number; align?: 'left' | 'right' | 'center'; color?: string }[],
      shade: boolean,
    ) => {
      if (doc.y > doc.page.height - 60) newPage();
      const rowY = doc.y;  // ← pin once, use for every cell
      if (shade) {
        doc.rect(MARGIN, rowY, CONTENT_W, ROW_H).fill(ALT_ROW);
      }
      let x = MARGIN;
      doc.fontSize(12).font('Helvetica-Bold');
      for (const col of cols) {
        doc
          .fillColor(col.color ?? BODY)
          .text(col.label, x + 4, rowY + 5, { width: col.width - 8, align: col.align ?? 'left', lineBreak: false });
        x += col.width;
      }
      // manually advance past the row — never let the loop drift doc.y
      doc.y = rowY + ROW_H;
    };

    const summaryRow = (label: string, value: string, valueColor = HEADING) => {
      const sy = doc.y;
      doc.fontSize(13).font('Helvetica-Bold')
        .fillColor(LABEL)
        .text(label, MARGIN, sy, { width: 340, lineBreak: false });
      doc.fillColor(valueColor)
        .text(value, MARGIN + 340, sy, { width: CONTENT_W - 340, align: 'right', lineBreak: false });
      doc.y = sy + 22;
    };

    // ── PAGE 1: Cover ─────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, doc.page.height).fill('#0d0d0d');

    doc
      .fontSize(36)
      .fillColor(SALMON)
      .font('Helvetica-Bold')
      .text('almsTins', MARGIN, 140);

    doc
      .fontSize(14)
      .fillColor(LIGHT)
      .font('Helvetica')
      .text(`${year} Year Summary`, MARGIN, doc.y + 8);

    doc
      .fontSize(10)
      .fillColor(MID_GRAY)
      .text(tenantLabel, MARGIN, doc.y + 4)
      .text(
        `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        MARGIN, doc.y + 2,
      );

    // Summary box
    const boxY = 300;
    doc.roundedRect(MARGIN, boxY, CONTENT_W, 160, 8).fill('#1a1a1a');

    const stGain = bd.totals.shortTermGain ?? 0;
    const ltGain = bd.totals.longTermGain ?? 0;
    const income = bd.totals.totalIncome ?? 0;
    const netGain = stGain + ltGain;

    doc
      .fontSize(10).fillColor(MID_GRAY).font('Helvetica')
      .text('Disposals — Less than 1 year', MARGIN + 20, boxY + 20, { width: 240, lineBreak: false })
      .fillColor(stGain >= 0 ? POS : NEG).font('Helvetica-Bold')
      .text(fUsd(stGain, true), MARGIN + 260, boxY + 20, { width: CONTENT_W - 280, align: 'right' });

    doc
      .fontSize(10).fillColor(MID_GRAY).font('Helvetica')
      .text('Disposals — More than 1 year', MARGIN + 20, boxY + 48, { width: 240, lineBreak: false })
      .fillColor(ltGain >= 0 ? POS : NEG).font('Helvetica-Bold')
      .text(fUsd(ltGain, true), MARGIN + 260, boxY + 48, { width: CONTENT_W - 280, align: 'right' });

    doc
      .fontSize(10).fillColor(MID_GRAY).font('Helvetica')
      .text('Income & Inflows', MARGIN + 20, boxY + 76, { width: 240, lineBreak: false })
      .fillColor(WHITE).font('Helvetica-Bold')
      .text(fUsd(income), MARGIN + 260, boxY + 76, { width: CONTENT_W - 280, align: 'right' });

    doc.moveTo(MARGIN + 20, boxY + 105).lineTo(MARGIN + CONTENT_W - 20, boxY + 105).strokeColor('#333').lineWidth(0.5).stroke();

    doc
      .fontSize(11).fillColor(MID_GRAY).font('Helvetica')
      .text('Net realized gain / loss', MARGIN + 20, boxY + 118, { width: 240, lineBreak: false })
      .fillColor(netGain >= 0 ? POS : NEG).font('Helvetica-Bold')
      .text(fUsd(netGain, true), MARGIN + 260, boxY + 118, { width: CONTENT_W - 280, align: 'right' });

    // Disclaimer
    doc
      .fontSize(7)
      .fillColor('#555555')
      .font('Helvetica')
      .text(
        'This Year Summary is generated from the transaction data you have provided to almsTins. ' +
        'It is intended to help you organise your records and is not financial or legal advice. ' +
        'almsTins is not a tax preparation service. Please consult a qualified accountant regarding your specific obligations.',
        MARGIN, doc.page.height - 80,
        { width: CONTENT_W, align: 'center' },
      );

    // ── PAGE 2: Summary ───────────────────────────────────────────────────────
    newPage();
    sectionTitle(`${year} Summary`);

    summaryRow('Disposals — Less than 1 year', fUsd(stGain, true), stGain >= 0 ? POS : NEG);
    summaryRow('Disposals — More than 1 year', fUsd(ltGain, true), ltGain >= 0 ? POS : NEG);
    summaryRow('Total received / earned', fUsd(income));
    summaryRow('Net realized gain / loss', fUsd(netGain, true), netGain >= 0 ? POS : NEG);
    summaryRow('Open lots — cost basis', fUsd(bd.totals.heldCostBasis));
    summaryRow('Disposals — Less than 1 year (count)', String(bd.shortTerm.length));
    summaryRow('Disposals — More than 1 year (count)', String(bd.longTerm.length));
    summaryRow('Income / reward events', String(bd.income.length));
    summaryRow('Still holding — open lots', String(bd.stillHolding.length));

    // ── PAGE 3+: Short-term disposals ─────────────────────────────────────────
    if (bd.shortTerm.length > 0) {
      newPage();
      sectionTitle('Disposals — Less than 1 year  (held < 365 days)');

      const cols = [
        { label: 'Asset',      width: 65  },
        { label: 'Acquired',   width: 95  },
        { label: 'Disposed',   width: 95  },
        { label: 'Days',       width: 48,  align: 'right' as const },
        { label: 'Qty',        width: 85,  align: 'right' as const },
        { label: 'Cost Basis', width: 100, align: 'right' as const },
        { label: 'Proceeds',   width: 100, align: 'right' as const },
        { label: 'Gain / Loss',width: 100, align: 'right' as const },
      ];
      tableHeaders(cols);

      bd.shortTerm.forEach((lot, i) => {
        const gain = lot.gainLossUsd ?? 0;
        tableRow([
          { label: lot.asset,            width: cols[0].width },
          { label: fDate(lot.buyDate),   width: cols[1].width },
          { label: fDate(lot.sellDate),  width: cols[2].width },
          { label: String(lot.daysHeld), width: cols[3].width, align: 'right' },
          { label: fQty(lot.amount),     width: cols[4].width, align: 'right' },
          { label: fUsd(lot.costUsd),    width: cols[5].width, align: 'right' },
          { label: fUsd(lot.proceedsUsd),width: cols[6].width, align: 'right' },
          { label: fUsd(gain, true),     width: cols[7].width, align: 'right', color: gain >= 0 ? POS : NEG },
        ], i % 2 === 1);
      });

      // subtotal
      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      summaryRow('Subtotal — Less than 1 year', fUsd(stGain, true), stGain >= 0 ? POS : NEG);
    }

    // ── Long-term disposals ───────────────────────────────────────────────────
    if (bd.longTerm.length > 0) {
      newPage();
      sectionTitle('Disposals — More than 1 year  (held ≥ 365 days)');

      const cols = [
        { label: 'Asset',      width: 65  },
        { label: 'Acquired',   width: 95  },
        { label: 'Disposed',   width: 95  },
        { label: 'Days',       width: 48,  align: 'right' as const },
        { label: 'Qty',        width: 85,  align: 'right' as const },
        { label: 'Cost Basis', width: 100, align: 'right' as const },
        { label: 'Proceeds',   width: 100, align: 'right' as const },
        { label: 'Gain / Loss',width: 100, align: 'right' as const },
      ];
      tableHeaders(cols);

      bd.longTerm.forEach((lot, i) => {
        const gain = lot.gainLossUsd ?? 0;
        tableRow([
          { label: lot.asset,            width: cols[0].width },
          { label: fDate(lot.buyDate),   width: cols[1].width },
          { label: fDate(lot.sellDate),  width: cols[2].width },
          { label: String(lot.daysHeld), width: cols[3].width, align: 'right' },
          { label: fQty(lot.amount),     width: cols[4].width, align: 'right' },
          { label: fUsd(lot.costUsd),    width: cols[5].width, align: 'right' },
          { label: fUsd(lot.proceedsUsd),width: cols[6].width, align: 'right' },
          { label: fUsd(gain, true),     width: cols[7].width, align: 'right', color: gain >= 0 ? POS : NEG },
        ], i % 2 === 1);
      });

      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      summaryRow('Subtotal — More than 1 year', fUsd(ltGain, true), ltGain >= 0 ? POS : NEG);
    }

    // ── Income & Inflows ─────────────────────────────────────────────────────
    if (bd.income.length > 0) {
      newPage();
      sectionTitle('Income & Inflows');

      const cols = [
        { label: 'Date',        width: 100 },
        { label: 'Asset',       width: 65  },
        { label: 'Type',        width: 193 },
        { label: 'Qty',         width: 110, align: 'right' as const },
        { label: 'Value',       width: 110, align: 'right' as const },
        { label: 'Description', width: 110 },
      ];
      tableHeaders(cols);

      bd.income.forEach((item, i) => {
        const typeLabel = item.kind
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim();
        tableRow([
          { label: fDate(item.date),          width: cols[0].width },
          { label: item.asset,                width: cols[1].width },
          { label: typeLabel,                 width: cols[2].width },
          { label: fQty(item.amount),         width: cols[3].width, align: 'right' },
          { label: fUsd(item.usdValue),       width: cols[4].width, align: 'right' },
          { label: item.description ?? '—',   width: cols[5].width, color: MID_GRAY },
        ], i % 2 === 1);
      });

      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      summaryRow('Total received / earned', fUsd(income));
    }

    // ── Still Holding ─────────────────────────────────────────────────────────
    if (bd.stillHolding.length > 0) {
      newPage();
      sectionTitle('Open Positions');

      const cols = [
        { label: 'Asset',      width: 90  },
        { label: 'Acquired',   width: 130 },
        { label: 'Days Held',  width: 85,  align: 'right' as const },
        { label: 'Qty',        width: 141, align: 'right' as const },
        { label: 'Cost Basis', width: 142, align: 'right' as const },
        { label: 'Term',       width: 100 },
      ];
      tableHeaders(cols);

      bd.stillHolding.forEach((lot, i) => {
        const term = lot.daysHeld >= 365 ? 'Long' : 'Short';
        tableRow([
          { label: lot.asset,            width: cols[0].width },
          { label: fDate(lot.acquiredDate), width: cols[1].width },
          { label: String(lot.daysHeld), width: cols[2].width, align: 'right' },
          { label: fQty(lot.amount),     width: cols[3].width, align: 'right' },
          { label: fUsd(lot.costUsd),    width: cols[4].width, align: 'right' },
          { label: term,                 width: cols[5].width, color: term === 'Long' ? POS : SALMON },
        ], i % 2 === 1);
      });
    }

    doc.end();
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session;

    // ── Owner-only check ──────────────────────────────────────────────────────
    if (!isOwner(tenantId)) {
      return new Response('Forbidden', { status: 403 });
    }

    // ── Year param ────────────────────────────────────────────────────────────
    const url = new URL(request.url);
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : new Date().getFullYear() - 1;

    if (!Number.isFinite(year) || year < 2015 || year > new Date().getFullYear()) {
      return new Response(JSON.stringify({ error: 'Invalid year.' }), { status: 400 });
    }

    // ── Build data + PDF ──────────────────────────────────────────────────────
    // 'auto': use pipeline tables when available (IRS-accurate); fall back to
    // lifecycle-events FIFO if the pipeline hasn't run for this year.
    const bd = await buildAnnualBreakdown(tenantId, year, 'fifo', undefined, 'auto' as AnnualBreakdownSource);
    const tenantLabel = `almsTins Account`;
    const pdfBuffer = await buildPdf(bd, year, tenantLabel);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="almstins-${year}-annual-records.pdf"`,
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[year-summary/report]', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate Year Summary.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
