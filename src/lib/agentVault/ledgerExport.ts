/**
 * The signed export of one agent's ledger: every check the agent asked and every transfer the Vault
 * recorded for it, in a range of UTC days, as one file an accountant or an auditor can check without
 * trusting Almstins.
 *
 *   events -> one canonical leaf for each -> Merkle root -> manifest -> Ed25519 signature -> bundle
 *
 * It is built from the same parts as a Year Summary proof and an operator report (reportProof.ts,
 * src/lib/recordProof/*), so the same checkers read it without a change: the public page
 * /verify-record, POST /api/verify-record and scripts/verify-record.mjs. The record type is
 * `agent_ledger`.
 *
 * THE RANGE is UTC days, both ends counted (`2026-10-01` to `2026-10-18`), or, for a day that holds more
 * events than one file carries, UTC minutes (`2026-10-18T06:00` to `2026-10-18T11:59`, the last minute
 * counted through its end). The two forms mix: a day can start a range that a minute ends. The
 * manifest says the exact first moment and the first moment after (`period_start`, `period_end`) either way.
 *
 * WHAT IS SIGNED. The manifest (the part that travels with the signature) holds the agent's id and
 * name, the range, how many checks and transfers there are, when the file was made, the Merkle root
 * and the key that signed it; it holds no address. The events are the leaves: each is one canonical
 * record, so the root commits to every line of the file and any single event is individually provable
 * (rwaProof's proveRecordInclusion and verifyRecordInclusion take a leaf and the root). A changed
 * amount, address, time or answer breaks the root. The caller's address (kept as metadata for the
 * rate limiter, never part of what the owner reads) and the free text of what a check recorded are
 * not in the file.
 *
 * WHAT THE SIGNATURE SAYS. That this is the ledger as Almstins stored it when the file was made, and
 * that it is unaltered. It does not say the agent asked before every payment, and it does not cover a
 * transfer to an address that was never registered: the Vault never watches one. A file is a
 * snapshot (generated_at), so a later export of the same range can hold more.
 *
 * FAIL CLOSED. There is no unsigned JSON and no way to have one presented as signed: with no signing
 * key, or a key that Almstins does not publish, the export is refused (signing_unavailable). A range
 * of more than 366 days, or one that contains more than 50,000 events, is refused (export_too_large)
 * before anything large is built. The CSV is a convenience copy of the same events and is NOT signed;
 * it is named as a copy in its file name and in its last column, which carries the bundle id of the
 * signed file so the two can be matched. The id is derived from the content (ledgerRecordId), so a
 * signed file and a CSV made from one state of the ledger carry the same id, however many minutes
 * apart they were asked for; once an event is added they no longer match, which is right. The CSV is
 * made only where the signed file can be, so it never names a file that does not exist.
 *
 * WHAT IT COSTS. A full file (50,000 events) is about half a second of hashing and tens of megabytes
 * of memory, so one is made at a time: an account has at most one export running, and the process at
 * most one (createExportGate), and the hashing gives the event loop back every few thousand events
 * (buildLedgerBundleYielding), so the site keeps answering while a large file is built. The check
 * before a file is handed over confirms the signature against the published keys; it does not hash
 * the events a second time (the root was just made from them by the code every verifier runs).
 */
import { createHash } from 'node:crypto';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { PROOF_FORMAT, TREE_ALGO, tenantScopeTag, type ProofBundle } from '@/lib/recordProof/buildProof';
import { LEAF_SCHEMA_VERSION, orderLeaves, serializeLeaf, toFixedTrimmed, type CanonicalLeaf } from '@/lib/recordProof/leaf';
import { buildMerkleRoot, hashLeaf, toHex } from '@/lib/recordProof/merkle';
import { canonicalManifestBytes, getPublishedKeys, getSigningKey, signManifestWithKey, verifyManifestSignature } from '@/lib/recordProof/signing';
import { verifyBundle, type VerifyOutcome } from '@/lib/recordProof/verify';
import { countEventsInRange, readEventsInRange, type LedgerEvent } from './events';
import { fail, idOf, type Failure } from './errors';
import { basisOf, DAY_MS, dayBounds, parseDay, utcDay } from './report';
import { getTin } from './store';

export const LEDGER_RECORD_TYPE = 'agent_ledger' as const;

