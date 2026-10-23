// The owner's tool for the public Almstins key log (format and rules: scripts/keylog.mjs).
// Run it on the owner's own machine, in a clone of github.com/dstr88/almstins-keys, never on
// Render. It handles PUBLIC record keys only: it never reads ALMSTINS_SIGNING_KEY or any env var.
// The root seed is read from a file the owner names, is never printed, and must live outside
// every git checkout (new-root refuses a path inside one).
//
//   node scripts/key-log.mjs new-root --out <file outside any repo>
//   node scripts/key-log.mjs init        --log <dir> --root-seed <file>
//   node scripts/key-log.mjs add-key     --log <dir> --root-seed <file> --key-id <id> --public-key <hex> --valid-from <iso>
//   node scripts/key-log.mjs retire      --log <dir> --root-seed <file> --key-id <id> --at <iso>
//   node scripts/key-log.mjs revoke      --log <dir> --root-seed <file> --key-id <id> --compromised-since <iso> --reason <text>
//   node scripts/key-log.mjs rotate-root --log <dir> --root-seed <file> --new-root-public-key <hex>
//   node scripts/key-log.mjs verify      --log <dir> [--root-fingerprint <hex>]
//
// Every write appends one line to <dir>/log.jsonl and writes the new chain head to
// <dir>/heads/<seq>.txt. Stamp that file with the OpenTimestamps client (`ots stamp`), commit
// both and push. --key-id and --public-key are copied from the live
// /.well-known/almstins-signing-key.json; the key id must be the one derived from the key, which
// catches a pasted seed. --now <iso> sets recorded_at (default: the current time).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  parseLog, verifyLog, appendEntry, entryLine, deriveKeyId, deriveRootId, rootFingerprint, isPublicKey,
} from './keylog.mjs';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function die(msg) { console.error(`key-log: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const out = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) die(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return out;
}

function need(args, name) {
  const v = args[name];
  if (v === undefined || v === '') die(`--${name} is required`);
  return String(v);
}

function needIso(args, name) {
  const v = need(args, name);
  if (!ISO_UTC.test(v)) die(`--${name} must be ISO 8601 UTC, like 2026-10-23T00:00:00Z`);
  return v;
}

function insideGitCheckout(path) {
  try {
    execFileSync('git', ['-C', dirname(resolve(path)), 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function readRootSeed(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8').trim().toLowerCase(); } catch { die(`cannot read the root seed file ${path}`); }
  if (!/^[0-9a-f]{64}$/.test(raw)) die('the root seed file must hold 64 hex characters');
  return hexToBytes(raw);
}

function readLog(dir) {
  const file = join(dir, 'log.jsonl');
  return existsSync(file) ? parseLog(readFileSync(file, 'utf8')) : [];
}

function writeEntry(dir, entries, fields, seed) {
  const check = verifyLog(entries);
  if (entries.length && !check.ok) die(`the existing log does not verify: ${check.errors.join('; ')}`);
  let entry;
  try { entry = appendEntry(entries, fields, seed, args.now); } catch (e) { die(String(e.message || e)); }
  mkdirSync(join(dir, 'heads'), { recursive: true });
  appendFileSync(join(dir, 'log.jsonl'), entryLine(entry) + '\n');
  const head = verifyLog([...entries, entry]).head;
  const headFile = join(dir, 'heads', `${entry.seq}.txt`);
  writeFileSync(headFile, head + '\n');
  console.log(`Appended entry ${entry.seq} (${entry.type} ${entry.key_id}).`);
  console.log(`Chain head: ${head}`);
  console.log(`Next: ots stamp ${headFile}   then commit log.jsonl and heads/ and push.`);
}

function rootKeyOf(entries) {
  const state = verifyLog(entries);
  if (!state.ok) die(`the log does not verify: ${state.errors.join('; ')}`);
  return state;
}

function assertSeedIsCurrentRoot(state, seed) {
  if (bytesToHex(ed.getPublicKey(seed)) !== state.root.public_key_hex) die('that root seed is not the log\'s current root key');
}

const args = parseArgs(process.argv.slice(2));

switch (args.cmd) {
  case 'new-root': {
    const out = need(args, 'out');
    if (existsSync(out)) die(`${out} already exists; refusing to overwrite a root seed`);
    if (insideGitCheckout(out)) die(`${out} is inside a git checkout; keep the root seed outside every repository`);
    const seed = ed.utils.randomSecretKey();
    writeFileSync(out, bytesToHex(seed) + '\n', { mode: 0o600 });
    const pub = bytesToHex(ed.getPublicKey(seed));
    console.log(`Root seed written to ${out} (mode 600). Keep it offline; back it up on paper.`);
    console.log(`Root public key:  ${pub}`);
    console.log(`Root key id:      ${deriveRootId(pub)}`);
    console.log(`Root fingerprint: ${rootFingerprint(pub)}   <- post this publicly`);
    break;
  }
  case 'init': {
    const dir = need(args, 'log');
    if (readLog(dir).length) die('the log already has entries');
    const seed = readRootSeed(need(args, 'root-seed'));
    const pub = bytesToHex(ed.getPublicKey(seed));
    writeEntry(dir, [], { type: 'root', key_id: deriveRootId(pub), public_key_hex: pub }, seed);
    break;
  }
  case 'add-key': {
    const dir = need(args, 'log');
    const entries = readLog(dir);
    const state = rootKeyOf(entries);
    const seed = readRootSeed(need(args, 'root-seed'));
    assertSeedIsCurrentRoot(state, seed);
    const pub = need(args, 'public-key').trim().toLowerCase();
    const keyId = need(args, 'key-id').trim().toLowerCase();
    if (!isPublicKey(pub)) die('--public-key is not an Ed25519 public key');
    if (deriveKeyId(pub) !== keyId) die('--key-id is not the id of --public-key. Copy both from the same well-known entry; never paste a seed.');
    if (pub === state.root.public_key_hex) die('a record key must not be the root key');
    writeEntry(dir, entries, { type: 'key-added', key_id: keyId, public_key_hex: pub, at: needIso(args, 'valid-from') }, seed);
    break;
  }
  case 'retire':
  case 'revoke': {
    const dir = need(args, 'log');
    const entries = readLog(dir);
    const state = rootKeyOf(entries);
    const seed = readRootSeed(need(args, 'root-seed'));
    assertSeedIsCurrentRoot(state, seed);
    const keyId = need(args, 'key-id').trim().toLowerCase();
    const k = state.keys.get(keyId);
    if (!k) die(`${keyId} is not in the log`);
    const revoke = args.cmd === 'revoke';
    writeEntry(dir, entries, {
      type: revoke ? 'key-revoked' : 'key-retired', key_id: keyId, public_key_hex: k.public_key_hex,
      at: revoke ? needIso(args, 'compromised-since') : needIso(args, 'at'),
      ...(revoke ? { reason: need(args, 'reason') } : {}),
    }, seed);
    break;
  }
  case 'rotate-root': {
    const dir = need(args, 'log');
    const entries = readLog(dir);
    const state = rootKeyOf(entries);
    const seed = readRootSeed(need(args, 'root-seed'));
    assertSeedIsCurrentRoot(state, seed);
    const pub = need(args, 'new-root-public-key').trim().toLowerCase();
    if (!isPublicKey(pub)) die('--new-root-public-key is not an Ed25519 public key');
    writeEntry(dir, entries, { type: 'root-rotated', key_id: deriveRootId(pub), public_key_hex: pub }, seed);
    console.log(`New root fingerprint: ${rootFingerprint(pub)}   <- post this publicly too`);
    break;
  }
  case 'verify': {
    const dir = need(args, 'log');
    const state = verifyLog(readLog(dir), { expectedRootFingerprint: args['root-fingerprint'] });
    if (!state.ok) die(`the log does NOT verify: ${state.errors.join('; ')}`);
    console.log(`Log verifies: ${state.length} entries, head ${state.head}`);
    console.log(`Root: ${state.root.root_id}  fingerprint ${rootFingerprint(state.root.public_key_hex)}`);
    for (const k of state.keys.values()) {
      const status = k.compromised_since ? `REVOKED, compromised since ${k.compromised_since}`
        : k.retired_at ? `retired ${k.retired_at}` : 'in force';
      console.log(`  ${k.key_id}  valid from ${k.valid_from}  ${status}`);
    }
    break;
  }
  default:
    die('usage: key-log.mjs new-root|init|add-key|retire|revoke|rotate-root|verify ... (see the header of scripts/key-log.mjs)');
}
