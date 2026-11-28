// POST /api/verify-record — stateless verification of an uploaded proof bundle, or of a signed
// record proof file (the receivables download, proof_format 'almstins-signed-record/v1').
// PUBLIC, no auth, no DB, no storage. Returns the verdict + the (PII-free) manifest
// the caller supplied; never echoes the leaves back. The browser /verify-record page
// can verify entirely client-side; this endpoint is for programmatic callers.
import type { APIRoute } from 'astro';
import { verifyBundle, type PublishedKey } from '@/lib/recordProof/verify';
import { getPublicKeyHex, getSigningKeyId, getPublishedKeys } from '@/lib/recordProof/signing';
import { isSignedRecordFile, verifySignedRecord } from '@/lib/recordProof/signedRecord';
import type { ProofBundle } from '@/lib/recordProof/buildProof';
import { json } from '@/lib/http';

export const prerender = false;

const MAX_LEAVES = 200_000; // DoS guard

function publishedKeys(): PublishedKey[] {
  const pub = getPublicKeyHex();
  const kid = getSigningKeyId();
  return pub && kid ? [{ key_id: kid, public_key_hex: pub }] : [];
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown = null;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400, { pretty: true }); }
  const bundle = ((body as { bundle?: ProofBundle })?.bundle ?? body) as ProofBundle;
  if (isSignedRecordFile(bundle)) {
    // Every published key, retired ones included, as /.well-known lists them: a record signed
    // before a rotation still checks against the key that signed it.
    const keys = getPublishedKeys().map((k) => ({ key_id: k.key_id, public_key_hex: k.public_key_hex }));
    const outcome = verifySignedRecord(bundle, keys);
    return json({ ok: true, outcome, manifest: bundle.manifest }, 200, { pretty: true });
  }
  if (!bundle || typeof bundle !== 'object' || !bundle.manifest || !Array.isArray(bundle.leaves)) {
    return json({ ok: false, error: 'Provide a proof bundle (manifest + leaves) or a signed record proof file.' }, 400, { pretty: true });
  }
  if (bundle.leaves.length > MAX_LEAVES) return json({ ok: false, error: 'Bundle too large.' }, 413, { pretty: true });

  const outcome = verifyBundle(bundle, publishedKeys());
  return json({ ok: true, outcome, manifest: bundle.manifest }, 200, { pretty: true });
};

export const GET: APIRoute = () =>
  json({ ok: false, error: 'POST a proof bundle to verify, or verify in your browser at /verify-record.' }, 405, { pretty: true });