/** The longest range one file covers, in UTC days, both ends counted. */
export const MAX_EXPORT_DAYS = 366;
/** The most events one file holds. */
export const MAX_EXPORT_EVENTS = 50_000;
/** A transfer's USD value is written to the micro-dollar, the precision the totals are summed at (money.ts). */
const USD_PLACES = 6;

/**
 * How often an account may ask for an export: this many requests in one window, counted per account
 * in this process only (it resets on a restart). A person downloading a file never nears it; a script
 * looping on it does. Exports are heavy (a whole range is read and hashed), so they have a budget of
 * their own and never spend the one for making a report.
 */
export const EXPORT_REQUESTS_PER_WINDOW = 6;
export const EXPORT_REQUEST_WINDOW_MS = 60_000;

export interface ExportRequestLimiter {
  /** Counts one request for the account and says whether it is now over its budget. */
  tooMany(tenantId: string, now?: number): boolean;
}

export function createExportRequestLimiter(): ExportRequestLimiter {
  const limiter = createFixedWindowLimiter({ windowMs: EXPORT_REQUEST_WINDOW_MS, max: EXPORT_REQUESTS_PER_WINDOW });
  return { tooMany: (tenantId, now) => limiter.hit(`t:${tenantId}`, now) };
}

/** Exports being made at once in this process. A full file is tens of megabytes of memory, so one at a time. */
export const MAX_EXPORTS_IN_FLIGHT = 1;

export interface ExportGate {
  /**
   * Takes the place for one export, or null when the account already has one running or the process is
   * at its limit. The caller that gets a function back must call it when the export is over, however
   * it ended; calling it twice is harmless.
   */
  enter(tenantId: string): (() => void) | null;
}

/** A gate with its own count, so a test (or a second route) can have one that is not shared. */
export function createExportGate(opts: { perProcess?: number } = {}): ExportGate {
  const perProcess = opts.perProcess ?? MAX_EXPORTS_IN_FLIGHT;
  const running = new Set<string>();
  return {
    enter(tenantId) {
      // One per account is a rule of its own, not only a consequence of the process limit: when the
      // process limit is raised, an account still cannot start two.
      if (running.has(tenantId) || running.size >= perProcess) return null;
      running.add(tenantId);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        running.delete(tenantId);
      };
    },
  };
}

// ── The leaves ───────────────────────────────────────────────────────────────

export interface CheckedLeaf {
  v: 1;
  kind: 'checked';
  /** When the agent asked, UTC ISO-8601 with milliseconds. The leaf's place in time. */
  date: string;
  event_id: string;
  address: string;
  /** The chain of the registry row for this address when it was asked about, or null when it was not registered. */
  chain: string | null;
  /** What it was answered: proven, consistent-with-history, flagged or unknown. */
  answer: string | null;
  /** What the registry said about the address: trusted, flagged, pending or none. */
  registry: string | null;
  /** Why it was answered as it was: a reason the report knows, or `other`. Never free text. */
  basis: string;
  /** The key that asked. */
  key_id: string | null;
}

export interface TransferLeaf {
  v: 1;
  kind: 'transaction';
  /** The time of the block, UTC ISO-8601 with milliseconds. */
  date: string;
  event_id: string;
  /** The registered, trusted destination: the other side of the transfer. */
  address: string;
  chain: string | null;
  /** The verify-status taken from the check that came before it (`unknown` when none did). */
  answer: string | null;
  registry: string | null;
  /** Why no check stands behind it, when none does: no_preceding_check or ambiguous_checks. */
  reason: string | null;
  /** The event id of the check it took its status from. */
  linked_check: string | null;
  tx_hash: string;
  /** `in` reached the agent's wallet (bought); `out` left it (sold). */
  direction: 'in' | 'out';
  /** The agent's own wallet on this transfer. */
  wallet: string;
  /** The exact amount, in whole units of the asset, as a decimal string. */
  amount: string;
  /** The asset's symbol as the explorer reported it. */
  asset: string;
  asset_contract: string | null;
  /** USD at the time of the transfer as a decimal string, or null when it could not be priced (never "0" for "unknown"). */
  usd: string | null;
  block_number: number | null;
}

export type LedgerLeaf = CheckedLeaf | TransferLeaf;

