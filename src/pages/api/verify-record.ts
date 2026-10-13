// POST /api/verify-record — stateless verification of an uploaded proof bundle.
// PUBLIC, no auth, no DB, no storage. Returns the verdict + the (PII-free) manifest
// the caller supplied; never echoes the leaves back. The browser /verify-record page
// can verify entirely client-side; this endpoint is for programmatic callers.
import type { APIRoute } from 'astro';
import { verifyBundle, type PublishedKey } from '@/lib/recordProof/verify';
import { getPublicKeyHex, getSigningKeyId } from '@/lib/recordProof/signing';
import type { ProofBundle } from '@/lib/recordProof/buildProof';

export const prerender = false;

const MAX_LEAVES = 200_000; // DoS guard

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

function publishedKeys(): PublishedKey[] {
  const pub = getPublicKeyHex();
  const kid = getSigningKeyId();
  return pub && kid ? [{ key_id: kid, public_key_hex: pub }] : [];
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown = null;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const bundle = ((body as { bundle?: ProofBundle })?.bundle ?? body) as ProofBundle;
  if (!bundle || typeof bundle !== 'object' || !bundle.manifest || !Array.isArray(bundle.leaves)) {
    return json({ ok: false, error: 'Provide a proof bundle (manifest + leaves).' }, 400);
  }
  if (bundle.leaves.length > MAX_LEAVES) return json({ ok: false, error: 'Bundle too large.' }, 413);

  const outcome = verifyBundle(bundle, publishedKeys());
  return json({ ok: true, outcome, manifest: bundle.manifest });
};

export const GET: APIRoute = () =>
  json({ ok: false, error: 'POST a proof bundle to verify, or verify in your browser at /verify-record.' }, 405);
