/**
 * GET /api/year-summary/report?year=2024
 *
 * Generates a Year Summary PDF for the requested calendar year.
 * Requires the 'unlimited' ($39/mo) plan — returns 403 for lower tiers.
 *
 * Sections:
 *   1. Cover — tenant name, year, generated date, disclaimer
 *   2. Summary — realized gains totals, income total, held cost basis
 *   3. Short-term disposals
 *   4. Long-term disposals
 *   5. Received / Earned (income events)
 *   6. Still Holding (open lots)
 */

import type { APIRoute } from 'astro';
import PDFDocument from 'pdfkit';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { buildAnnualBreakdown, fmvSourceCategory, formatCostBasisMethod, type AnnualBreakdownSource } from '@/lib/annualBreakdown';
import { getFilteredTokens, type JunkToken } from '@/lib/junkTokens';
import { getActivePlan } from '@/lib/subscriptions';
import { isOwner } from '@/lib/owner';
import { buildRecordProof, type ProofBundle } from '@/lib/recordProof/buildProof';
import { persistRecordProof, getLatestRoot } from '@/lib/recordProof/store';

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
  proof: ProofBundle,
  feesFull: boolean,
  filteredTokens: JunkToken[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: {
        Title: `${year} Year Summary — almsTins`,
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
        .text(`  ·  ${year} Year Summary  ·  ${tenantLabel}`, { align: 'left' })
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
      .text('Short-term realized gain / loss', MARGIN + 20, boxY + 20, { width: 240, lineBreak: false })
      .fillColor(stGain >= 0 ? POS : NEG).font('Helvetica-Bold')
      .text(fUsd(stGain, true), MARGIN + 260, boxY + 20, { width: CONTENT_W - 280, align: 'right' });

    doc
      .fontSize(10).fillColor(MID_GRAY).font('Helvetica')
      .text('Long-term realized gain / loss', MARGIN + 20, boxY + 48, { width: 240, lineBreak: false })
      .fillColor(ltGain >= 0 ? POS : NEG).font('Helvetica-Bold')
      .text(fUsd(ltGain, true), MARGIN + 260, boxY + 48, { width: CONTENT_W - 280, align: 'right' });

    doc
      .fontSize(10).fillColor(MID_GRAY).font('Helvetica')
      .text('Received / Earned', MARGIN + 20, boxY + 76, { width: 240, lineBreak: false })
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
      .fontSize(10)
      .fillColor('#555555')
      .font('Helvetica')
      .text(
        'This Year Summary is generated from the transaction data you have provided to almsTins. ' +
        'It is intended to help you organise your records and is not financial or legal advice. ' +
        'almsTins is not a tax preparation service. Please consult a qualified accountant regarding your specific obligations.',
        MARGIN, doc.page.height - 100,
        { width: CONTENT_W, align: 'center' },
      );

    // ── PAGE 2: Summary ───────────────────────────────────────────────────────
    newPage();
    sectionTitle(`${year} Summary`);

    summaryRow('Short-term realized gain / loss', fUsd(stGain, true), stGain >= 0 ? POS : NEG);
    summaryRow('Long-term realized gain / loss', fUsd(ltGain, true), ltGain >= 0 ? POS : NEG);
    summaryRow('Total received / earned', fUsd(income));
    summaryRow('Net realized gain / loss', fUsd(netGain, true), netGain >= 0 ? POS : NEG);
    summaryRow('Cost basis method', formatCostBasisMethod(bd.method));
    summaryRow('Open lots — cost basis', fUsd(bd.totals.heldCostBasis));
    summaryRow('Short-term disposal events', String(bd.shortTerm.length));
    summaryRow('Long-term disposal events', String(bd.longTerm.length));
    summaryRow('Income / reward events', String(bd.income.length));
    summaryRow('Still holding — open lots', String(bd.stillHolding.length));

    // ── PAGE 3+: Short-term disposals ─────────────────────────────────────────
    if (bd.shortTerm.length > 0) {
      newPage();
      sectionTitle('Short-term disposals  (held < 365 days)');

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
      summaryRow('Short-term subtotal', fUsd(stGain, true), stGain >= 0 ? POS : NEG);
    }

    // ── Long-term disposals ───────────────────────────────────────────────────
    if (bd.longTerm.length > 0) {
      newPage();
      sectionTitle('Long-term disposals  (held ≥ 365 days)');

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
      summaryRow('Long-term subtotal', fUsd(ltGain, true), ltGain >= 0 ? POS : NEG);
    }

    // ── Received / Earned ─────────────────────────────────────────────────────
    if (bd.income.length > 0) {
      newPage();
      sectionTitle('Received / Earned');

      const cols = [
        { label: 'Date',       width: 92 },
        { label: 'Asset',      width: 55  },
        { label: 'Type',       width: 150 },
        { label: 'Qty',        width: 95, align: 'right' as const },
        { label: 'Value (FMV)',width: 95, align: 'right' as const },
        { label: 'FMV source', width: 118 },
        { label: 'Description',width: 83 },
      ];
      tableHeaders(cols);

      const fmvLabel = (item: typeof bd.income[number]) => {
        switch (fmvSourceCategory(item.priceSource, item.usdValue)) {
          case 'source':     return 'Exchange';
          case 'stablecoin': return 'Stablecoin $1';
          case 'estimated':  return 'CoinGecko';
          default:           return 'Unpriced';
        }
      };

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
          { label: fmvLabel(item),            width: cols[5].width, color: MID_GRAY },
          { label: item.description ?? '—',   width: cols[6].width, color: MID_GRAY },
        ], i % 2 === 1);
      });

      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      summaryRow('Total received / earned', fUsd(income));
    }

    // ── Card rebates (non-taxable) ─────────────────────────────────────────────
    // Shown as a $0-tax line so the preparer can confirm the classification
    // rather than wonder where the exchange cashback went.
    if (bd.cardRebates.length > 0) {
      newPage();
      sectionTitle('Card Rebates — Non-Taxable');
      const cols = [
        { label: 'Date',        width: 150 },
        { label: 'Asset',       width: 130 },
        { label: 'Qty',         width: 204, align: 'right' as const },
        { label: 'Value (USD)', width: 204, align: 'right' as const },
      ];
      tableHeaders(cols);
      const rebateTotal = bd.cardRebates.reduce((s, r) => s + (r.usdValue ?? 0), 0);
      bd.cardRebates.forEach((r, i) => {
        tableRow([
          { label: fDate(r.date),    width: cols[0].width },
          { label: r.asset,          width: cols[1].width },
          { label: fQty(r.amount),   width: cols[2].width, align: 'right' },
          { label: fUsd(r.usdValue), width: cols[3].width, align: 'right' },
        ], i % 2 === 1);
      });
      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      summaryRow('Total card rebates — $0 taxable', fUsd(rebateTotal));
    }

    // ── Still Holding ─────────────────────────────────────────────────────────
    if (bd.stillHolding.length > 0) {
      newPage();
      sectionTitle('Still Holding — Open Lots');

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

    // ── NFT holdings ───────────────────────────────────────────────────────────
    // What the taxpayer holds. Cost basis is not auto-derived for NFTs; a value is
    // shown only when known and > $1 (no placeholder clutter).
    if (bd.nftHoldings.length > 0) {
      newPage();
      sectionTitle('NFT Holdings');
      const cols = [
        { label: 'Name',       width: 240 },
        { label: 'Chain',      width: 120 },
        { label: 'Token ID',   width: 160 },
        { label: 'Cost (USD)', width: 168, align: 'right' as const },
      ];
      tableHeaders(cols);
      bd.nftHoldings.forEach((nft, i) => {
        const cost = (nft.costUsd != null && nft.costUsd > 1) ? fUsd(nft.costUsd) : '—';
        tableRow([
          { label: nft.name || '—',   width: cols[0].width },
          { label: nft.chain,         width: cols[1].width },
          { label: `#${nft.tokenId}`, width: cols[2].width },
          { label: cost,              width: cols[3].width, align: 'right', color: MID_GRAY },
        ], i % 2 === 1);
      });
      doc.moveDown(0.4);
      doc.fontSize(8).font('Helvetica-Oblique').fillColor(MID_GRAY)
        .text('Cost basis for NFTs is not auto-tracked. Enter it manually where a taxable event applies.', MARGIN, doc.y, { width: CONTENT_W });
    }

    // ── Transaction costs (fees) ───────────────────────────────────────────────
    // Summary for the accountant — total + by-source, not every line (the full
    // itemized list lives in the bookkeeping view / CSV export). Trading fees are
    // tax-relevant: they raise cost basis on a buy and reduce proceeds on a sale.
    if (bd.transactionCosts.length > 0 || bd.gasByChain.length > 0) {
      newPage();
      sectionTitle('Transaction Costs');

      if (bd.transactionCosts.length > 0) {
        const bySource = new Map<string, { usd: number; count: number }>();
        for (const f of bd.transactionCosts) {
          const key = f.source || 'unknown';
          const cur = bySource.get(key) ?? { usd: 0, count: 0 };
          cur.usd += f.feeUsd ?? 0;
          cur.count += 1;
          bySource.set(key, cur);
        }
        const cols = [
          { label: 'Source',       width: 300 },
          { label: 'Fees (count)', width: 144, align: 'right' as const },
          { label: 'Fees (USD)',   width: 144, align: 'right' as const },
        ];
        tableHeaders(cols);
        Array.from(bySource.entries())
          .sort((a, b) => b[1].usd - a[1].usd)
          .forEach(([src, agg], i) => {
            tableRow([
              { label: src,               width: cols[0].width },
              { label: String(agg.count), width: cols[1].width, align: 'right' },
              { label: fUsd(agg.usd),     width: cols[2].width, align: 'right' },
            ], i % 2 === 1);
          });
        doc.moveDown(0.3);
        doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).strokeColor('#444').lineWidth(0.5).stroke();
        doc.moveDown(0.3);
        summaryRow('Total exchange fees (USD)', fUsd(bd.totals.transactionCostsUsd));

        // Full schedule — every fee line (default). 'summary' mode omits this.
        if (feesFull) {
          doc.moveDown(0.6);
          doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MID_GRAY)
            .text('Itemized fees', MARGIN, doc.y);
          doc.moveDown(0.2);
          const icols = [
            { label: 'Date',   width: 120 },
            { label: 'Source', width: 150 },
            { label: 'Asset',  width: 100 },
            { label: 'Fee',    width: 200, align: 'right' as const },
          ];
          tableHeaders(icols);
          bd.transactionCosts.forEach((f, i) => {
            const feeLabel = f.feeUsd != null
              ? fUsd(f.feeUsd)
              : f.feeNative != null
                ? `${fQty(f.feeNative)} ${f.feeCurrency ?? ''}`.trim()
                : '—';
            tableRow([
              { label: fDate(f.date), width: icols[0].width },
              { label: f.source,      width: icols[1].width },
              { label: f.asset,       width: icols[2].width },
              { label: feeLabel,      width: icols[3].width, align: 'right' },
            ], i % 2 === 1);
          });
        }
      }

      if (bd.gasByChain.length > 0) {
        doc.moveDown(0.6);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MID_GRAY)
          .text('On-chain gas (native units — not USD-priced)', MARGIN, doc.y);
        doc.moveDown(0.2);
        const gcols = [
          { label: 'Chain',        width: 300 },
          { label: 'Transactions', width: 144, align: 'right' as const },
          { label: 'Gas (native)', width: 144, align: 'right' as const },
        ];
        tableHeaders(gcols);
        bd.gasByChain.forEach((g, i) => {
          tableRow([
            { label: g.chain,                              width: gcols[0].width },
            { label: String(g.txCount),                    width: gcols[1].width, align: 'right' },
            { label: `${fQty(g.totalNative)} ${g.nativeSymbol}`, width: gcols[2].width, align: 'right' },
          ], i % 2 === 1);
        });
      }

      if (bd.feeCoverage.total > 0) {
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor(MID_GRAY)
          .text(
            `Fee data captured on ${bd.feeCoverage.withFee} of ${bd.feeCoverage.total} imported transactions this year. `
            + 'Gaps mean a source CSV did not carry a fee column — not that no fee was paid.',
            MARGIN, doc.y, { width: CONTENT_W },
          );
      }
    }

    // ── Filtered / ignored tokens (spam & scam airdrops) ───────────────────────
    // Auditability for the preparer: what was set aside and excluded from every
    // total above, and why. Dry, professional label (not "junk").
    if (filteredTokens.length > 0) {
      newPage();
      sectionTitle('Filtered / Ignored Tokens  (spam & scam airdrops)');
      doc.fontSize(8.5).font('Helvetica').fillColor(MID_GRAY)
        .text('These tokens were classified as spam or scam airdrops and excluded from all holdings, gains, income, and tax totals above. Listed here for completeness.', MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(0.4);
      const cols = [
        { label: 'Token',  width: 300 },
        { label: 'Chain',  width: 130 },
        { label: 'Reason', width: 258 },
      ];
      tableHeaders(cols);
      filteredTokens.slice(0, 200).forEach((tk, i) => {
        const label = (tk.name || tk.symbol || '—').slice(0, 46);
        tableRow([
          { label,                width: cols[0].width },
          { label: tk.chain,      width: cols[1].width },
          { label: tk.reason,     width: cols[2].width, color: MID_GRAY },
        ], i % 2 === 1);
      });
      if (filteredTokens.length > 200) {
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor(MID_GRAY)
          .text(`… and ${filteredTokens.length - 200} more.`, MARGIN, doc.y);
      }
    }

    // ── Verification appendix ──────────────────────────────────────────────────
    newPage();
    sectionTitle('Verification');
    const m = proof.manifest;
    doc.moveDown(0.5);
    const vline = (label: string, value: string) => {
      doc.fontSize(8.5)
        .font('Helvetica-Bold').fillColor('#555555').text(label, MARGIN, doc.y, { continued: true })
        .font('Helvetica').fillColor('#222222').text('  ' + value);
      doc.moveDown(0.35);
    };
    vline('Record ID', m.record_id);
    vline('Merkle root', m.merkle_root);
    vline('Entries committed', `${m.leaf_count}  (short ${m.counts.short_term} · long ${m.counts.long_term} · income ${m.counts.income} · held ${m.counts.held} · review ${m.counts.unsettled})`);
    vline('Data source', m.data_source);
    vline('Generated', m.generated_at);
    vline('Signed', proof.signature ? `Yes — Almstins key ${proof.signature.key_id}` : 'No (unsigned — set ALMSTINS_SIGNING_KEY to activate signing)');
    if (m.prev_root) vline('Links to prior record', `${m.prev_root}  (tamper-evident chain across years)`);
    doc.moveDown(0.5);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(SALMON).text('How anyone can verify this record', MARGIN, doc.y);
    doc.moveDown(0.2).fontSize(8).font('Helvetica').fillColor('#333333')
      .text(`Download the proof bundle (almstins-${year}-proof.json) and upload it at ${m.verify_url}, or run the standalone offline verifier — no account, no trust in Almstins required.`, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.6);
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(MID_GRAY)
      .text(m.disclaimer, MARGIN, doc.y, { width: CONTENT_W });

    doc.end();
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session;

    // ── Paywall check (owner bypass — the owner's own tax tool) ───────────────
    const plan = await getActivePlan(tenantId);
    if (plan.id === 'free' && !isOwner(tenantId)) {
      return new Response(
        JSON.stringify({
          error: 'The Year Summary PDF is available on any paid plan. Upgrade at almstins.com/dashboard/billing.',
          planRequired: 'paid',
          currentPlan: plan.id,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Year param ────────────────────────────────────────────────────────────
    const url = new URL(request.url);
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : new Date().getFullYear() - 1;
    // Fee detail: default 'full' (itemize every fee line — the full schedule some
    // accountants want); 'summary' collapses to totals + by-source only.
    const feesFull = url.searchParams.get('fees') !== 'summary';

    if (!Number.isFinite(year) || year < 2015 || year > new Date().getFullYear()) {
      return new Response(JSON.stringify({ error: 'Invalid year.' }), { status: 400 });
    }

    // ── Build data + PDF ──────────────────────────────────────────────────────
    // 'auto': use pipeline tables when available (IRS-accurate); fall back to
    // lifecycle-events FIFO if the pipeline hasn't run for this year.
    const bd = await buildAnnualBreakdown(tenantId, year, 'fifo', undefined, 'auto' as AnnualBreakdownSource);
    const tenantLabel = `almsTins Account`;
    const filteredTokens = await getFilteredTokens(tenantId).catch(() => [] as JunkToken[]);

    // ── Verifiable record: hash the exact breakdown the PDF prints, sign + persist ──
    // Awaited so the PDF's record_id matches the stored record (powers verify-by-id +
    // bundle download); persistence failure is non-fatal (the PDF still ships).
    const prevRoot = await getLatestRoot(tenantId, year).catch(() => null);
    const proof = buildRecordProof(tenantId, year, bd, prevRoot, new Date().toISOString());
    await persistRecordProof(tenantId, proof).catch((e) => console.error('[year-summary] proof persist failed', e));

    const pdfBuffer = await buildPdf(bd, year, tenantLabel, proof, feesFull, filteredTokens);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="almstins-${year}-year-summary.pdf"`,
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
