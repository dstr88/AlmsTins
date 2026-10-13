/**
 * GET /api/yearEnd/breakdown-csv?year=2025&section=shortTerm
 *
 * section: needsAttention | income (any paid plan: lists of the records themselves), or
 * shortTerm | longTerm | stillHolding | turbotax (owner only: per-disposal gain/loss rows
 * with cost basis and proceeds, and open lots, are tax documents, src/lib/taxAuth.ts).
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
import { getActivePlan } from '../../../lib/subscriptions';
import { requireTaxOwner } from '../../../lib/taxAuth';

const PAGE_SIZE = 50; // rows before repeating the page header

/**
 * The only sections a non-owner on a paid plan may download: the sales that still need a
 * matching purchase, and the income records. Neither carries cost basis, gain/loss or
 * holding term. Every other section is owner-only (fail-closed: a new section is locked
 * until it is added here on purpose).
 */
const PAID_PLAN_SECTIONS: ReadonlySet<string> = new Set(['needsAttention', 'income']);

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
    const params  = new URL(url).searchParams;
    const section = params.get('section') ?? 'shortTerm';
    const yearRaw = params.get('year');
    const year    = yearRaw ? Number(yearRaw) : new Date().getFullYear() - 1;

    // Gain/loss and lot exports are tax documents: the owner's alone, whatever the plan
    // (src/lib/taxAuth.ts). Only the sections in PAID_PLAN_SECTIONS skip this; anything else,
    // including an unknown or missing section, is checked first, so anyone else (signed in
    // or not) gets the same generic 404 as the other locked routes before the plan or any
    // data is read.
    if (!PAID_PLAN_SECTIONS.has(section)) {
      const denied = await requireTaxOwner(request);
      if (denied) return denied;
    }

    const session = await requireTenantSession(request);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const { tenantId } = session ?? {}
    if (!tenantId) return new Response('Unauthorized', { status: 401 });

    // ── Paywall check ─────────────────────────────────────────────────────────
    const plan = await getActivePlan(tenantId);
    if (plan.id === 'free') {
      return new Response(
        JSON.stringify({
          error: 'Bookkeeping CSV downloads are available on any paid plan. Upgrade at almstins.com/dashboard/billing.',
          planRequired: 'paid',
          currentPlan: plan.id,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

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
          i.longTerm ? 'Long-term' : 'Short-term',
        ]);
        csvContent = buildCsv('Still Holding — Unrealized Positions', year, headers, rows);
        break;
      }
      case 'shortTerm': {
        filename = `almstins-${year}-short-term.csv`;
        const headers = ['Asset', 'Qty', 'Acquired', 'Sold', 'Days Held', 'Cost Basis', 'Proceeds', 'Gain / Loss', 'Basis Source', 'Origin / Trace'];
        const rows: CsvRow[] = bd.shortTerm.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.buyDate),
          formatDate(i.sellDate),
          i.daysHeld,
          formatUsd(i.costUsd),
          formatUsd(i.proceedsUsd),
          formatUsd(i.gainLossUsd),
          i.basisSource ?? '',
          i.originNote ?? '',
        ]);
        csvContent = buildCsv('Short-Term Capital Gains & Losses', year, headers, rows);
        break;
      }
      case 'longTerm': {
        filename = `almstins-${year}-long-term.csv`;
        const headers = ['Asset', 'Qty', 'Acquired', 'Sold', 'Days Held', 'Cost Basis', 'Proceeds', 'Gain / Loss', 'Basis Source', 'Origin / Trace'];
        const rows: CsvRow[] = bd.longTerm.map((i) => [
          i.asset,
          i.amount,
          formatDate(i.buyDate),
          formatDate(i.sellDate),
          i.daysHeld,
          formatUsd(i.costUsd),
          formatUsd(i.proceedsUsd),
          formatUsd(i.gainLossUsd),
          i.basisSource ?? '',
          i.originNote ?? '',
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
      case 'turbotax': {
        // TurboTax-compatible Form 8949 CSV.
        // Exact column names and plain numeric values TurboTax expects.
        // No extra header rows, no $ signs, dates as MM/DD/YYYY.
        filename = `turbotax-form8949-${year}.csv`;

        function ttDate(iso: string): string {
          try {
            const d = new Date(iso);
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            const yyyy = d.getUTCFullYear();
            return `${mm}/${dd}/${yyyy}`;
          } catch { return iso; }
        }

        function ttNum(v: number | null): string {
          if (v == null || !Number.isFinite(v)) return '0.00';
          return Math.abs(v) === 0 ? '0.00' : v.toFixed(2);
        }

        const ttHeaders = [
          'Description',
          'Date Acquired',
          'Date Sold',
          'Proceeds',
          'Cost Basis',
          'Gain or Loss',
        ];

        const ttRows: CsvRow[] = [
          ...bd.shortTerm.map((i) => [
            `${i.amount} ${i.asset}`,
            ttDate(i.buyDate),
            ttDate(i.sellDate),
            ttNum(i.proceedsUsd),
            ttNum(i.costUsd),
            ttNum(i.gainLossUsd),
          ]),
          ...bd.longTerm.map((i) => [
            `${i.amount} ${i.asset}`,
            ttDate(i.buyDate),
            ttDate(i.sellDate),
            ttNum(i.proceedsUsd),
            ttNum(i.costUsd),
            ttNum(i.gainLossUsd),
          ]),
        ];

        // TurboTax wants ONLY the header row + data rows — no title rows
        const lines = [row(...ttHeaders), ...ttRows.map((r) => row(...r))];
        csvContent = lines.join('\n');
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
