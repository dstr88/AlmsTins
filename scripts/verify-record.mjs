// Standalone OFFLINE verifier for an Almstins record proof bundle.
// Re-implements the verification logic inline (mirrors src/lib/recordProof/*) so an
// auditor can verify WITHOUT trusting almstins.com — only deps are @noble + canonicalize
// (and ./keylog.mjs beside this file, for the public key log).
//
//   node scripts/verify-record.mjs <proof.json> [--key-log <log.jsonl> --root-fingerprint <hex>]
//        [--anchored-at <iso>] [--write-ots <file>] [--pubkey <hex> | --well-known <url>]
//
// Two inputs: a Year Summary / report bundle ({manifest, leaves, signature}), or a signed
// record proof file (proof_format 'almstins-signed-record/v1', the receivables download).
//
// Where the public key comes from decides what "verified" means:
//   --key-log           the public key log (github.com/dstr88/almstins-keys or any mirror),
//                       checked against the root fingerprint Almstins posted publicly. The
//                       only source that needs nothing from almstins.com, and the only one
//                       that can say whether the key was revoked.
//   --pubkey            a key you already hold. Proves the signature, not the key's status.
//   --well-known <url>  fetched from almstins.com. Needs the site to exist.
// --anchored-at is the Bitcoin time `ots verify` printed for the record's .ots proof (use
// --write-ots to save it); the file's own bitcoin_time is a claim and is never used to judge.
// The steps are in docs/verify-without-almstins.md.
//
// Exit 0 = verified · 1 = unverifiable/tampered/rejected/error. Makes NO network call unless
// --well-known is given. The offlineScript test asserts this stays in lock-step with the
// in-app verifier.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { parseLog, verifyLog, judgeSignature, rootFingerprint } from './keylog.mjs';

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
    else if (argv[i] === '--key-log') out.keyLog = argv[++i];
    else if (argv[i] === '--root-fingerprint') out.rootFingerprint = argv[++i];
    else if (argv[i] === '--anchored-at') out.anchoredAt = argv[++i];
    else if (argv[i] === '--write-ots') out.writeOts = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Load and check the key log, or exit. Accepts the log.jsonl file or the directory holding it. */
function loadKeyLog(args) {
  if (!args.keyLog) return null;
  let path = args.keyLog;
  try { if (statSync(path).isDirectory()) path = join(path, 'log.jsonl'); } catch { /* read error below */ }
  let entries;
  try { entries = parseLog(readFileSync(path, 'utf8')); }
  catch (e) { console.error(`❌ key log unreadable: ${e.message || e}`); process.exit(1); }
  if (!args.rootFingerprint) {
    console.error('❌ --key-log needs --root-fingerprint: the root key fingerprint Almstins posted publicly. Without it, anyone could hand you a log of their own.');
    process.exit(1);
  }
  const state = verifyLog(entries, { expectedRootFingerprint: args.rootFingerprint });
  if (!state.ok) { console.error(`❌ key log does NOT verify: ${state.errors.join('; ')}`); process.exit(1); }
  console.log(`Key log: ${state.length} entries, root ${rootFingerprint(state.root.public_key_hex).slice(0, 16)}…, head ${state.head}`);
  console.log(`         confirm that head with: ots verify heads/${state.length - 1}.txt.ots`);
  return state;
}

/** Report a key-log judgement and exit. */
function finishWithJudgement(j, what) {
  if (j.verdict === 'trusted') {
    console.log(`\n✅ VERIFIED: ${what}. ${j.reason}`);
    process.exit(0);
  }
  if (j.verdict === 'trusted-undated') {
    console.log(`\n✅ VERIFIED (undated): ${what}. ${j.reason}`);
    console.log('   If this key is ever revoked, an undated signature stops counting.');
    process.exit(0);
  }
  console.error(`\n❌ ${j.verdict === 'rejected' ? 'REJECTED' : 'UNKNOWN KEY'}: ${j.reason}`);
  process.exit(1);
}

