/**
 * The signed PDF of one operator report. Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?id=  -> the PDF, as an attachment. It is produced only for a report that is signed and
 *          still matches what was signed. Otherwise a code and no document:
 *            404 report_not_found     no such report on this account
 *            409 not_signed           it was made when no signing key was configured
 *            409 report_altered       what is stored no longer matches what was signed
 *            503 signing_unavailable  it was signed, but no published key can confirm that now
 *
 * This PDF is the one surface where the report's addresses appear, and it carries its own proof
 * bundle as an attachment. The signed bundle on its own is GET /api/agentics/reports/bundle.
 */
import { failure, vaultRoute } from '@/lib/agentVault/api';
import { signedBundleFor } from '@/lib/agentVault/reports';
import { buildReportPdf } from '@/lib/agentVault/reportPdf';
import { pdfFileName } from '@/lib/agentVault/reportProof';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const r = await signedBundleFor(tenantId, url.searchParams.get('id'));
  if (!r.ok) return failure(r);
  const pdf = await buildReportPdf({ content: r.stored.content, bundle: r.bundle });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(r.bundle.manifest)}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    },
  });
});
