// Generates the Almstins Verify roster-encryption keypair. Run this yourself and
// paste the two values into Render — this script never sends anything anywhere,
// and nobody but you should see the private value.
//
//   node src/scripts/generateVerifyEncryptionKey.mjs
//
// ALMSTINS_VERIFY_ENCRYPTION_KEY  → the private JWK (Render env var, secret)
// ALMSTINS_VERIFY_ENCRYPTION_PUBKEY → not required day-to-day (the app derives the
//   public half from the private key automatically); only set this during a future
//   key rotation, to keep publishing an old key's public half after replacing it.
//
// Rotation later: run this again, set the NEW private key as
// ALMSTINS_VERIFY_ENCRYPTION_KEY, and set ALMSTINS_VERIFY_ENCRYPTION_PUBKEY to the
// OLD key's public JWK for a grace window so documents encrypted under the old key
// still decrypt while merchants re-encrypt against the new one.

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['encrypt', 'decrypt'],
);

const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

console.log('\nALMSTINS_VERIFY_ENCRYPTION_KEY=' + JSON.stringify(privateJwk));
console.log('\n(public half, for reference only — the app derives this automatically):');
console.log(JSON.stringify(publicJwk));
console.log('\nSet the first line as an env var on the Render web service, then redeploy.\n');
