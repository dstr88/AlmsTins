/**
 * GET /api/petro-tins/receipts/export[?year=YYYY] — download the whole registry
 * as a ZIP containing every receipt photo + a tabular receipts.csv.
 *
 * This is the durable, portable copy the user hands to their tax preparer and
 * keeps with their records — it lives independently of the app, which is what
 * makes "keep it for at least seven years" actually true. Tenant-scoped; a read
 * of the caller's own data (demo allowed — they simply have nothing to export).
 */

import type { APIRoute } from 'astro';
import JSZip from 'jszip';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isOwner } from '@/lib/owner';
import { getReceiptsForExport } from '@/lib/petroReceipts';

export const prerender = false;

/** RFC-4180 CSV field: wrap in quotes, double any internal quotes. */
function csv(value: string | number | null): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Map a mime type to a file extension for the zipped photo. */
function extFor(mime: string | null, filename: string | null): string {
  switch (mime) {
    case 'image/png':  return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    case 'application/pdf': return 'pdf';
    default: {
      const m = filename?.match(/\.([a-z0-9]{1,5})$/i);
      return m ? m[1].toLowerCase() : 'bin';
    }
  }
}

/** Make a filesystem-safe slug from a free-text description. */
function slug(s: string | null): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!isOwner(session.tenantId)) return new Response('Forbidden', { status: 403 });
  const { tenantId } = session;

  const url  = new URL(request.url);
  const year = url.searchParams.get('year') ?? undefined;

  const receipts = await getReceiptsForExport(tenantId, year);

  const zip = new JSZip();
  const photos = zip.folder('photos');

  const header = ['Date', 'Amount', 'Description', 'Category', 'Photo File'].map(csv).join(',');
  const lines: string[] = [header];

  receipts.forEach((r, i) => {
    let photoName = '';
    if (r.data) {
      const ext = extFor(r.mimeType, r.filename);
      const seq = String(i + 1).padStart(4, '0');
      const desc = slug(r.description);
      photoName = `${r.receiptDate}_${seq}${desc ? '_' + desc : ''}.${ext}`;
      photos?.file(photoName, r.data, { base64: true });
    }
    lines.push([
      csv(r.receiptDate),
      csv(r.amount.toFixed(2)),
      csv(r.description),
      csv(r.category),
      csv(photoName ? `photos/${photoName}` : ''),
    ].join(','));
  });

  // Prepend a UTF-8 BOM so Excel opens the CSV with correct encoding.
  zip.file('receipts.csv', '﻿' + lines.join('\r\n'));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

  const label = year && /^\d{4}$/.test(year) ? year : 'all';
  const fname = `petrotins-receipts-${label}.zip`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control':       'private, no-store',
    },
  });
};
