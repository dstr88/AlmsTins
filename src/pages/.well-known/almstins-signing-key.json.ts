// GET /.well-known/almstins-signing-key.json — publishes Almstins' Ed25519 record
// signing public key(s) so anyone can verify a record proof's signature. An array,
// so retired keys stay published after rotation (old records keep verifying).
// Public, no PII, cacheable. When no key is configured, returns { keys: [] } (200) —
// the verifier treats an unknown key_id as "unverifiable", never a false "verified".
import type { APIRoute } from 'astro';
import { getPublicKeyHex, getSigningKeyId, SIGNING_ALG } from '@/lib/recordProof/signing';

export const prerender = false;

export const GET: APIRoute = () => {
  const publicKeyHex = getPublicKeyHex();
  const keyId = getSigningKeyId();
  const keys = publicKeyHex && keyId ? [{ key_id: keyId, alg: SIGNING_ALG, public_key_hex: publicKeyHex }] : [];
  return new Response(JSON.stringify({ keys }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
};