/** A signed record proof file (almstins-signed-record/v1): one manifest, its signature, its .ots. */
async function verifyRecordFile(bundle, args) {
  const digest = bytesToHex(sha256(utf8ToBytes(canonicalize(bundle.manifest))));
  console.log(`Record ${bundle.record_id}  ·  ${bundle.product} ${bundle.kind}`);
  console.log(`Digest (file):       ${bundle.digest}`);
  console.log(`Digest (recomputed): ${digest}`);
  if (digest !== String(bundle.digest).toLowerCase()) { console.error('\n❌ TAMPERED: the manifest does not hash to the recorded digest'); process.exit(1); }

  const a = bundle.anchor;
  if (a && String(a.digest).toLowerCase() !== digest) { console.error('\n❌ TAMPERED: the Bitcoin proof is for a different digest'); process.exit(1); }
  if (a && args.writeOts) {
    writeFileSync(args.writeOts, Buffer.from(String(a.ots_base64), 'base64'));
    console.log(`Wrote the .ots proof to ${args.writeOts}. Check it: ots verify -d ${digest} ${args.writeOts}`);
  }
  if (a) console.log(`Bitcoin proof: present (the file says ${a.bitcoin_time ?? 'pending'}; only your own ots verify counts)`);
  else console.log('Bitcoin proof: none in this file');

  const sig = bundle.signature;
  if (!sig) { console.warn('\n⚠️  UNVERIFIABLE: intact, but unsigned (origin not attested)'); process.exit(1); }

  const state = loadKeyLog(args);
  let pub = null;
  let source = null;
  if (state) {
    const k = state.keys.get(sig.key_id);
    if (k) { pub = k.public_key_hex; source = 'the public key log'; }
  }
  if (!pub && !state) {
    const supplied = await publicKeyFrom(args, { signature: { key_id: sig.key_id } });
    if (supplied) { pub = supplied; source = args.pubkey ? 'the key you supplied' : 'almstins.com/.well-known'; }
  }

  if (!pub && state) {
    finishWithJudgement(judgeSignature(state, { keyId: sig.key_id }), 'record');
  }
  if (!pub) {
    // The file's own public key proves only that the signature is self-consistent: anyone can
    // make a key pair. It is checked, and reported as exactly that.
    const embeddedOk = !!sig.public_key_hex && verifyEd25519Hex(sig.signature_hex, utf8ToBytes(canonicalize(bundle.manifest)), sig.public_key_hex);
    console.warn(`\n⚠️  UNVERIFIABLE: signed by key ${sig.key_id}${embeddedOk ? ' (the signature matches the key the file carries)' : ''}, but nothing independent confirms that key is Almstins'. Re-run with --key-log and --root-fingerprint.`);
    process.exit(1);
  }
  if (sig.public_key_hex && String(sig.public_key_hex).toLowerCase() !== pub) {
    console.error(`\n❌ TAMPERED: the file names ${sig.key_id} but carries a different public key than ${source}`);
    process.exit(1);
  }
  if (!verifyEd25519Hex(sig.signature_hex, utf8ToBytes(canonicalize(bundle.manifest)), pub)) {
    console.error(`\n❌ TAMPERED: signature does not verify under the key from ${source}`);
    process.exit(1);
  }
  console.log(`Signature: valid under ${sig.key_id} (key from ${source})`);

  if (!state) {
    console.log(`\n✅ VERIFIED: signature valid under the key from ${source}.`);
    console.log('   Not checked: whether that key was revoked. Use --key-log for that.');
    process.exit(0);
  }
  if (args.anchoredAt && !ISO_UTC.test(args.anchoredAt)) { console.error('❌ --anchored-at must be ISO 8601 UTC'); process.exit(1); }
  if (a && !args.anchoredAt) console.log('Note: pass --anchored-at <time from ots verify> to date the record.');
  finishWithJudgement(judgeSignature(state, {
    keyId: sig.key_id, publicKeyHex: pub,
    signatureProvenAt: null, // Phase 2: the signature checkpoint's Bitcoin time
    contentAnchoredAt: a ? args.anchoredAt ?? null : null,
  }), 'genuine, unaltered Almstins record');
}

