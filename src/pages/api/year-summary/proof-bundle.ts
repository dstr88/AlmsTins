// GET /api/year-summary/proof-bundle?year=YYYY (or ?id=<record_id>)
// Downloads the self-contained, offline-verifiable proof bundle (manifest +
// signature + the frozen ordered leaves + leaf hashes) for a generated record.
// Same paywall as the PDF. The bundle is rebuilt from the FROZEN snapshot, so it
// re-verifies forever regardless of later live-data changes. Tenant-scoped.
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { isOwner } from '@/lib/owner';
import { getStoredRecord, getLatestRecordId, getLatestRoot, persistRecordProof } from '@/lib/recordProof/store';
import { buildRecordProof, PROOF_FORMAT, type ProofBundle } from '@/lib/recordProof/buildProof';
import { buildAnnualBreakdown, type AnnualBreakdownSource } from '@/lib/annualBreakdown';

export const prerender = false;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...extra } });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { tenantId } = session;

  const plan = await getActivePlan(tenantId);
  if (plan.id === 'free' && !isOwner(tenantId)) {
    return json({ error: 'The verification bundle is available on any paid plan.', planRequired: 'paid' }, 403);
  }

  const url = new URL(request.url);
  let recordId = url.searchParams.get('id');
  const yearParam = url.searchParams.get('year');
  if (!recordId && yearParam) {
    const year = Number(yearParam);
    if (!Number.isFinite(year) || year < 2015 || year > new Date().getFullYear() + 1) {
      return json({ error: 'Invalid year.' }, 400);
    }
    recordId = await getLatestRecordId(tenantId, year);
    if (!recordId) {
      // Generate on demand so the bundle works even before the PDF is downloaded.
      const bd = await buildAnnualBreakdown(tenantId, year, 'fifo', undefined, 'auto' as AnnualBreakdownSource);
      const prevRoot = await getLatestRoot(tenantId, year).catch(() => null);
      const fresh = buildRecordProof(tenantId, year, bd, prevRoot, new Date().toISOString());
      await persistRecordProof(tenantId, fresh).catch((e) => console.error('[proof-bundle] persist failed', e));
      return json(fresh, 200, { 'Content-Disposition': `attachment; filename="almstins-${year}-proof.json"` });
    }
  }
  if (!recordId) return json({ error: 'Provide ?year= or ?id=.' }, 400);

  const rec = await getStoredRecord(tenantId, recordId);
  if (!rec) return json({ error: 'Record not found.' }, 404);

  const bundle: ProofBundle = {
    manifest: rec.manifest,
    signature: rec.signatureHex
      ? { alg: 'Ed25519', key_id: rec.manifest.signing_key_id ?? '', signature_hex: rec.signatureHex }
      : null,
    leaves: rec.leaves,
    leaf_hashes: rec.leafHashes,
    proof_format: PROOF_FORMAT,
  };

  return json(bundle, 200, {
    'Content-Disposition': `attachment; filename="almstins-${rec.manifest.period}-proof.json"`,
  });
};
