// One-off: generate a fresh Ed25519 signing key for verifiable record exports.
// Writes NOTHING to disk. The owner runs it, pastes the SEED into Render env
// ALMSTINS_SIGNING_KEY; the public key auto-publishes at
// /.well-known/almstins-signing-key.json. Never commit the seed.
//
//   node scripts/generate-signing-key.mjs
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

ed.hashes.sha512 = sha512;

const seed = ed.utils.randomSecretKey(); // 32-byte Ed25519 seed
const publicKeyHex = bytesToHex(ed.getPublicKey(seed));
const keyId = 'almstins-' + bytesToHex(sha256(ed.getPublicKey(seed))).slice(0, 16);
const seedB64 = Buffer.from(seed).toString('base64');

console.log(`
  Almstins record signing key  —  KEEP THE SEED SECRET (never commit it)

  1. Paste this into Render env  ALMSTINS_SIGNING_KEY  (base64 seed):

       ${seedB64}

  2. Public key (auto-published at /.well-known/almstins-signing-key.json):

       ${publicKeyHex}

  3. Key id (content-derived, rotation-friendly):  ${keyId}

  Until ALMSTINS_SIGNING_KEY is set, exports ship UNSIGNED (verify as
  "unverifiable", never "tampered"). Setting it activates signing immediately.
`);
