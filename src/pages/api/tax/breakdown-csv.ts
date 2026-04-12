/**
 * GET /api/tax/breakdown-csv?year=2025&section=shortTerm
 *
 * section: needsAttention | stillHolding | shortTerm | longTerm | income
 *
 * Each CSV begins with two header rows:
 *   Row 1: Report label
 *   Row 2: Generated date
 *   Row 3: blank
 *   Row 4+: column headers + data
 *
 * If the data spans more than one "page" worth of rows (>50), each chunk
 * of 50 rows gets a repeated label + date header — useful when printed.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { buildAnnualBreakdown, type AnnualBreakdownSource } from '../../../lib/annualBreakdown';

const PAGE_SIZE = 50; // rows before repeating the page header

type CsvRow = (string | number | null)[];

function esc(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  // Quote if contains comma, newline, or double-quote
  if (s.includes(',') || s.includes('\n') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(esc).join(',');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  const sign = v >= 0 ? '' : '-';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildCsv(
  label: string,
  year: number,
  headers: string[],
  dataRows: CsvRow[],
): string {
  const genDate = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const pageHeader = (): string =>
    [
      row(`${label} — ${year}`),
      row(`Generated: ${genDate}`),
      '',
      row(...headers),
    ].join('\n');

  const lines: string[] = [pageHeader()];

  dataRows.forEach((r, idx) => {
    // Repeat page header every PAGE_SIZE rows (for multi-page prints)
    if (idx > 0 && idx % PAGE_SIZE === 0) {
      lines.push('', pageHeader());
    }
    lines.push(row(...r));
  });

  return lines.join('\n');
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const session = await requireTenantSession(request);
    const { tenantId } = session ?? {}
    if (!tenantId) return new Response('Unauthorized', { status: 401 });
    const params  = new URL(url).searchParams;
    const section = params.get('section') ?? 'shortTerm';
    const yearRaw = params.get('year');
    const year    = yearRaw ? Number(yearRaw) : new Date().getFullYear() - 1;

    // 'auto': prefer pipeline data when available (IRS calendar-month accurate)
    const bd = await buildAnnualBreakdown(tenantId, year, 'fifo', undefined, 'auto' as AnnualBreakdownSource);

    let csvContent = '';
    let filename   = `almstins-${year}-${section}.csv`;

    switch (section) {
      case 'needsAttention': {
        filename = `almstins-${year}-needs-attention.csv`;
        const headers = ['Asset', 'Amount', 'Sale Date', 'Proceeds (USD)', 'Issue'];
        const rows: CsvRow[] = bd.needsAttention.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.sellDate),
          formatUsd(i.proceedsUsd),
          'No matching purchase found',
        ]);
        csvContent = buildCsv('Needs Attention — Orphaned Sales', year, headers, rows);
        break;
      }
      case 'stillHolding': {
        filename = `almstins-${year}-still-holding.csv`;
        const headers = ['Asset', 'Quantity', 'Acquired', 'Days Held', 'Cost Basis (USD)', 'Term'];
        const rows: CsvRow[] = bd.stillHolding.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.acquiredDate),
          i.daysHeld,
          formatUsd(i.costUsd),
          i.daysHeld >= 365 ? 'Long-term' : 'Short-term',
        ]);
        csvContent = buildCsv('Still Holding — Unrealized Positions', year, headers, rows);
        break;
      }
      case 'shortTerm': {
        filename = `almstins-${year}-short-term.csv`;
        const headers = ['Asset', 'Qty', 'Acquired', 'Sold', 'Days Held', 'Cost Basis', 'Proceeds', 'Gain / Loss'];
        const rows: CsvRow[] = bd.shortTerm.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.buyDate),
          formatDate(i.sellDate),
          i.daysHeld,
          formatUsd(i.costUsd),
          formatUsd(i.proceedsUsd),
          formatUsd(i.gainLossUsd),
        ]);
        csvContent = buildCsv('Short-Term Capital Gains & Losses', year, headers, rows);
        break;
      }
      case 'longTerm': {
        filename = `almstins-${year}-long-term.csv`;
        const headers = ['Asset', 'Qty', 'Acquired', 'Sold', 'Days Held', 'Cost Basis', 'Proceeds', 'Gain / Loss'];
        const rows: CsvRow[] = bd.longTerm.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.buyDate),
          formatDate(i.sellDate),
          i.daysHeld,
          formatUsd(i.costUsd),
          formatUsd(i.proceedsUsd),
          formatUsd(i.gainLossUsd),
        ]);
        csvContent = buildCsv('Long-Term Capital Gains & Losses', year, headers, rows);
        break;
      }
      case 'income': {
        filename = `almstins-${year}-income.csv`;
        const headers = ['Asset', 'Amount', 'USD Value', 'Date', 'Type', 'Description'];
        const rows: CsvRow[] = bd.income.map((i) => [
          i.asset,
          i.amount,
          formatUsd(i.usdValue),
          formatDate(i.date),
          i.kind,
          i.description,
        ]);
        csvContent = buildCsv('Income — Interest, Staking & Rewards', year, headers, rows);
        break;
      }
      default:
        return new Response('Unknown section', { status: 400 });
    }

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[breakdown-csv]', err);
    return new Response('Server error', { status: 500 });
  }
};
