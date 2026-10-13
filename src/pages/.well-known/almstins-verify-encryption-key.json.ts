// GET /.well-known/almstins-verify-encryption-key.json — publishes Almstins' RSA-OAEP
// public key so a merchant's browser can encrypt a roster document to it. Safe to be
// fully public: this is the public half only, it lets anyone ENCRYPT to us, never
// decrypt. An array, so a retired key stays published after rotation (documents
// encrypted under it still decrypt during the grace window). When no key is
// configured, returns { keys: [] } (200) — the roster fetch then treats every
// document as unreadable rather than guessing.
import type { APIRoute } from 'astro';
import { getPublicKeyJwk, getEncryptionKeyId, ENCRYPTION_ALG } from '@/lib/verifyEncryption';

export const prerender = false;

export const GET: APIRoute = async () => {
  const jwk = await getPublicKeyJwk();
  const keyId = await getEncryptionKeyId();
  const keys = jwk && keyId ? [{ key_id: keyId, alg: ENCRYPTION_ALG, jwk }] : [];
  return new Response(JSON.stringify({ keys }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
};
