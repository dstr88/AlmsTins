// Standalone OFFLINE verifier for an Almstins record proof bundle.
// Re-implements the verification logic inline (mirrors src/lib/recordProof/*) so an
// auditor can verify WITHOUT trusting almstins.com — only deps are @noble + canonicalize.
//
//   node scripts/verify-record.mjs <proof.json> [--pubkey <hex> | --well-known <url>]
//
// Exit 0 = verified · 1 = unverifiable/tampered/error. Makes NO network call unless
// --well-known is given (or no --pubkey and you opt in). The offlineScript test asserts
// this stays in lock-step with the in-app verifier.
import { readFileSync } from 'node:fs';
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

ed.hashes.sha512 = sha512;

const FIELD_SEP = String.fromCharCode(1);
const NUL = String.fromCharCode(0);

const serializeLeaf = (leaf) => utf8ToBytes(canonicalize(leaf));
const hashLeaf = (b) => sha256(concatBytes(Uint8Array.of(0x00), b));
const hashNode = (l, r) => sha256(concatBytes(Uint8Array.of(0x01), l, r));

function buildMerkleRoot(leafHashes) {
  if (leafHashes.length === 0) return hashLeaf(new Uint8Array(0));
  let level = leafHashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashNode(level[i], level[i + 1]) : level[i]); // odd promoted
    }
    level = next;
  }
  return level[0];
}

const primaryDate = (l) => l.disposed_at ?? l.date ?? l.acquired_at ?? NUL;
const sortKey = (l) => [primaryDate(l), l.kind, l.asset, l.amount, l.tx_hash ?? NUL, l.term ?? NUL,
  l.proceeds_usd ?? NUL, l.cost_usd ?? NUL, l.income_kind ?? NUL].join(FIELD_SEP);

function orderLeaves(leaves) {
  return leaves.slice().sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka < kb) return -1; if (ka > kb) return 1;
    const sa = canonicalize(a) ?? '', sb = canonicalize(b) ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

function signedManifestView(m) {
  const { verify_url, disclaimer, ...rest } = m;
  return rest;
}

async function publicKeyFrom(args, bundle) {
  const pk = args.pubkey?.trim().toLowerCase();
  if (pk && /^[0-9a-f]{64}$/.test(pk)) return pk;
  if (args.wellKnown) {
    const res = await fetch(args.wellKnown);
    const data = await res.json();
    const match = (data.keys || []).find((k) => k.key_id === bundle?.signature?.key_id);
    return match?.public_key_hex ?? null;
  }
  return null; // no key → can't confirm origin (unverifiable, not tampered)
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pubkey') out.pubkey = argv[++i];
    else if (argv[i] === '--well-known') out.wellKnown = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) { console.error('usage: node scripts/verify-record.mjs <proof.json> [--pubkey <hex> | --well-known <url>]'); process.exit(1); }

  let bundle;
  try { bundle = JSON.parse(readFileSync(file, 'utf8')); }
  catch { console.error('❌ malformed — not valid JSON'); process.exit(1); }
  if (!bundle?.manifest || !Array.isArray(bundle.leaves)) { console.error('❌ malformed — not a proof bundle'); process.exit(1); }

  const m = bundle.manifest;
  const leaves = orderLeaves(bundle.leaves);
  const recomputed = bytesToHex(buildMerkleRoot(leaves.map((l) => hashLeaf(serializeLeaf(l)))));

  console.log(`Record ${m.record_id}  ·  ${m.period} ${m.record_type}  ·  ${m.leaf_count} entries  ·  generated ${m.generated_at}`);
  console.log(`Merkle root (manifest):   ${m.merkle_root}`);
  console.log(`Merkle root (recomputed): ${recomputed}`);

  if (recomputed !== String(m.merkle_root).toLowerCase()) { console.error('\n❌ TAMPERED — entries do not hash to the recorded root'); process.exit(1); }
  if (leaves.length !== m.leaf_count) { console.error('\n❌ TAMPERED — leaf count mismatch'); process.exit(1); }
  if (!bundle.signature) { console.warn('\n⚠️  UNVERIFIABLE — intact, but unsigned (origin not attested)'); process.exit(1); }

  const pub = await publicKeyFrom(args, bundle);
  if (!pub) { console.warn(`\n⚠️  UNVERIFIABLE — signed (key ${bundle.signature.key_id}) but no public key supplied. Re-run with --pubkey or --well-known.`); process.exit(1); }

  let sigOk = false;
  try { sigOk = ed.verify(hexToBytes(bundle.signature.signature_hex), utf8ToBytes(canonicalize(signedManifestView(m))), hexToBytes(pub)); } catch { sigOk = false; }
  if (!sigOk) { console.error('\n❌ TAMPERED — signature does not verify under the supplied key'); process.exit(1); }

  console.log('\n✅ VERIFIED — genuine, unaltered Almstins record (integrity + origin + source-traceability).');
  console.log('   (Does NOT attest tax correctness — see the bundle disclaimer.)');
  process.exit(0);
}

main();
