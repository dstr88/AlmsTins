/**
 * The proof bundle of one operator report: the file /verify-record, POST /api/verify-record and
 * scripts/verify-record.mjs verify. Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?id=  -> the bundle as a JSON attachment (manifest, signature, the ordered leaves and their
 *          hashes). The same codes as the PDF: only a report that is signed and still matches what
 *          was signed is handed out. The leaves hold the report's addresses; the manifest, the
 *          part that travels with the signature, holds none.
 */
import { failure, vaultRoute } from '@/lib/agentVault/api';
import { signedBundleFor } from '@/lib/agentVault/reports';
import { bundleFileName } from '@/lib/agentVault/reportProof';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const r = await signedBundleFor(tenantId, url.searchParams.get('id'));
  if (!r.ok) return failure(r);
  return new Response(`${JSON.stringify(r.bundle, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${bundleFileName(r.bundle.manifest)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