function verifyEd25519Hex(sigHex, bytes, pubHex) {
  try { return ed.verify(hexToBytes(String(sigHex)), bytes, hexToBytes(String(pubHex))); } catch { return false; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) { console.error('usage: node scripts/verify-record.mjs <proof.json> [--key-log <log.jsonl> --root-fingerprint <hex>] [--anchored-at <iso>] [--write-ots <file>] [--pubkey <hex> | --well-known <url>]'); process.exit(1); }

  let bundle;
  try { bundle = JSON.parse(readFileSync(file, 'utf8')); }
  catch { console.error('❌ malformed: not valid JSON'); process.exit(1); }
  if (bundle?.proof_format === 'almstins-signed-record/v1' && bundle.manifest && typeof bundle.manifest === 'object') {
    return verifyRecordFile(bundle, args);
  }
  if (!bundle?.manifest || !Array.isArray(bundle.leaves)) { console.error('❌ malformed: not a proof bundle'); process.exit(1); }

  const m = bundle.manifest;
  const leaves = orderLeaves(bundle.leaves);
  const recomputed = bytesToHex(buildMerkleRoot(leaves.map((l) => hashLeaf(serializeLeaf(l)))));

  console.log(`Record ${m.record_id}  ·  ${m.period} ${m.record_type}  ·  ${m.leaf_count} entries  ·  generated ${m.generated_at}`);
  console.log(`Merkle root (manifest):   ${m.merkle_root}`);
  console.log(`Merkle root (recomputed): ${recomputed}`);

  if (recomputed !== String(m.merkle_root).toLowerCase()) { console.error('\n❌ TAMPERED: entries do not hash to the recorded root'); process.exit(1); }
  if (leaves.length !== m.leaf_count) { console.error('\n❌ TAMPERED: leaf count mismatch'); process.exit(1); }
  if (!bundle.signature) { console.warn('\n⚠️  UNVERIFIABLE: intact, but unsigned (origin not attested)'); process.exit(1); }

  const state = loadKeyLog(args);
  const logged = state ? state.keys.get(bundle.signature.key_id) : null;
  if (state && !logged) finishWithJudgement(judgeSignature(state, { keyId: bundle.signature.key_id }), 'record');
  const pub = logged ? logged.public_key_hex : await publicKeyFrom(args, bundle);
  if (!pub) { console.warn(`\n⚠️  UNVERIFIABLE: signed (key ${bundle.signature.key_id}) but no public key supplied. Re-run with --key-log and --root-fingerprint (or --pubkey or --well-known).`); process.exit(1); }

  let sigOk = false;
  try { sigOk = ed.verify(hexToBytes(bundle.signature.signature_hex), utf8ToBytes(canonicalize(signedManifestView(m))), hexToBytes(pub)); } catch { sigOk = false; }
  if (!sigOk) { console.error('\n❌ TAMPERED: signature does not verify under the supplied key'); process.exit(1); }

  if (state) {
    // A bundle carries no Bitcoin proof of its own, so nothing dates its signature (Phase 2
    // signature checkpoints will). Integrity and the signature are already proven above.
    console.log('   (Does NOT attest tax correctness: see the bundle disclaimer.)');
    finishWithJudgement(judgeSignature(state, { keyId: bundle.signature.key_id, publicKeyHex: pub }), 'genuine, unaltered Almstins record (integrity + origin + source-traceability)');
  }
  console.log('\n✅ VERIFIED: genuine, unaltered Almstins record (integrity + origin + source-traceability).');
  console.log('   (Does NOT attest tax correctness: see the bundle disclaimer.)');
  process.exit(0);
}

main();