const LINK_REASONS: ReadonlySet<string> = new Set(['no_preceding_check', 'ambiguous_checks']);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The canonical record of one ledger event, or null for an event this export does not carry (a
 * transfer with no facts, which the table's own CHECK does not allow). Pure. Only recognized values
 * go in: a reason is a code, never what the detail happened to say.
 */
export function leafOf(e: LedgerEvent): LedgerLeaf | null {
  if (e.kind === 'checked') {
    return {
      v: 1,
      kind: 'checked',
      date: e.at,
      event_id: e.id,
      address: e.address,
      chain: e.chain,
      answer: e.answer,
      registry: e.registry,
      basis: basisOf(e.detail),
      key_id: e.keyId,
    };
  }
  if (e.kind === 'transaction' && e.tx) {
    const reason = e.detail?.reason;
    const link = e.detail?.link as { eventId?: unknown } | null | undefined;
    return {
      v: 1,
      kind: 'transaction',
      date: e.at,
      event_id: e.id,
      address: e.address,
      chain: e.chain,
      answer: e.answer,
      registry: e.registry,
      reason: typeof reason === 'string' && LINK_REASONS.has(reason) ? reason : null,
      linked_check: link && typeof link.eventId === 'string' && EVENT_ID.test(link.eventId) ? link.eventId : null,
      tx_hash: e.tx.hash,
      direction: e.tx.direction,
      wallet: e.tx.wallet,
      amount: e.tx.amount,
      asset: e.tx.asset,
      asset_contract: e.tx.assetContract,
      usd: toFixedTrimmed(e.tx.usd, USD_PLACES),
      block_number: e.tx.blockNumber,
    };
  }
  return null;
}

// ── The range ────────────────────────────────────────────────────────────────

export interface ExportRange {
  /** The first day or minute, as the query wrote it: `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, UTC. */
  from: string;
  /** The last day or minute, counted in, as written. */
  to: string;
  /** Days the range spans (a part of a day counts as a day), both ends counted. */
  days: number;
}

const MINUTE_MS = 60_000;
const MINUTE_FORM = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** One end of a range as a query writes it: a UTC day (`2026-10-18`) or a UTC minute (`2026-10-18T14:30`). Null for anything else. */
function readEnd(raw: unknown): { text: string; day: string; minute: number | null } | null {
  const whole = parseDay(raw);
  if (whole) return { text: whole, day: whole, minute: null };
  const m = typeof raw === 'string' ? MINUTE_FORM.exec(raw) : null;
  if (!m) return null;
  const day = parseDay(m[1]);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (!day || hour > 23 || minute > 59) return null;
  return { text: raw as string, day, minute: hour * 60 + minute };
}

/**
 * The first moment of a range and the first moment after it (exclusive), UTC ISO-8601 with milliseconds,
 * for a `from` and a `to` as written (days or minutes). A day starts at its first moment and ends where
 * the next begins; a minute starts at its first moment, and as the last of a range it is counted
 * through its end. Null when either is not a day or a minute. Nothing here checks the order or the clock.
 */
export function rangeBounds(from: string, to: string): { start: string; end: string } | null {
  const a = readEnd(from);
  const b = readEnd(to);
  if (!a || !b) return null;
  const startMs = Date.parse(`${a.day}T00:00:00.000Z`) + (a.minute ?? 0) * MINUTE_MS;
  const endMs = Date.parse(`${b.day}T00:00:00.000Z`) + (b.minute === null ? DAY_MS : (b.minute + 1) * MINUTE_MS);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

/**
 * A range from a query string: each end a real UTC day or a real UTC minute, the start before the end,
 * the last day or minute named already begun (a day that has not begun has nothing to export, and
 * neither has a minute: `nowMs` is the clock for that, left out where only days are asked), and at
 * most MAX_EXPORT_DAYS days. A malformed or backwards range is invalid_period; a range that is only
 * too long is export_too_large.
 */
export function parseExportRange(fromRaw: unknown, toRaw: unknown, today: string, nowMs?: number): ({ ok: true } & ExportRange) | Failure {
  const a = readEnd(fromRaw);
  const b = readEnd(toRaw);
  const bounds = a && b ? rangeBounds(a.text, b.text) : null;
  if (!a || !b || !bounds) return fail('invalid_period');
  const startMs = Date.parse(bounds.start);
  const endMs = Date.parse(bounds.end);
  if (!(startMs < endMs) || b.day > today) return fail('invalid_period');
  if (b.minute !== null && nowMs !== undefined && Date.parse(`${b.day}T00:00:00.000Z`) + b.minute * MINUTE_MS > nowMs) return fail('invalid_period');
  const days = Math.ceil((endMs - startMs) / DAY_MS);
  if (days > MAX_EXPORT_DAYS) return fail('export_too_large', MAX_EXPORT_DAYS);
  return { ok: true, from: a.text, to: b.text, days };
}

// ── The manifest and the bundle ──────────────────────────────────────────────

/**
 * The id of an export: the same account, agent, range and ledger content always give the same id, and
 * nothing else does. So the signed file and the CSV that are made from one state of the ledger carry
 * the same bundle id and the same Merkle root, and a person can match them by either; a new event
 * changes the root, and with it the id. A hash of those parts, shaped like a UUID. Hashing the account
 * in keeps ids from being shared across accounts.
 */
export function ledgerRecordId(tenantId: string, tinId: string, from: string, to: string, merkleRoot: string): string {
  const hex = createHash('sha256').update(['agent-ledger-export', tenantId, tinId, from, to, merkleRoot].join('\u0000')).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const AGENT_LEDGER_DISCLAIMER =
  'This proof attests INTEGRITY (the lines of this ledger export are unaltered), ORIGIN (signed by the Almstins key ' +
  'it names, which Almstins publishes) and the time the file was generated. It evidences what the Agent Vault had ' +
  'recorded for this agent in the range, and when. It does NOT attest that the agent asked before every payment, ' +
  'that any underlying check, address or transfer was correct or complete, or anything about a transfer to an ' +
  'address that was never registered: the Vault does not watch one. The agent name (tin_label) is text the ' +
  'account holder chose; Almstins did not check it.';

const APP_BASE = process.env.APP_URL ?? 'https://almstins.com';

export interface LedgerManifest {
  v: 1;
  /** Derived from the account, the agent, the range and the Merkle root (ledgerRecordId): two exports of one state of the ledger share it. */
  record_id: string;
  /** An opaque tag for the account (recordProof tenantScopeTag): the same account always gets the same tag, and it is not the account id. */
  tenant_scope_tag: string;
  record_type: typeof LEDGER_RECORD_TYPE;
  /** The range in words: `2026-10-01 to 2026-10-18` (UTC days, both counted), or `2026-10-18 06:00 to 2026-10-18 11:59 UTC` (UTC minutes, the last counted through its end). */
  period: string;
  /** The UTC day the range starts in, and the UTC day its last moment falls in. */
  from_day: string;
  to_day: string;
  /** The first moment of the range, and the first moment after it (exclusive), UTC ISO-8601 with milliseconds. */
  period_start: string;
  period_end: string;
  /** True when the file was made before the range ended (a range that runs to today), so it covers part of its last day. */
  partial: boolean;
  tin_id: string;
  /** The agent's name as its owner wrote it. Untrusted text. */
  tin_label: string;
  data_source: 'ledger';
  merkle_root: string;
  leaf_count: number;
  leaf_schema_version: number;
  tree_algo: string;
  /** Events by kind. */
  counts: { checked: number; transaction: number };
  /** An export is not chained to another: always null, here because the shared shape has the field. */
  prev_root: null;
  generated_at: string;
  signing_key_id: string | null;
  schema_version: '1';
  verify_url: string;
  disclaimer: string;
}

export interface LedgerBundle {
  manifest: LedgerManifest;
  signature: { alg: 'Ed25519'; key_id: string; signature_hex: string } | null;
  /** The events, in the order every verifier orders them, so the bundle verifies offline from itself alone. */
  leaves: LedgerLeaf[];
  leaf_hashes: string[];
  proof_format: string;
}

/** The signed surface of a manifest: everything but the presentational fields (the same rule every verifier applies). */
function signedView(m: LedgerManifest): Omit<LedgerManifest, 'verify_url' | 'disclaimer'> {
  const { verify_url: _v, disclaimer: _d, ...signed } = m;
  return signed;
}

const ordered = (leaves: LedgerLeaf[]): LedgerLeaf[] => orderLeaves(leaves as unknown as CanonicalLeaf[]) as unknown as LedgerLeaf[];

export interface BuildLedgerInput {
  tenantId: string;
  tin: { id: string; label: string };
  range: { from: string; to: string };
  /** The file was made before the range ended. */
  partial: boolean;
  /** When the file was made, UTC ISO-8601 with milliseconds. */
  generatedAt: string;
  /** Names the file; a test may fix it. Left out, it is derived from the content (ledgerRecordId). */
  recordId?: string;
  leaves: LedgerLeaf[];
}

/**
 * The signed bundle for a set of leaves, or an unsigned one (signature null, signing_key_id null)
 * when no signing key is configured. Pure apart from reading the key. The endpoint never serves an
 * unsigned one; this stays able to build it so a test can show exactly what unsigned looks like.
 */
export function buildLedgerBundle(input: BuildLedgerInput): LedgerBundle {
  const leaves = ordered(input.leaves);
  return assembleBundle(input, leaves, leaves.map(hashOne));
}

const hashOne = (leaf: LedgerLeaf): Uint8Array => hashLeaf(serializeLeaf(leaf as unknown as CanonicalLeaf));

/** Leaves hashed between two turns the event loop gets: about 20 milliseconds of work. */
export const HASH_CHUNK = 2_000;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The same bundle as buildLedgerBundle, byte for byte, built so that the process keeps answering
 * other requests: the hashing, which is most of the work, gives the event loop back every HASH_CHUNK
 * leaves. This is what the endpoint uses; the synchronous one stays for tests and small callers.
 */
export async function buildLedgerBundleYielding(input: BuildLedgerInput): Promise<LedgerBundle> {
  const leaves = ordered(input.leaves);
  const hashes: Uint8Array[] = new Array(leaves.length);
  for (let i = 0; i < leaves.length; i += 1) {
    hashes[i] = hashOne(leaves[i]);
    if ((i + 1) % HASH_CHUNK === 0) await yieldToEventLoop();
  }
  return assembleBundle(input, leaves, hashes);
}

/** The manifest, the root over the hashes and the signature, for leaves already in order and hashed. */
function assembleBundle(input: BuildLedgerInput, leaves: LedgerLeaf[], hashes: Uint8Array[]): LedgerBundle {
  const key = getSigningKey();
  const bounds = rangeBounds(input.range.from, input.range.to) ?? { start: dayBounds(input.range.from).start, end: dayBounds(input.range.to).end };
  // A range written in days is named in days; one with a minute in it is named to the minute (its last minute counted through its end).
  const windowed = input.range.from.length > 10 || input.range.to.length > 10;
  const minuteText = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const lastMoment = Date.parse(bounds.end) - 1;
  const merkleRoot = toHex(buildMerkleRoot(hashes));
  const manifest: LedgerManifest = {
    v: 1,
    record_id: input.recordId ?? ledgerRecordId(input.tenantId, input.tin.id, input.range.from, input.range.to, merkleRoot),
    tenant_scope_tag: tenantScopeTag(input.tenantId),
    record_type: LEDGER_RECORD_TYPE,
    period: windowed ? `${minuteText(Date.parse(bounds.start))} to ${minuteText(Date.parse(bounds.end) - MINUTE_MS)} UTC` : `${input.range.from} to ${input.range.to}`,
    from_day: bounds.start.slice(0, 10),
    to_day: utcDay(lastMoment),
    period_start: bounds.start,
    period_end: bounds.end,
    partial: input.partial,
    tin_id: input.tin.id,
    tin_label: input.tin.label,
    data_source: 'ledger',
    merkle_root: merkleRoot,
    leaf_count: leaves.length,
    leaf_schema_version: LEAF_SCHEMA_VERSION,
    tree_algo: TREE_ALGO,
    counts: { checked: leaves.filter((l) => l.kind === 'checked').length, transaction: leaves.filter((l) => l.kind === 'transaction').length },
    prev_root: null,
    generated_at: input.generatedAt,
    signing_key_id: key ? key.keyId : null,
    schema_version: '1',
    verify_url: `${APP_BASE}/verify-record`,
    disclaimer: AGENT_LEDGER_DISCLAIMER,
  };
  const signed = key ? signManifestWithKey(canonicalManifestBytes(signedView(manifest))) : null;
  return {
    manifest,
    signature: signed ? { alg: signed.alg, key_id: signed.keyId, signature_hex: signed.signatureHex } : null,
    leaves,
    leaf_hashes: hashes.map(toHex),
    proof_format: PROOF_FORMAT,
  };
}

/**
 * Checks a bundle the way the public verifier does, against the keys Almstins publishes now:
 * `verified` only when the root is the commitment over these leaves and the signature is valid
 * under a published key.
 */
export function verifyLedgerBundle(bundle: LedgerBundle): VerifyOutcome {
  const keys = getPublishedKeys().map((k) => ({ key_id: k.key_id, public_key_hex: k.public_key_hex }));
  return verifyBundle(bundle as unknown as ProofBundle, keys);
}

/**
 * Whether a bundle's signature is one the keys Almstins publishes now can confirm. This is the check
 * the endpoint makes before it hands a file over: it catches the one failure that matters there (a
 * signing key that is not published), in constant time. It does not hash the events again: the root
 * was made from them a moment ago by the same code every verifier runs, so a second pass would only
 * repeat the work (verifyLedgerBundle is the full check, and the tests use it).
 */
export function signatureIsPublished(bundle: LedgerBundle): boolean {
  if (!bundle.signature || bundle.signature.alg !== 'Ed25519') return false;
  const sig = bundle.signature;
  const key = getPublishedKeys().find((k) => k.key_id === sig.key_id);
  if (!key) return false;
  return verifyManifestSignature(canonicalManifestBytes(signedView(bundle.manifest)), sig.signature_hex, key.public_key_hex);
}

// ── Making an export ─────────────────────────────────────────────────────────

export interface ExportDeps {
  now: () => Date;
  /** Fixes the file's id; a test may. Left out, the id is derived from the content (ledgerRecordId). */
  newId?: () => string;
}

export const defaultExportDeps: ExportDeps = { now: () => new Date() };

/**
 * Makes the signed export of one agent's ledger for a range of UTC days, or says why it cannot. The
 * moment it starts is the cutoff: the file holds the events from before it, and no later one. The
 * file's `generated_at` is read after the ledger has been, so everything in the file was already
 * recorded when it says the file was made, and nothing recorded after that moment can be in it.
 *
 * Refused, with nothing built: an agent that is not this account's (tin_not_found, exactly like one
 * that does not exist), a range that is malformed, backwards or in the future (invalid_period), a
 * range that is longer than a year or holds too many events (export_too_large), no signing key or one
 * that is not published (signing_unavailable).
 */
export async function exportLedger(
  tenantId: string,
  tinIdRaw: unknown,
  fromRaw: unknown,
  toRaw: unknown,
  deps: ExportDeps = defaultExportDeps,
): Promise<{ ok: true; bundle: LedgerBundle } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');

  const cutoffMs = deps.now().getTime();
  const range = parseExportRange(fromRaw, toRaw, utcDay(cutoffMs), cutoffMs);
  if (!range.ok) return range;
  // No key, no file: before anything is read.
  if (!getSigningKey()) return fail('signing_unavailable');

  const bounds = rangeBounds(range.from, range.to);
  if (!bounds) return fail('invalid_period'); // cannot happen after a range that parsed; never read with bounds that are not there
  const start = bounds.start;
  const rangeEnd = bounds.end;
  // Nothing from after the moment the export started is in it.
  const end = new Date(Math.min(Date.parse(rangeEnd), cutoffMs + 1)).toISOString();

  if ((await countEventsInRange(tenantId, tin.id, { fromIso: start, toIso: end })) > MAX_EXPORT_EVENTS) return fail('export_too_large', MAX_EXPORT_EVENTS);

  const leaves: LedgerLeaf[] = [];
  let overflowed = false;
  await readEventsInRange(tenantId, tin.id, { fromIso: start, toIso: end }, (event) => {
    if (leaves.length >= MAX_EXPORT_EVENTS) {
      // Events arrived between the count and the read: still refused, never cut short and handed over as whole.
      overflowed = true;
      return;
    }
    const leaf = leafOf(event);
    if (leaf) leaves.push(leaf);
  });
  if (overflowed) return fail('export_too_large', MAX_EXPORT_EVENTS);

  // Read after the ledger was, never before it (and never earlier than the cutoff): the file may say
  // it was made at this moment because everything in it was recorded by then.
  const generatedAt = new Date(Math.max(deps.now().getTime(), cutoffMs)).toISOString();
  const bundle = await buildLedgerBundleYielding({
    tenantId,
    tin: { id: tin.id, label: tin.label },
    range: { from: range.from, to: range.to },
    partial: cutoffMs + 1 < Date.parse(rangeEnd),
    generatedAt,
    recordId: deps.newId?.(),
    leaves,
  });
  // Never hand over a file as signed that the published keys cannot confirm.
  if (!signatureIsPublished(bundle)) return fail('signing_unavailable');
  return { ok: true, bundle };
}

// ── What goes out ────────────────────────────────────────────────────────────

/** Pretty for a file a person may open, compact once it is large (a full export is tens of megabytes). */
export function serializeBundle(bundle: LedgerBundle): string {
  return `${JSON.stringify(bundle, null, bundle.manifest.leaf_count <= 2_000 ? 2 : undefined)}\n`;
}

/**
 * The name a file is downloaded under: the range and the first of the file's id. The signed file ends
 * in `-proof.json`; the CSV copy ends in `-unsigned-copy.csv`, so it cannot be mistaken for the
 * signed one in a folder of downloads.
 */
export function ledgerFileName(manifest: Pick<LedgerManifest, 'from_day' | 'to_day' | 'record_id'>, ext: 'json' | 'csv'): string {
  return `almstins-agent-ledger-${manifest.from_day}-to-${manifest.to_day}-${manifest.record_id.slice(0, 8)}${ext === 'json' ? '-proof.json' : '-unsigned-copy.csv'}`;
}

/**
 * The columns of the CSV copy. `reason` is why a check was answered as it was (for a check) or why no
 * check stands behind a transfer (for a transfer); it is a code, never free text. The last column is
 * the id of the signed file this is a copy of, on every line, so a single row can be matched to the
 * signed file without a line of prose in front of the header.
 */
export const CSV_COLUMNS = [
  'time_utc', 'kind', 'direction', 'address', 'chain', 'answer', 'registry', 'reason', 'wallet', 'amount', 'asset', 'asset_contract',
  'usd', 'tx_hash', 'block_number', 'event_id', 'linked_check', 'key_id', 'unsigned_copy_of_bundle_id',
] as const;

/** The byte-order mark that makes a spreadsheet read the file as UTF-8 (a token's symbol can be any text). Parsers that read UTF-8 drop it. */
const CSV_BOM = '\uFEFF';

/**
 * One CSV cell. A cell that a spreadsheet could read as a formula (it starts with =, +, - or @, or
 * with a tab or a carriage return) is written with a leading quote, because an asset's symbol comes
 * from the chain and anyone can name a token. Then RFC 4180: a cell with a comma, a quote or a line
 * break is quoted, and a quote inside it is doubled.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The CSV copy of a signed bundle: the column names first, so any program that reads a header finds
 * it on line one, then one line for each event in the order of the signed file. It is not signed, and
 * says so where a program or a person will see it: the file name ends in `-unsigned-copy.csv`, and the
 * last column of every line is `unsigned_copy_of_bundle_id`, the id of the signed file. Lines end with
 * CRLF. It starts with a byte-order mark so a spreadsheet reads it as UTF-8.
 */
export function ledgerCsv(bundle: LedgerBundle): string {
  const copyOf = bundle.manifest.record_id;
  const rows = bundle.leaves.map((l) => {
    const t = l.kind === 'transaction' ? l : null;
    return [
      l.date, l.kind === 'checked' ? 'checked' : 'transaction', t ? t.direction : '', l.address, l.chain, l.answer, l.registry, t ? t.reason : (l as CheckedLeaf).basis,
      t ? t.wallet : '', t ? t.amount : '', t ? t.asset : '', t ? t.asset_contract : '', t ? t.usd : '', t ? t.tx_hash : '', t ? t.block_number : '', l.event_id,
      t ? t.linked_check : '', l.kind === 'checked' ? l.key_id : '', copyOf,
    ].map(csvCell).join(',');
  });
  return CSV_BOM + [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
