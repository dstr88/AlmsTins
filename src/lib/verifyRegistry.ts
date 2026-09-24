/**
 * Almstins Verify — Destination registry (Phase 1).
 *
 * A Destination is a payment endpoint a merchant publishes and wants to monitor
 * for swaps: a crypto receiving address (kind='address') or a payment QR
 * (kind='qr'). One rail-agnostic table; the proof + monitoring layers build on it.
 *
 * Tenant isolation is app-enforced: every query is scoped by `tenant_id`, exactly
 * like the PetroTins tables. Lazy ensureTables() mirrors that pattern.
 *
 * NON-NEGOTIABLE: read-only, no custody, no fund movement. We store only what the
 * owner registers about their OWN destinations, linked privately to their account.
 */
import { db } from '@/lib/db';
import { randomUUID, createHash } from 'crypto';
import { generateChallenge } from './verifyProof';
import { captureSelfSendBaseline, detectBoundSelfSend, parseSelfSendBaseline, railNeedsBaseline } from './verifyDeposit';
import {
  allocateTestAmount, canonicalAddress, formatTestAmount, isCaselessAddress, planIssue, recentPerTenant,
  testAmountSpec, type OwnDraw,
} from './verifyTestAmount';
import { isEmvPayload, parseEmv, parseUpi, paymentFormat } from './paymentQr';
import { normalizeName, registrableLabel, nameMatchesDomain } from './verifyNameMatch';
import { decideAnchor, decideAnchorLoss } from './verifyAnchor';

/** SHA-256 hex — used to store a non-URL payment-QR identifier (PIX key / UPI VPA) as a
 *  hash, never the raw key (it can be a CPF/phone/email — PII we never hold). */
function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Timestamp matching the columns' `to_char(now() … 'YYYY-MM-DD HH24:MI:SS')` default. */
const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
/** Epoch ms → the same 'YYYY-MM-DD HH:MM:SS' UTC stamp. */
const toStamp = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
/** A stored UTC stamp → epoch ms (NaN when missing or unparseable). */
const stampMs = (s: unknown): number => (s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : NaN);
/** A stored UTC stamp → ISO 8601 with Z, so the browser can show it in local time. */
const stampIso = (s: unknown): string => String(s ?? '').replace(' ', 'T') + 'Z';

export type DestinationKind = 'address' | 'qr';
export type ProofStatus = 'unproven' | 'proven' | 'lapsed' | 'revoked';
export type ProofMethod = 'none' | 'signed_nonce' | 'dns_txt' | 'well_known' | 'micro_deposit' | 'account_claim';

/** Rails offered for a receiving address (matches the chains the app already supports). */
export const ADDRESS_RAILS = ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin'] as const;

/** Free beta limits, per kind: 2 wallet addresses + 1 payment QR (3 destinations total,
 *  one of which can be a QR). One value = one destination; the same QR displayed in many
 *  places is still one row (the UNIQUE(tenant_id, kind, value) index dedups it), so
 *  placements never count against this. */
export const FREE_LIMIT_ADDRESS = 2;
export const FREE_LIMIT_QR = 1;

export interface Destination {
  id: string;
  kind: DestinationKind;
  rail: string;
  value: string;
  label: string | null;
  /** Friendly display for non-URL QR (EMV merchant name / UPI payee) — `value` is a hash. */
  displayHint: string | null;
  proofMethod: ProofMethod;
  proofStatus: ProofStatus;
  proofDomain: string | null;
  /** When proof_domain was attached (see verifyAnchor.ts anchoredSince / hasAnchor). */
  domainAnchoredAt: string | null;
  registeredAt: string;
  provenAt: string | null;
  /** Phase 5 — the public page (if any) we watch for a swap of this destination. */
  monitorUrl: string | null;
  monitorStatus: string | null;
  monitorCheckedAt: string | null;
  /** Owner's dashboard only (listDestinationsForOwner): the claim was made under the old,
   *  unbound self-send rule and needs the satoshi test again before a domain can anchor it.
   *  Never on a public answer. */
  needsReproof?: boolean;
}

/** The columns mapRow reads. */
const DEST_COLS = `id, kind, rail, value, label, display_hint, proof_method, proof_status, proof_domain,
  domain_anchored_at, registered_at, proven_at, monitor_url, monitor_status, monitor_checked_at`;

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS verify_destinations (
    id            TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    rail          TEXT NOT NULL,
    value         TEXT NOT NULL,
    label         TEXT,
    proof_method  TEXT NOT NULL DEFAULT 'none',
    proof_status  TEXT NOT NULL DEFAULT 'unproven',
    proof_domain  TEXT,
    registered_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_tenant_value
  ON verify_destinations (tenant_id, kind, value)`;

// Phase 3 — proof of control. One challenge per (tenant, domain); proving the
// domain flips every destination whose value the published file vouches for.
// Tenant-scoped, app-enforced isolation. Mirrors migrations-pg/0002_verify_proof.sql.
const ENSURE_PROOFS_SQL = `
  CREATE TABLE IF NOT EXISTS verify_domain_proofs (
    id              TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    domain          TEXT NOT NULL,
    challenge_token TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT 'well_known',
    status          TEXT NOT NULL DEFAULT 'pending',
    issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at       TEXT,
    last_checked_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_PROOFS_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_domain_proofs_tenant_domain
  ON verify_domain_proofs (tenant_id, domain)`;

// Claim-once: a (rail, address) can be PROVEN by only one account, globally. This
// partial unique index is the arbiter — a second account proving the same address
// is rejected at the DB layer regardless of who can see what (RLS-agnostic). The
// proof paths catch the violation and skip gracefully. It keys on the RAW (rail, value), so
// it can't see a case twin or the same address filed under another rail; isClaimedElsewhere
// (S5a) checks those before every flip. Mirrors migrations-pg/0005_verify_claim_once.sql.
const ENSURE_CLAIM_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim
  ON verify_destinations (rail, value) WHERE proof_status = 'proven' AND kind = 'address'`;

// Claim-once for QR/payment-link destinations. A proven (rail, value) URL can belong
// to only one account, globally — the customer-scan match is therefore unambiguous.
// QR destinations are proven on save (proof_method='account_claim'): an owner
// registering a payment link while authenticated in their OWN account IS the claim.
// We normalize the URL before storing (see createDestination), so this index on the
// canonical value is the real exclusivity arbiter. Mirrors
// migrations-pg/0009_verify_qr_claim.sql.
const ENSURE_CLAIM_QR_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim_qr
  ON verify_destinations (rail, value) WHERE proof_status = 'proven' AND kind = 'qr'`;

// Self-send proof (the satoshi test): one challenge row per address destination,
// reissued in place. The binding columns are added by ENSURE_DEPOSIT_COLS below.
// Mirrors migrations-pg/0006_verify_deposit.sql.
const ENSURE_DEPOSIT_SQL = `
  CREATE TABLE IF NOT EXISTS verify_deposit_challenges (
    id              TEXT NOT NULL PRIMARY KEY,
    destination_id  TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    last_checked_at TEXT,
    proven_at       TEXT,
    proof_ref       TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_DEPOSIT_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_deposit_challenges_dest
  ON verify_deposit_challenges (destination_id)`;

// Satoshi test binding (rule 'bound_v1'). A challenge carries a random EXACT amount in
// base units (a BigInt string), the coin it is sent in, the address's canonical form,
// and an expiry. The proof is a self-send of exactly that amount inside the window (see
// verifyDeposit.ts). BTC/LTC challenges also carry the baseline (JSON: the tip height and
// mempool txids at issuance), so nothing already on chain can prove them. Rows without
// rule='bound_v1' are pre-binding challenges and can no longer prove anything. Lazy
// column adds; mirrors migrations-pg/0044_verify_deposit_binding.sql.
const ENSURE_DEPOSIT_COLS = [
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS expected_amount TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS unit TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS canonical_address TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS expires_at TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS rule TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS last_outcome TEXT`,
  `ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS baseline TEXT`,
];
// Two accounts testing the same address never hold the same pending amount, so one
// self-send can satisfy at most one challenge. Global on purpose (like claim-once): the
// arbiter must see every tenant's pending amounts. A collision is resolved silently by
// drawing another amount; nothing about the other challenge is ever returned.
const ENSURE_DEPOSIT_AMOUNT_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_deposit_challenges_pending_amount
  ON verify_deposit_challenges (canonical_address, expected_amount) WHERE status = 'pending'`;
// The issuance history: one row per NEW amount a tenant draws for an address, kept 7 days.
// It is keyed by (tenant, canonical address), not by destination, and deleting a
// destination leaves it alone, so delete + re-add can't reroll an amount: while a drawn
// amount is unexpired the tenant gets it back (same window and baseline), and new draws are
// capped per address and per tenant (planIssue in verifyTestAmount.ts). It also keeps a
// reissue from repeating a recent amount, so a late send for an old amount can't land on
// someone else's new challenge. Amounts, windows and baselines only (public chain data);
// purged past 7 days on each issue.
const ENSURE_DEPOSIT_LOG_SQL = `
  CREATE TABLE IF NOT EXISTS verify_deposit_amount_log (
    id                TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    canonical_address TEXT NOT NULL,
    expected_amount   TEXT NOT NULL,
    issued_at         TEXT NOT NULL,
    expires_at        TEXT,
    baseline          TEXT
  )
`;
const ENSURE_DEPOSIT_LOG_COLS = [
  `ALTER TABLE verify_deposit_amount_log ADD COLUMN IF NOT EXISTS expires_at TEXT`,
  `ALTER TABLE verify_deposit_amount_log ADD COLUMN IF NOT EXISTS baseline TEXT`,
];
const ENSURE_DEPOSIT_LOG_IDX = `CREATE INDEX IF NOT EXISTS verify_deposit_amount_log_addr
  ON verify_deposit_amount_log (canonical_address, issued_at)`;
const ENSURE_DEPOSIT_LOG_TENANT_IDX = `CREATE INDEX IF NOT EXISTS verify_deposit_amount_log_tenant
  ON verify_deposit_amount_log (tenant_id, issued_at)`;
// Claims proven under the old, unbound rule (any outgoing tx counted). Internal only:
// nothing public reads it, so those Claimed rows look exactly as before. It marks them
// for the later contest/takeover path, keeps a domain proof from anchoring them, and lets
// the owner take the satoshi test again in place (see legacyClaimSql).
const ENSURE_LEGACY_UNBOUND_COL = `ALTER TABLE verify_destinations
  ADD COLUMN IF NOT EXISTS legacy_unbound BOOLEAN NOT NULL DEFAULT false`;
// Idempotent backfill. A bound proof's challenge row has rule='bound_v1' from the moment
// it is issued (before the destination can flip), so this only ever tags rows proven
// under the old rule: re-running it on every cold start changes nothing new. Decisions
// never rely on it alone: they read legacyClaimSql, which applies the same rule live.
const BACKFILL_LEGACY_UNBOUND = `UPDATE verify_destinations d SET legacy_unbound = true
  WHERE d.proof_method = 'micro_deposit' AND d.proof_status = 'proven' AND d.legacy_unbound = false
    AND NOT EXISTS (
      SELECT 1 FROM verify_deposit_challenges c
      WHERE c.destination_id = d.id AND c.tenant_id = d.tenant_id AND c.rule = 'bound_v1'
    )`;

/**
 * SQL predicate over a verify_destinations row `t`: its CURRENT control proof is a claim made
 * under the old, unbound self-send rule. The stored tag, OR the rule its backfill applies,
 * read live: a self-send proof with no bound (bound_v1) test that proved. So a row the
 * backfill has not reached (it failed, or has not run yet on this instance) still counts,
 * and nothing that reads this fails open. 'proven' rather than any bound_v1 row: a legacy
 * row taking the test again in place has a PENDING bound_v1 test, and must still count until
 * it proves. Pair it with proof_status = 'proven'.
 */
function legacyClaimSql(t: string): string {
  return `(${t}.legacy_unbound = true OR (${t}.proof_method = 'micro_deposit' AND NOT EXISTS (
      SELECT 1 FROM verify_deposit_challenges c
      WHERE c.destination_id = ${t}.id AND c.tenant_id = ${t}.tenant_id
        AND c.rule = 'bound_v1' AND c.status = 'proven')))`;
}

// The two data steps of migrations-pg/0035_verify_domain_anchor.sql, run with the schema so a
// deploy needs no hand-run step. Both are idempotent and can't touch a row this code writes:
// every anchor it makes sets domain_anchored_at in the same UPDATE as proof_domain.
//  1. Anchors made before the column existed were all made by the file proof itself
//     (well_known), which set proven_at at the moment it anchored the address.
//  2. Leftovers: before it, a self-send re-prove of a lapsed file-proven address kept the old
//     proof_domain. That is not an anchor (hasAnchor: the public lookup already says Claimed);
//     clearing it makes the dashboard agree and offer "Verify domain" again.
const BACKFILL_ANCHOR_DATE = `UPDATE verify_destinations SET domain_anchored_at = proven_at
  WHERE domain_anchored_at IS NULL AND proof_domain IS NOT NULL
    AND proof_method = 'well_known' AND proven_at IS NOT NULL`;
const CLEAR_LEFTOVER_DOMAIN = `UPDATE verify_destinations SET proof_domain = NULL, last_confirmed_at = NULL
  WHERE kind = 'address' AND proof_method <> 'well_known'
    AND proof_domain IS NOT NULL AND domain_anchored_at IS NULL`;

// Global business-name registry. A business name is claimed like an email handle:
// the normalized name is the PRIMARY KEY, so it belongs to exactly one tenant —
// two businesses can never register the same name. A tenant reuses its own name
// freely across its own destinations. Mirrors migrations-pg/0011_verify_claimed_names.sql.
const ENSURE_NAMES_SQL = `
  CREATE TABLE IF NOT EXISTS verify_claimed_names (
    name_key     TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    domain       TEXT,
    created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

// Phase 5 — published-source swap monitor. A destination can carry an optional public
// page URL we re-check for a swap of its value. Lazy column adds; mirrors
// migrations-pg/0010_verify_monitor.sql.
const ENSURE_MONITOR_COLS = [
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_url TEXT`,
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_status TEXT`,
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_checked_at TEXT`,
  // Fail-closed TTL: the last time the watchman POSITIVELY re-confirmed this destination
  // (an address: its domain proof still vouches it; a payment link: its published page still
  // shows it). The public lookup treats a domain-anchored destination as 'verified' only
  // while this stays within the max-stale window; a stale one degrades to 'claimed'. Advanced
  // ONLY on a positive confirm — never on an unreachable/missing attempt — so a blind monitor
  // fails safe.
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS last_confirmed_at TEXT`,
];

let ensured = false;
export async function ensureVerifyTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_IDX, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_SQL, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_IDX, args: [] });
  await db.execute({ sql: ENSURE_DEPOSIT_SQL, args: [] });
  await db.execute({ sql: ENSURE_DEPOSIT_IDX, args: [] });
  await db.execute({ sql: ENSURE_NAMES_SQL, args: [] });
  try { await db.execute({ sql: `ALTER TABLE verify_claimed_names ADD COLUMN IF NOT EXISTS domain TEXT`, args: [] }); }
  catch (e) { console.error('[verify] claimed_names.domain column not applied:', e); }
  for (const sql of ENSURE_MONITOR_COLS) {
    try { await db.execute({ sql, args: [] }); }
    catch (e) { console.error('[verify] monitor column not applied:', e); }
  }
  try { await db.execute({ sql: `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS display_hint TEXT`, args: [] }); }
  catch (e) { console.error('[verify] display_hint column not applied:', e); }
  // When proof_domain was attached. Kept apart from proven_at (when CONTROL was proven) so a
  // domain added later to a self-send-proven address doesn't inherit its older age. Mirrors
  // migrations-pg/0035_verify_domain_anchor.sql.
  try { await db.execute({ sql: `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS domain_anchored_at TEXT`, args: [] }); }
  catch (e) { console.error('[verify] domain_anchored_at column not applied:', e); }
  try {
    await db.execute({ sql: BACKFILL_ANCHOR_DATE, args: [] });
    await db.execute({ sql: CLEAR_LEFTOVER_DOMAIN, args: [] });
  } catch (e) { console.error('[verify] domain anchor backfill not applied:', e); }
  // Backstop only — never let a pre-existing duplicate-proven row break Verify.
  try { await db.execute({ sql: ENSURE_CLAIM_IDX, args: [] }); }
  catch (e) { console.error('[verify] claim-once index not applied (resolve duplicate proven claims):', e); }
  try { await db.execute({ sql: ENSURE_CLAIM_QR_IDX, args: [] }); }
  catch (e) { console.error('[verify] QR claim-once index not applied (resolve duplicate proven URLs):', e); }
  for (const sql of ENSURE_DEPOSIT_COLS) {
    try { await db.execute({ sql, args: [] }); }
    catch (e) { console.error('[verify] deposit binding column not applied:', e); }
  }
  try { await db.execute({ sql: ENSURE_DEPOSIT_AMOUNT_IDX, args: [] }); }
  catch (e) { console.error('[verify] pending-amount index not applied:', e); }
  try {
    await db.execute({ sql: ENSURE_DEPOSIT_LOG_SQL, args: [] });
    for (const sql of ENSURE_DEPOSIT_LOG_COLS) await db.execute({ sql, args: [] });
    await db.execute({ sql: ENSURE_DEPOSIT_LOG_IDX, args: [] });
    await db.execute({ sql: ENSURE_DEPOSIT_LOG_TENANT_IDX, args: [] });
  } catch (e) { console.error('[verify] deposit amount log not applied:', e); }
  try {
    await db.execute({ sql: ENSURE_LEGACY_UNBOUND_COL, args: [] });
    await db.execute({ sql: BACKFILL_LEGACY_UNBOUND, args: [] });
  } catch (e) { console.error('[verify] legacy_unbound tag not applied:', e); }
  ensured = true;
}

function mapRow(r: any): Destination {
  return {
    id: String(r.id),
    kind: (String(r.kind) === 'qr' ? 'qr' : 'address'),
    rail: String(r.rail),
    value: String(r.value),
    label: r.label ? String(r.label) : null,
    displayHint: r.display_hint ? String(r.display_hint) : null,
    proofMethod: String(r.proof_method ?? 'none') as ProofMethod,
    proofStatus: String(r.proof_status ?? 'unproven') as ProofStatus,
    proofDomain: r.proof_domain ? String(r.proof_domain) : null,
    domainAnchoredAt: r.domain_anchored_at ? String(r.domain_anchored_at) : null,
    registeredAt: String(r.registered_at),
    provenAt: r.proven_at ? String(r.proven_at) : null,
    monitorUrl: r.monitor_url ? String(r.monitor_url) : null,
    monitorStatus: r.monitor_status ? String(r.monitor_status) : null,
    monitorCheckedAt: r.monitor_checked_at ? String(r.monitor_checked_at) : null,
  };
}

export async function listDestinations(tenantId: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT ${DEST_COLS}
          FROM verify_destinations WHERE tenant_id = ?
          ORDER BY kind ASC, registered_at ASC`,
    args: [tenantId],
  });
  return (res.rows as any[]).map(mapRow);
}

/**
 * This account's proven destinations whose claim was made under the old, unbound self-send
 * rule (legacyClaimSql). Tenant-scoped; internal only (never returned to a public answer). A
 * DB error throws, so a caller that can't tell which claims are legacy does nothing with them
 * (fail closed).
 */
async function legacyClaims(tenantId: string): Promise<{ id: string; kind: DestinationKind; value: string }[]> {
  const res = await db.execute({
    sql: `SELECT d.id, d.kind, d.value FROM verify_destinations d
          WHERE d.tenant_id = ? AND d.proof_status = 'proven' AND ${legacyClaimSql('d')}`,
    args: [tenantId],
  });
  return (res.rows as any[]).map((r) => ({
    id: String(r.id), kind: String(r.kind) === 'qr' ? 'qr' : 'address', value: String(r.value),
  }));
}

/** Is this proven destination a legacy unbound claim (legacyClaimSql)? Tenant-scoped; throws
 *  on a DB error. */
async function isLegacyClaim(tenantId: string, id: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM verify_destinations d
          WHERE d.id = ? AND d.tenant_id = ? AND d.proof_status = 'proven' AND ${legacyClaimSql('d')}
          LIMIT 1`,
    args: [id, tenantId],
  });
  return res.rows.length > 0;
}

/**
 * The account's own destinations for its dashboard, each with needsReproof: a claim made under
 * the old, unbound self-send rule, so the dashboard offers the satoshi test again (in place;
 * the row stays Claimed meanwhile) instead of "Verify domain". Owner-only, never on a public
 * answer. If the flags can't be read the list still loads without them: the domain proof reads
 * them again itself and fails closed.
 */
export async function listDestinationsForOwner(tenantId: string): Promise<Destination[]> {
  const dests = await listDestinations(tenantId);
  try {
    const legacy = new Set((await legacyClaims(tenantId)).map((c) => c.id));
    return dests.map((d) => ({ ...d, needsReproof: legacy.has(d.id) }));
  } catch (e) {
    console.error('[verify] re-proof flags not read:', e);
    return dests;
  }
}

/**
 * Normalize a payment value for equality comparison. The registry stores values
 * as the owner entered them, so BOTH sides must be canonicalized the same way:
 *  - http(s) URL  → scheme + lowercased host + path (drop query/hash/trailing slash)
 *  - EVM address  → lowercased 0x… (also pulled out of ethereum:/EIP-681 URIs)
 *  - other chains → strip any URI scheme + trailing params; keep case
 *    (BTC/SOL/LTC base58/bech32 are case-sensitive — never lowercase them)
 */
/** Canonical http(s) URL: scheme + lowercased host + path, query/hash/trailing-slash dropped. */
function normalizeUrl(s: string): string {
  try {
    const u = new URL(s);
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return s.toLowerCase(); }
}

export function normalizeDestinationValue(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  // Already-normalized non-URL payment QR (hash form) → return as-is (idempotent, so
  // re-normalizing a stored value in lookup/compare/monitor still matches).
  if (/^(emvqr|upi):[0-9a-f]{64}$/.test(s)) return s;
  // Non-URL payment QR → hash the merchant identifier; we never store the raw key. A
  // dynamic PIX QR carries a PSP location URL instead of a key → match it as a URL.
  // An unparseable payload returns '' (callers treat it as invalid).
  if (isEmvPayload(s)) {
    const r = parseEmv(s);
    if (!r.ok) return '';
    return r.kind === 'dynamic' ? normalizeUrl(r.url) : `emvqr:${sha256hex(r.identifier)}`;
  }
  if (/^upi:\/\//i.test(s)) { const r = parseUpi(s); return r ? `upi:${sha256hex(r.vpa)}` : ''; }
  if (/^https?:\/\//i.test(s)) return normalizeUrl(s);
  const evm = s.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return evm[0].toLowerCase();
  const noScheme = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '');
  return noScheme.split(/[?@\s]/)[0].trim();
}

// A segwit (bech32 / bech32m) address, matched on the lowercased value: a known human-readable
// part, the '1' separator, then data in the bech32 charset only (no '1', 'b', 'i' or 'o'). The
// charset check, not the prefix alone, is what keeps a base58 (Solana) string that happens to
// start with "bc1" from being folded.
const BECH32_ADDRESS = /^(bc|tb|bcrt|ltc|tltc)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/;

/**
 * The comparison key of an ADDRESS value: normalizeDestinationValue, with a segwit address
 * lowercased. bech32 is case-insensitive (BIP-173; the uppercase form is the one QR codes use),
 * so 'BC1Q…' and 'bc1q…' are one wallet, and a mixed-case spelling, which no wallet accepts,
 * still names that same wallet. EVM values are already lowercased by the normalizer; every other
 * address (base58: legacy BTC/LTC, Solana, Tron) is case-sensitive and keeps its case.
 *
 * Every place that decides whether two spellings are one wallet uses this key: the claim guard
 * (claimIdentity), a domain file's listing (recordProofResult and the watchman's Pass B) and the
 * public lookup (lookupVerifiedAddress). If one of them compared case-sensitively, an address in
 * another letter case would pass the guard as a different wallet and then answer the lookup as
 * the same one.
 */
export function addressKey(value: string): string {
  const canonical = normalizeDestinationValue(value);
  const lower = canonical.toLowerCase();
  return BECH32_ADDRESS.test(lower) ? lower : canonical;
}

// ── Canonical claim identity (S5a) ───────────────────────────────────────────
//
// Claim-once is enforced in the DB on the RAW (rail, value), but the public lookup
// (lookupVerifiedAddress) matches on the canonical value and ignores the rail. So
// "0xAbC…" and "0xabc…", "BC1Q…" and "bc1q…", the same 0x address on ethereum and on
// polygon, or one bc1… string filed under bitcoin and under litecoin, are one wallet to a
// payer. Every path
// that flips a destination to proven checks this canonical identity against OTHER
// accounts' proven rows first (isClaimedElsewhere). S5b later moves the index itself
// onto canonical columns; until then this guard is the arbiter.

const EVM_CANONICAL = /^0x[0-9a-f]{40}$/;

export interface ClaimIdentity {
  /** An address: addressKey(value). A payment link/QR: normalizeDestinationValue(value).
   *  '' when the value has no usable form. */
  canonical: string;
  /** 'qr' for payment links/QRs; for an address, 'evm' (a 0x value) or 'addr' (any other). */
  family: string;
}

/**
 * The claim family of a destination, from its kind and canonical value. Never from the
 * rail: the public lookup ignores the rail, and nothing checks that a value fits the rail
 * it was filed under, so a family keyed on the rail would let the same string re-filed
 * under another rail slip past the guard. A 0x value is 'evm' (one key controls it on
 * every EVM chain; the normalizer lowercases it). Every other address is one 'addr'
 * family, compared on its addressKey: a segwit address in lowercase (bech32 is
 * case-insensitive), a base58 one exactly (case-sensitive). Strings from different chains
 * don't collide, and the one overlap, a BTC/LTC "3…" P2SH string, is the same script hash
 * on both. Payment links/QRs are looked up by value alone, so every QR rail is one 'qr'.
 */
export function claimFamily(kind: DestinationKind, canonical: string): string {
  if (kind === 'qr') return 'qr';
  return EVM_CANONICAL.test(canonical) ? 'evm' : 'addr';
}

/** Canonical claim identity of a stored or entered destination. Pure; the rail it was
 *  filed under deliberately plays no part (see claimFamily). An address is keyed exactly as
 *  the public lookup keys it (addressKey), so the guard can't see two wallets where the
 *  lookup sees one. */
export function claimIdentity(kind: DestinationKind, value: string): ClaimIdentity {
  const canonical = kind === 'qr' ? normalizeDestinationValue(value) : addressKey(value);
  return { canonical, family: claimFamily(kind, canonical) };
}

/** Same wallet/link for claim purposes. An empty canonical value never matches. EVM and
 *  segwit values are compared in lowercase (see addressKey); every other value is exact
 *  (case-sensitive). */
export function sameClaimIdentity(a: ClaimIdentity, b: ClaimIdentity): boolean {
  return !!a.canonical && a.canonical === b.canonical && a.family === b.family;
}

/**
 * May this destination be anchored (flipped to proven), given the canonical identities
 * of the proven rows OTHER accounts hold? Pure: the caller supplies `others` and must
 * already have excluded its own tenant, so an account can re-prove its own wallet or
 * prove it again under a second rail.
 */
export function canAnchor(mine: ClaimIdentity, others: ClaimIdentity[]): boolean {
  return !others.some((o) => sameClaimIdentity(mine, o));
}

/**
 * S5a claim guard: does ANOTHER account already hold a proven destination with the same
 * canonical identity? If so the caller must not flip this one and reports
 * 'claimed_elsewhere'. Cross-tenant by design, like the claim-once index it tightens: it
 * reads only the value (never tenant_id or any identity) and answers yes/no, so the
 * other account is never named. No rail is taken or read: the public lookup ignores the
 * rail, so the same wallet re-filed under any rail must still collide. The SQL is a
 * coarse prefilter (lowercased containment, so a twin stored in another case or wrapped
 * in a URI still surfaces); the canonical comparison in code decides. Throws on a DB
 * error, so a caller that can't check fails closed and does not flip.
 */
export async function isClaimedElsewhere(
  tenantId: string,
  kind: DestinationKind,
  value: string,
): Promise<boolean> {
  const mine = claimIdentity(kind, value);
  if (!mine.canonical) return false;
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT value FROM verify_destinations
          WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ?
            AND strpos(lower(value), ?) > 0`,
    args: [kind, tenantId, mine.canonical.toLowerCase()],
  });
  const others = (res.rows as any[]).map((r) => claimIdentity(kind, String(r.value)));
  return !canAnchor(mine, others);
}

// The business-name ↔ domain rule lives in a pure module so the public cards in the
// browser apply the exact same rule; re-exported here for existing callers.
export { normalizeName, registrableLabel, nameMatchesDomain };

export type NameClaimOutcome = 'claimed' | 'mine' | 'taken' | 'no_match';

/**
 * Try to reserve `label` as this tenant's domain-anchored verified business name. A name
 * is reserved globally only when the tenant has a PROVEN domain it derives from (see
 * nameMatchesDomain). Outcomes:
 *   'taken'    — another tenant already verified this name (the caller should block)
 *   'mine'     — this tenant already owns it
 *   'claimed'  — newly reserved for this tenant
 *   'no_match' — no proven domain backs this name; nothing reserved (the label stays freeform)
 * Never throws.
 */
export async function tryClaimVerifiedName(tenantId: string, label: string | null | undefined): Promise<NameClaimOutcome> {
  const key = label ? normalizeName(label) : '';
  if (!key) return 'no_match';
  await ensureVerifyTables();
  const owner = await db.execute({
    sql: `SELECT tenant_id FROM verify_claimed_names WHERE name_key = ? LIMIT 1`,
    args: [key],
  });
  if (owner.rows.length) {
    return String((owner.rows[0] as any).tenant_id) === tenantId ? 'mine' : 'taken';
  }
  // Unclaimed — this tenant may reserve it only with a matching PROVEN domain.
  const proven = await db.execute({
    sql: `SELECT domain FROM verify_domain_proofs WHERE tenant_id = ? AND status = 'proven'`,
    args: [tenantId],
  });
  const domain = (proven.rows as any[]).map((r) => String(r.domain)).find((d) => nameMatchesDomain(label!, d));
  if (!domain) return 'no_match';
  // The PK on name_key is the race arbiter: a concurrent claim leaves their row, we bail.
  await db.execute({
    sql: `INSERT INTO verify_claimed_names (name_key, tenant_id, display_name, domain)
          VALUES (?, ?, ?, ?) ON CONFLICT (name_key) DO NOTHING`,
    args: [key, tenantId, label!, domain],
  });
  const check = await db.execute({
    sql: `SELECT tenant_id FROM verify_claimed_names WHERE name_key = ? LIMIT 1`,
    args: [key],
  });
  if (check.rows.length && String((check.rows[0] as any).tenant_id) === tenantId) return 'claimed';
  return 'taken';
}

export interface CompareResult {
  matched: boolean;
  normalizedQuery: string;
  destination: Destination | null;
}

/**
 * Compare a scanned/entered value against the tenant's OWN registered destinations.
 * Match = "still yours"; no match = a destination we never registered (possible swap).
 * A direct equality check against the owner's ground truth — it catches a brand-new
 * clean thief address that no blacklist would flag. Read-only, tenant-scoped.
 */
export async function compareToDestinations(tenantId: string, rawValue: string): Promise<CompareResult> {
  const normalizedQuery = normalizeDestinationValue(rawValue);
  if (!normalizedQuery) return { matched: false, normalizedQuery: '', destination: null };
  const dests = await listDestinations(tenantId);
  // addressKey, so the QR (uppercase) form of a registered segwit address is not reported as a
  // possible swap. A link or payment QR has no case fold: its key is its normalized value.
  const key = addressKey(rawValue);
  const hit = dests.find(d => addressKey(d.value) === key) ?? null;
  return { matched: !!hit, normalizedQuery, destination: hit };
}

export type CreateResult =
  | { ok: true; destination: Destination }
  | { ok: false; error: 'limit_reached' | 'duplicate' | 'invalid' | 'claimed_elsewhere' | 'name_taken'; message: string };

export async function createDestination(
  tenantId: string,
  input: { kind: DestinationKind; rail: string; value: string; label?: string | null },
): Promise<CreateResult> {
  await ensureVerifyTables();
  const kind: DestinationKind = input.kind === 'qr' ? 'qr' : 'address';
  let rail = String(input.rail || (kind === 'qr' ? 'url' : 'ethereum')).slice(0, 32);
  const rawValue = String(input.value ?? '').trim();
  if (!rawValue || rawValue.length > 512) {
    return { ok: false, error: 'invalid', message: 'A destination value is required.' };
  }
  // For a QR, detect the payment format so the rail reflects it (url / pix / emv / upi),
  // and capture a friendly display hint (EMV merchant name / UPI payee) since the stored
  // value for PIX/UPI is a hash. "We don't distinguish TradFi vs crypto QRs" — all are
  // kind='qr', sharing one limit.
  let displayHint: string | null = null;
  if (kind === 'qr') {
    const emv = parseEmv(rawValue);
    if (emv.ok) { rail = emv.scheme; displayHint = emv.merchantName; }
    else if (/^upi:\/\//i.test(rawValue)) { rail = 'upi'; displayHint = parseUpi(rawValue)?.name ?? null; }
    else rail = 'url';
  } else {
    // Addresses: only the rails we support (the self-send check reads the chain by rail).
    // Case is folded ("Bitcoin") and anything off the list ("btc", "base") is refused.
    // Existing rows are untouched. The claim guard does not rely on this: it keys on the
    // value alone, so a wallet re-filed under another rail still collides (claimFamily).
    rail = rail.trim().toLowerCase();
    if (!(ADDRESS_RAILS as readonly string[]).includes(rail)) {
      return { ok: false, error: 'invalid', message: 'Choose a supported network for this address.' };
    }
  }
  // QR/payment-link destinations are stored canonicalized so the claim-once index and
  // the customer-scan match operate on one stable form (URLs canonicalized; PIX/UPI
  // hashed — never the raw key). Addresses keep the owner's exact entry, as before.
  const value = kind === 'qr' ? normalizeDestinationValue(rawValue) : rawValue;
  if (!value) {
    return { ok: false, error: 'invalid', message: 'A destination value is required.' };
  }
  const label = input.label ? String(input.label).trim().slice(0, 80) || null : null;

  // Free beta limit, per kind: 2 wallet addresses + 1 payment QR. Placements don't count
  // (the same QR in ten spots is one registered value).
  const kindLimit = kind === 'qr' ? FREE_LIMIT_QR : FREE_LIMIT_ADDRESS;
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM verify_destinations WHERE tenant_id = ? AND kind = ?`,
    args: [tenantId, kind],
  });
  if (Number((countRes.rows[0] as any)?.cnt ?? 0) >= kindLimit) {
    return {
      ok: false,
      error: 'limit_reached',
      message: kind === 'qr'
        ? 'Free beta includes 1 payment QR. Need more? Get in touch.'
        : 'Free beta includes 2 wallet addresses. Need more? Get in touch.',
    };
  }

  // Per-tenant duplicate guard (also backed by the unique index).
  const dup = await db.execute({
    sql: `SELECT 1 FROM verify_destinations WHERE tenant_id = ? AND kind = ? AND value = ? LIMIT 1`,
    args: [tenantId, kind, value],
  });
  if (dup.rows.length) {
    return { ok: false, error: 'duplicate', message: 'You have already registered this destination.' };
  }

  // Domain-anchored business name. A name is RESERVED globally only when the tenant has
  // proven the domain it derives from (DNS arbitrates the name, not us — no KYC). An
  // unproven label stays freeform and is not reserved. But once another business has
  // VERIFIED a name, no one else may use it as a label. If the tenant already has a
  // matching proven domain, registering claims the verified name now; otherwise it's
  // claimed later when they prove the domain (see recordProofResult).
  if (label) {
    const claim = await tryClaimVerifiedName(tenantId, label);
    if (claim === 'taken') {
      return { ok: false, error: 'name_taken', message: 'That business name is verified by another business. Choose a different name.' };
    }
  }

  // QR/payment links are proven on save (account_claim): registering a link while
  // authenticated in your own account IS the proof of ownership. Claim-once keeps it
  // exclusive — if another account already proved this link (canonically, on any QR
  // rail: the scan lookup ignores the rail), we say so rather than create an ambiguous
  // second "verified" row.
  const isQr = kind === 'qr';
  if (isQr && await isClaimedElsewhere(tenantId, 'qr', value)) {
    return {
      ok: false,
      error: 'claimed_elsewhere',
      message: 'This payment link is already verified by another Almstins account.',
    };
  }

  const id = randomUUID();
  try {
    await db.execute({
      sql: `INSERT INTO verify_destinations
              (id, tenant_id, kind, rail, value, label, display_hint, proof_method, proof_status, proven_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, kind, rail, value, label, displayHint,
        isQr ? 'account_claim' : 'none',
        isQr ? 'proven' : 'unproven',
        isQr ? nowUtc() : null,
      ],
    });
  } catch (e) {
    // A unique-index violation here is a race the pre-checks didn't catch. For a QR
    // it's the global claim-once index (another account proved this URL first); for an
    // address it can only be the per-tenant index (a concurrent same-value insert).
    console.warn('[verify] destination insert blocked (unique violation?):', e);
    return isQr
      ? { ok: false, error: 'claimed_elsewhere', message: 'This payment link is already verified by another Almstins account.' }
      : { ok: false, error: 'duplicate', message: 'You have already registered this destination.' };
  }
  const row = await db.execute({
    sql: `SELECT ${DEST_COLS}
          FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return { ok: true, destination: mapRow(row.rows[0]) };
}

export async function deleteDestination(tenantId: string, id: string): Promise<void> {
  await ensureVerifyTables();
  await db.execute({
    sql: `DELETE FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  // Its satoshi-test challenge goes with it, so an orphaned pending row doesn't keep an
  // amount reserved. The issuance log stays: re-adding the address within the amount's
  // window gets the SAME amount back (no reroll), and the log still blocks the amount's
  // reuse for 7 days.
  await db.execute({
    sql: `DELETE FROM verify_deposit_challenges WHERE destination_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
}

// ── Phase 5: published-source swap monitor ───────────────────────────────────

export type SetMonitorResult =
  | { ok: true; destination: Destination }
  | { ok: false; error: 'not_found' | 'invalid_url'; message: string };

/**
 * Set (or clear, with null) the public page URL we watch for a swap of this
 * destination. Tenant-scoped. The URL is validated as a fetchable public https URL by
 * the monitor's SSRF guard at check time; here we only enforce the basic shape so the
 * owner gets immediate feedback. Clearing the URL also clears the last status.
 */
export async function setMonitorUrl(tenantId: string, id: string, url: string | null): Promise<SetMonitorResult> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, id);
  if (!dest) return { ok: false, error: 'not_found', message: 'Destination not found.' };

  let monitorUrl: string | null = null;
  if (url != null && url.trim() !== '') {
    const s = url.trim();
    if (!/^https:\/\//i.test(s) || s.length > 512) {
      return { ok: false, error: 'invalid_url', message: 'Enter the full https:// address of the page where you publish this.' };
    }
    try { new URL(s); } catch { return { ok: false, error: 'invalid_url', message: 'That doesn’t look like a valid URL.' }; }
    monitorUrl = s;
  }

  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_destinations
          SET monitor_url = ?, monitor_status = NULL, monitor_checked_at = NULL, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [monitorUrl, now, id, tenantId],
  });
  const updated = await getDestination(tenantId, id);
  return updated ? { ok: true, destination: updated } : { ok: false, error: 'not_found', message: 'Destination not found.' };
}

export interface MonitorTarget {
  tenantId: string;
  id: string;
  kind: DestinationKind;
  rail: string;
  value: string;
  label: string | null;
  monitorUrl: string;
}

/**
 * Cross-tenant enumeration for the watchman cron — every destination that has a
 * monitor URL set. NOT tenant-scoped: a privileged maintenance job. Only proven
 * destinations are returned (an unproven value isn't a confirmed source of truth yet).
 */
export async function listMonitoredDestinations(): Promise<MonitorTarget[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT tenant_id, id, kind, rail, value, label, monitor_url
          FROM verify_destinations
          WHERE monitor_url IS NOT NULL AND proof_status = 'proven'`,
    args: [],
  });
  return (res.rows as any[]).map((r) => ({
    tenantId: String(r.tenant_id),
    id: String(r.id),
    kind: String(r.kind) === 'qr' ? 'qr' : 'address',
    rail: String(r.rail),
    value: String(r.value),
    label: r.label ? String(r.label) : null,
    monitorUrl: String(r.monitor_url),
  }));
}

/**
 * Stamp the latest monitor outcome (tenant-scoped). For a payment link, a 'present' outcome
 * is a positive re-confirmation, so it also advances last_confirmed_at (keeps the public
 * badge fresh). For an ADDRESS it never does: an address is 'verified' only through its
 * domain anchor, and a published page proves nothing about the domain (any https page, on
 * any site, can show the address). Only a domain proof re-confirms an anchor (Pass B, or the
 * owner's own proof), so a domain whose file is gone lets the address lapse to 'claimed' via
 * the max-stale TTL even while its page check keeps passing. Every other outcome
 * ('unreachable' / 'missing' / 'swapped' / 'invalid_url') records the attempt but NEVER
 * advances last_confirmed_at, so a persistently blind monitor lets the badge lapse too.
 * Fail-closed by construction.
 */
export async function recordMonitorResult(tenantId: string, id: string, status: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  if (status === 'present') {
    await db.execute({
      sql: `UPDATE verify_destinations
            SET monitor_status = ?, monitor_checked_at = ?,
                last_confirmed_at = CASE WHEN kind = 'qr' THEN ? ELSE last_confirmed_at END, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [status, now, now, now, id, tenantId],
    });
  } else {
    await db.execute({
      sql: `UPDATE verify_destinations SET monitor_status = ?, monitor_checked_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [status, now, now, id, tenantId],
    });
  }
}

// ── Phase 3: proof of control (domain attestation) ───────────────────────────

/** Fetch one destination, tenant-scoped. */
export async function getDestination(tenantId: string, id: string): Promise<Destination | null> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT ${DEST_COLS}
          FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

/**
 * Issue (or return the existing) account-bound challenge for a (tenant, domain).
 * Idempotent so re-opening the panel shows the same file to publish.
 */
export async function issueChallenge(tenantId: string, domain: string): Promise<string> {
  await ensureVerifyTables();
  const existing = await db.execute({
    sql: `SELECT challenge_token FROM verify_domain_proofs WHERE tenant_id = ? AND domain = ? LIMIT 1`,
    args: [tenantId, domain],
  });
  if (existing.rows.length) return String((existing.rows[0] as any).challenge_token);
  const token = generateChallenge();
  await db.execute({
    sql: `INSERT INTO verify_domain_proofs (id, tenant_id, domain, challenge_token, method, status)
          VALUES (?, ?, ?, ?, 'well_known', 'pending')`,
    args: [randomUUID(), tenantId, domain, token],
  });
  return token;
}

/** The challenge we issued for a (tenant, domain), or null if none was issued. */
export async function getChallenge(tenantId: string, domain: string): Promise<string | null> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT challenge_token FROM verify_domain_proofs WHERE tenant_id = ? AND domain = ? LIMIT 1`,
    args: [tenantId, domain],
  });
  return res.rows.length ? String((res.rows[0] as any).challenge_token) : null;
}

export interface ProofRecordResult {
  /** Destinations the published file now anchors to this domain (newly proven, newly
   *  anchored, or re-confirmed). Only ids whose UPDATE actually landed. */
  flipped: string[];
  /** Listed destinations already anchored to a DIFFERENT domain — left untouched. */
  otherDomain: string[];
  /** Listed destinations held out because another account already proved that wallet
   *  (S5a claim guard, or the claim-once index in a race) — left as they were. */
  claimedElsewhere: string[];
  /** Listed destinations this account holds only through a claim made under the old,
   *  unbound self-send rule (the row itself, or a canonical twin with no bound proof of its
   *  own): left as they were until a bound re-proof (see decideAnchor). */
  legacyUnbound: string[];
}

/**
 * Does this account hold `d`'s wallet only through a claim made under the old, unbound
 * self-send rule? True for a legacy claim itself, and for any canonical twin of one in the same
 * account (another letter case, rail or URI wrapping) that has no bound self-send proof of its
 * own. `legacy` is the account's legacyClaims. Pure. The one rule for the owner's domain proof
 * (recordProofResult) and the watchman (recheckDomainListing).
 */
function legacyHoldTest(
  legacy: { id: string; kind: DestinationKind; value: string }[],
): (d: Pick<Destination, 'id' | 'kind' | 'value' | 'proofStatus' | 'proofMethod'>) => boolean {
  const ids = new Set(legacy.map((c) => c.id));
  const wallets = legacy.map((c) => claimIdentity(c.kind, c.value));
  return (d) => {
    if (ids.has(d.id)) return true;
    // A proven self-send that isn't legacy is a bound one: a control proof of its own.
    if (d.proofStatus === 'proven' && d.proofMethod === 'micro_deposit') return false;
    const wallet = claimIdentity(d.kind, d.value);
    return wallets.some((w) => sameClaimIdentity(w, wallet));
  };
}

/**
 * Record a successful proof: mark the (tenant, domain) proof proven and anchor every
 * registered address destination the published file lists (see decideAnchor). Both sides
 * are normalized for the match.
 *  - Unproven/lapsed → proven by the file (well_known) and anchored.
 *  - Already proven another way (self-send), no anchor yet → the domain is ATTACHED; the
 *    control proof (proof_method, proven_at) is kept, and domain_anchored_at records the
 *    anchor's own age.
 *  - Already anchored to this domain → re-confirmed (keeps its original anchor date).
 *  - Anchored to a different domain → never moved.
 *  - Held by this account only through a claim made under the old, unbound self-send rule
 *    (legacy_unbound) → left as it was until a bound re-proof: it may be a squat, and the
 *    listing can't vouch for it. That covers the legacy row AND any canonical twin of it in
 *    this account (another letter case, rail or URI wrapping) with no bound proof of its own,
 *    which would otherwise be flipped or anchored in its place: the S5a guard below skips the
 *    caller's own account, and the public lookup matches every spelling of the wallet.
 * A listing is not a control proof, so a flip or a new anchor first passes the S5a claim
 * guard: a wallet another account already proved (in any case, under any rail) is held out
 * and reported as claimed elsewhere. A re-confirm makes no new claim (the row already carries
 * this anchor, with its date; the watchman re-confirms it the same way), so it skips the guard.
 */
export async function recordProofResult(
  tenantId: string,
  domain: string,
  fileAddresses: string[],
): Promise<ProofRecordResult> {
  await ensureVerifyTables();
  const now = nowUtc();
  // Read before writing anything: if the legacy claims can't be read, nothing is recorded.
  const dests = await listDestinations(tenantId);
  const legacy = await legacyClaims(tenantId);
  await db.execute({
    sql: `UPDATE verify_domain_proofs
          SET status = 'proven', proven_at = ?, last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, now, tenantId, domain],
  });
  const heldByLegacy = legacyHoldTest(legacy);
  // Matched on addressKey, like the guard and the public lookup (a listed 'BC1Q…' vouches for a
  // registered 'bc1q…'); the watchman's Pass B matches the same way, so it never releases what
  // this anchored.
  const vouched = new Set(fileAddresses.map(addressKey).filter(Boolean));
  const out: ProofRecordResult = { flipped: [], otherDomain: [], claimedElsewhere: [], legacyUnbound: [] };
  for (const d of dests) {
    const action = decideAnchor(
      { ...d, legacyUnbound: heldByLegacy(d) }, domain, vouched.has(addressKey(d.value)),
    );
    if (action === 'skip') continue;
    if (action === 'other_domain') { out.otherDomain.push(d.id); continue; }
    if (action === 'legacy_unbound') { out.legacyUnbound.push(d.id); continue; }
    try {
      if (action !== 'reconfirm' && await isClaimedElsewhere(tenantId, 'address', d.value)) {
        out.claimedElsewhere.push(d.id);
        continue;
      }
      // Each WHERE re-checks the decision against the row as it is now: a concurrent anchor to
      // another domain is never overwritten, and a legacy claim (the tag, or the rule it stands
      // for, read live) is never anchored.
      const res = action === 'flip'
        ? await db.execute({
            sql: `UPDATE verify_destinations
                  SET proof_status = 'proven', proof_method = 'well_known', proof_domain = ?, proven_at = ?,
                      domain_anchored_at = ?, last_confirmed_at = ?, legacy_unbound = false, updated_at = ?
                  WHERE id = ? AND tenant_id = ? AND kind = 'address' AND proof_status <> 'proven'`,
            args: [domain, now, now, now, now, d.id, tenantId],
          })
        : action === 'anchor'
        // A new anchor: this domain, dated now. It replaces only no anchor at all or a leftover
        // proof_domain with no anchor date (hasAnchor), never a real anchor.
        ? await db.execute({
            sql: `UPDATE verify_destinations
                  SET proof_domain = ?, domain_anchored_at = ?, last_confirmed_at = ?, updated_at = ?
                  WHERE id = ? AND tenant_id = ? AND kind = 'address' AND proof_status = 'proven'
                    AND NOT ${legacyClaimSql('verify_destinations')}
                    AND (proof_domain IS NULL OR (domain_anchored_at IS NULL AND proof_method <> 'well_known'))`,
            args: [domain, now, now, now, d.id, tenantId],
          })
        // 'reconfirm': the same anchor, re-confirmed. It keeps its date: a file-proven row
        // anchored before domain_anchored_at existed gets proven_at, when its file anchored it.
        : await db.execute({
            sql: `UPDATE verify_destinations
                  SET domain_anchored_at = COALESCE(domain_anchored_at, proven_at), last_confirmed_at = ?, updated_at = ?
                  WHERE id = ? AND tenant_id = ? AND kind = 'address' AND proof_status = 'proven'
                    AND NOT ${legacyClaimSql('verify_destinations')}
                    AND proof_domain = ? AND (domain_anchored_at IS NOT NULL OR proof_method = 'well_known')`,
            args: [now, now, d.id, tenantId, domain],
          });
      if ((res.rowsAffected ?? 0) > 0) out.flipped.push(d.id);
      else console.warn('[verify] destination not anchored (changed concurrently):', d.id);
    } catch (e) {
      // Claim-once backstop: the partial unique index rejects an exact (rail, value) that
      // another account proved in the moment since the guard ran (Postgres 23505). Any
      // other error (the guard itself failing) also leaves the row as it was: fail closed,
      // without failing the whole proof.
      if ((e as { code?: string })?.code === '23505') out.claimedElsewhere.push(d.id);
      console.warn('[verify] destination not anchored (already claimed elsewhere?):', d.id, e);
    }
  }
  // A proven domain unlocks its matching business name: reserve the domain-anchored name
  // for any of the tenant's labels that derive from this domain. Best-effort, non-fatal.
  // A row this proof refused as a legacy claim does not reserve a name here: only that. The name
  // belongs to the account, not to a row. Another row's label, a later proof or a DNS proof
  // (recordDomainControlProof) can still reserve it, and the public lookup then shows it on
  // every proven row of the account (verifiedNameForTenant), the refused one included. That
  // row's level stays Claimed, which is what an agent must read (/verify/agents).
  const refused = new Set(out.legacyUnbound);
  for (const d of dests) {
    if (refused.has(d.id)) continue;
    if (d.label && nameMatchesDomain(d.label, domain)) {
      try { await tryClaimVerifiedName(tenantId, d.label); } catch { /* non-fatal */ }
    }
  }
  return out;
}

/**
 * DNS-TXT proof: the domain controller published our challenge as a TXT record. This
 * proves CONTROL — it carries no address list, so (unlike the file) it does NOT vouch
 * for any address. Its job is to attach the BUSINESS NAME: mark the domain proven and
 * reserve the domain-anchored name for the tenant's matching labels.
 */
export async function recordDomainControlProof(tenantId: string, domain: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs
          SET status = 'proven', method = 'dns_txt', proven_at = ?, last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, now, tenantId, domain],
  });
  const dests = await listDestinations(tenantId);
  for (const d of dests) {
    if (d.label && nameMatchesDomain(d.label, domain)) {
      try { await tryClaimVerifiedName(tenantId, d.label); } catch { /* non-fatal */ }
    }
  }
}

/**
 * Stamp an owner-started check that didn't prove the domain (for re-validation/audit later).
 * An already-PROVEN domain keeps its status: a typo in an edited file must not take the domain
 * out of the watchman's rotation (listProvenDomainsForMonitor), which would leave its anchored
 * addresses neither re-confirmed nor released. The watchman alone demotes a proven domain, on a
 * definitive change, releasing its anchors and alerting the owner (verify-monitor Pass B).
 */
export async function markProofChecked(tenantId: string, domain: string, status: 'failed' | 'pending'): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs
          SET status = CASE WHEN status = 'proven' THEN status ELSE ? END, last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [status, now, now, tenantId, domain],
  });
}

// ── Phase 5: monitoring / re-validation (merchant .well-known watchman) ───────

export interface ProvenDomainTarget {
  tenantId: string;
  domain: string;
  /** The challenge we issued — re-checked against the still-published file. */
  challenge: string;
}

/**
 * Cross-tenant enumeration for the monitor cron — every domain whose proof is
 * currently 'proven'. NOT tenant-scoped: a privileged maintenance job spanning all
 * tenants. Only 'proven' rows are returned, so a domain we've already flipped to
 * 'failed' isn't re-checked (and isn't re-alerted) until the owner re-proves it.
 */
export async function listProvenDomainsForMonitor(): Promise<ProvenDomainTarget[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT tenant_id, domain, challenge_token FROM verify_domain_proofs WHERE status = 'proven'`,
    args: [],
  });
  return (res.rows as any[]).map(r => ({
    tenantId: String(r.tenant_id),
    domain: String(r.domain),
    challenge: String(r.challenge_token),
  }));
}

/** The address destinations a proven domain currently vouches for (tenant-scoped). */
export async function getProvenAddressDestinations(tenantId: string, domain: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT ${DEST_COLS}
          FROM verify_destinations
          WHERE tenant_id = ? AND proof_domain = ? AND proof_status = 'proven' AND kind = 'address'`,
    args: [tenantId, domain],
  });
  return (res.rows as any[]).map(mapRow);
}

/**
 * A proven domain no longer vouches for these destinations (its file stopped validating, or
 * stopped listing them). What that costs each one depends on how CONTROL was proven
 * (decideAnchorLoss):
 *  - well_known → 'lapsed': the file WAS the control proof. The dashboard prompts a re-prove,
 *    and flipping it OUT of 'proven' also dedups the alert (next run excludes it).
 *  - otherwise (self-send) → the domain anchor (and its confirmation) is cleared and control
 *    stays proven, so the public level drops verified → claimed and the claim-once index
 *    keeps holding the address.
 *    Clearing proof_domain also drops it from this domain's next run (alert dedup).
 * Tenant-scoped; each UPDATE re-checks the method and the anchor it acts on.
 */
export async function releaseDomainAnchor(
  tenantId: string,
  domain: string,
  dests: Pick<Destination, 'id' | 'proofMethod'>[],
): Promise<void> {
  if (!dests.length) return;
  await ensureVerifyTables();
  const now = nowUtc();
  for (const d of dests) {
    if (decideAnchorLoss(d.proofMethod) === 'lapse') {
      await db.execute({
        sql: `UPDATE verify_destinations SET proof_status = 'lapsed', updated_at = ?
              WHERE id = ? AND tenant_id = ? AND proof_method = 'well_known' AND proof_domain = ?`,
        args: [now, d.id, tenantId, domain],
      });
    } else {
      await db.execute({
        sql: `UPDATE verify_destinations
              SET proof_domain = NULL, domain_anchored_at = NULL, last_confirmed_at = NULL, updated_at = ?
              WHERE id = ? AND tenant_id = ? AND proof_method <> 'well_known' AND proof_domain = ?`,
        args: [now, d.id, tenantId, domain],
      });
    }
  }
}

/**
 * Advance last_confirmed_at for destinations POSITIVELY re-confirmed this run — the domain
 * proof still vouches them (Pass B). Together with the owner's own proof (recordProofResult)
 * and, for payment links only, the 'present' path in recordMonitorResult (Pass C), this is the
 * ONLY writer of last_confirmed_at. A destination the watchman could not confirm keeps its old
 * timestamp and lapses 'verified'→'claimed' via the public max-stale TTL.
 */
export async function markDestinationsConfirmed(tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureVerifyTables();
  const now = nowUtc();
  for (const id of ids) {
    await db.execute({
      sql: `UPDATE verify_destinations SET last_confirmed_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [now, now, id, tenantId],
    });
  }
}

export interface ListingRecheck {
  /** Anchored here, but the file no longer lists them: released (the owner is alerted). */
  missing: Destination[];
  /** Listed, but held only through a legacy unbound claim (legacyHoldTest): released. */
  legacyHeld: Destination[];
  /** Listed and standing on a control proof of their own: re-confirmed. */
  confirmed: string[];
}

/**
 * Pass B, once a proven domain's file still validates: settle the addresses anchored to it
 * (`proven`, from getProvenAddressDestinations) against the addresses the file lists now.
 *  - Not listed any more → released (releaseDomainAnchor), for the caller to alert on.
 *  - Listed, but this account holds the wallet only through a claim made under the old,
 *    unbound self-send rule (the row itself, or a twin with no bound proof of its own) →
 *    released too, never re-confirmed. The owner's proof refuses to anchor such a row
 *    (decideAnchor), but one anchored before that refusal existed (a copy of a legacy claim,
 *    file-flipped under the owner's own domain) would otherwise stay Verified for as long as
 *    the file lists it. A file-proven copy lapses (the listing was its only proof); the
 *    dashboard then offers it a proof of its own.
 *  - Listed and standing on a proof of its own → re-confirmed (markDestinationsConfirmed).
 * Matched on addressKey, as recordProofResult matched them. The legacy claims are read before
 * anything is written: if they can't be read this throws, nothing is released or re-confirmed,
 * and the anchors lapse to Claimed at the max-stale TTL (fail closed). Tenant-scoped.
 */
export async function recheckDomainListing(
  tenantId: string,
  domain: string,
  proven: Destination[],
  listedAddresses: string[],
): Promise<ListingRecheck> {
  await ensureVerifyTables();
  const heldByLegacy = legacyHoldTest(proven.length ? await legacyClaims(tenantId) : []);
  const listed = new Set(listedAddresses.map(addressKey).filter(Boolean));
  const out: ListingRecheck = { missing: [], legacyHeld: [], confirmed: [] };
  for (const p of proven) {
    if (!listed.has(addressKey(p.value))) out.missing.push(p);
    else if (heldByLegacy(p)) out.legacyHeld.push(p);
    else out.confirmed.push(p.id);
  }
  await releaseDomainAnchor(tenantId, domain, [...out.missing, ...out.legacyHeld]);
  if (out.legacyHeld.length) {
    console.warn('[verify] listing released: held only through a legacy self-send claim:', out.legacyHeld.map((p) => p.id));
  }
  await markDestinationsConfirmed(tenantId, out.confirmed);
  return out;
}

/** Whole-domain failure: flip the proof to 'failed' so it stops being monitored until re-proven. */
export async function markDomainProofFailed(tenantId: string, domain: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs SET status = 'failed', last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, tenantId, domain],
  });
}

/** Stamp a clean (or transiently-unreachable) re-check without changing status. */
export async function markDomainProofRechecked(tenantId: string, domain: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs SET last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, tenantId, domain],
  });
}


// ── Phase 4 (self-send): the satoshi test, rule bound_v1 ─────────────────────

/** An issued amount is valid for 24h; a tap after that draws a NEW amount. */
const DEPOSIT_TTL_MS = 24 * 60 * 60 * 1000;
/** An address's amounts aren't reissued for 7 days. */
const DEPOSIT_REUSE_MS = 7 * 24 * 60 * 60 * 1000;
/** Past expiry we keep looking for 2h more (a send made in time can be indexed or
 *  confirmed late; it must still fall inside the window). A miss in that time is
 *  'checking_late', which the panel keeps checking; only after it is a miss 'expired'. */
const DEPOSIT_CHECK_GRACE_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A re-check within 10 s replays the last outcome instead of reading the chain again
 *  (double taps and open tabs share one explorer budget). */
const DEPOSIT_CHECK_MIN_INTERVAL_MS = 10_000;

/** The satoshi test as the merchant sees it. It never contains an address to send to. */
export interface DepositChallengeView {
  /** Exact amount in the native coin, dot decimal, e.g. '0.00001234'. */
  amount: string;
  /** The same amount in base units (sats, litoshis, wei, lamports). */
  baseAmount: string;
  /** Native coin: BTC, LTC, ETH, POL, AVAX or SOL. */
  unit: string;
  /** 'sats' / 'litoshis' on UTXO chains, else null. */
  baseUnit: string | null;
  /** ISO 8601, UTC. */
  issuedAt: string;
  expiresAt: string;
  /** ISO 8601, UTC: the end of the post-expiry grace, when checking stops for good. */
  checkUntil: string;
  /** Past expiresAt but inside the grace: a send made in time may still be found. */
  late: boolean;
  /** Past the grace (or recorded expired): only a new amount helps now. */
  expired: boolean;
}

export type DepositChallengeResult =
  | { ok: true; challenge: DepositChallengeView }
  | { ok: false; error: 'not_found' | 'not_address' | 'already_proven' | 'unsupported_rail' | 'unavailable' | 'busy' }
  | { ok: false; error: 'rate_limited'; retryAt: string };

export type DepositChallengeLookup =
  | { ok: true; challenge: DepositChallengeView | null }
  | { ok: false; error: 'not_found' | 'not_address' };

interface DepositChallengeRow {
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  expectedAmount: string | null;
  unit: string | null;
  rule: string | null;
  lastOutcome: string | null;
  lastCheckedAt: string | null;
  baseline: string | null;
}
type BoundChallengeRow = DepositChallengeRow & { expiresAt: string; expectedAmount: string };

async function readDepositChallenge(tenantId: string, destinationId: string): Promise<DepositChallengeRow | null> {
  const res = await db.execute({
    sql: `SELECT status, issued_at, expires_at, expected_amount, unit, rule, last_outcome, last_checked_at, baseline
          FROM verify_deposit_challenges WHERE destination_id = ? AND tenant_id = ? LIMIT 1`,
    args: [destinationId, tenantId],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  return {
    status: String(r.status ?? ''),
    issuedAt: String(r.issued_at ?? ''),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    expectedAmount: r.expected_amount ? String(r.expected_amount) : null,
    unit: r.unit ? String(r.unit) : null,
    rule: r.rule ? String(r.rule) : null,
    lastOutcome: r.last_outcome ? String(r.last_outcome) : null,
    lastCheckedAt: r.last_checked_at ? String(r.last_checked_at) : null,
    baseline: r.baseline ? String(r.baseline) : null,
  };
}

/**
 * A bound challenge (amount + expiry, and on BTC/LTC the issuance baseline). Pre-binding
 * rows can't prove anything, and neither can a BTC/LTC row with no baseline: nothing would
 * tell the test apart from a transaction that was already on chain.
 */
function isBound(row: DepositChallengeRow | null, rail: string): row is BoundChallengeRow {
  return !!row && row.rule === 'bound_v1'
    && !!row.expectedAmount && /^\d+$/.test(row.expectedAmount)
    && Number.isFinite(stampMs(row.expiresAt)) && Number.isFinite(stampMs(row.issuedAt))
    && (!railNeedsBaseline(rail) || parseSelfSendBaseline(row.baseline) !== null);
}

/** The merchant's view of a test (a bound row, or one just written). */
function challengeView(
  rail: string,
  w: { status: string; expectedAmount: string; unit: string | null; issuedAt: string; expiresAt: string },
  nowMs: number,
): DepositChallengeView | null {
  const spec = testAmountSpec(rail);
  if (!spec) return null;
  const base = BigInt(w.expectedAmount);
  const expiresMs = stampMs(w.expiresAt);
  const checkUntilMs = expiresMs + DEPOSIT_CHECK_GRACE_MS;
  const expired = w.status === 'expired' || nowMs > checkUntilMs;
  return {
    amount: formatTestAmount(rail, base),
    baseAmount: base.toString(),
    unit: w.unit ?? spec.unit,
    baseUnit: spec.baseUnit,
    issuedAt: stampIso(w.issuedAt),
    expiresAt: stampIso(w.expiresAt),
    checkUntil: stampIso(toStamp(checkUntilMs)),
    late: !expired && nowMs > expiresMs,
    expired,
  };
}

/** Postgres unique_violation (23505); the message fallback covers the legacy engine. */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === '23505' || /unique|duplicate key/i.test(String(err?.message ?? ''));
}

/**
 * Does this destination still need a satoshi test? An unproven one does, and so does a
 * proven legacy unbound claim (legacyClaimSql): its owner takes the test again IN PLACE, so
 * the row keeps its claim-once hold (and shows Claimed) the whole time. Removing it and
 * adding it back would release the hold, and a re-added row could be claimed by a domain
 * file before the test lands. Throws on a DB error (the caller fails closed).
 */
async function needsSelfSend(tenantId: string, dest: Destination): Promise<boolean> {
  return dest.proofStatus !== 'proven' || await isLegacyClaim(tenantId, dest.id);
}

/**
 * The destination's current satoshi test, if it has a bound one that hasn't proven.
 * Read-only: opening the panel never issues an amount. Tenant-scoped.
 */
export async function getDepositChallenge(tenantId: string, destinationId: string): Promise<DepositChallengeLookup> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, destinationId);
  if (!dest) return { ok: false, error: 'not_found' };
  if (dest.kind !== 'address') return { ok: false, error: 'not_address' };
  if (!(await needsSelfSend(tenantId, dest))) return { ok: true, challenge: null };
  const row = await readDepositChallenge(tenantId, destinationId);
  if (!isBound(row, dest.rail) || row.status === 'proven') return { ok: true, challenge: null };
  return { ok: true, challenge: challengeView(dest.rail, row, Date.now()) };
}

type WriteResult = 'written' | 'lost_race' | 'taken';

/**
 * Write a test onto the destination's one challenge row. The DO UPDATE only replaces a
 * row that is this tenant's and not an active bound test, so a double tap can't swap the
 * amount under a merchant who is already sending ('lost_race'). A unique violation means
 * another challenge holds this amount on the address right now ('taken').
 *
 * A NEW draw (logDraw) is logged in the same transaction, and only when the upsert
 * actually wrote this amount, so the history the caps and the no-reroll rule read can't
 * miss an amount that was issued.
 */
async function writeChallenge(
  tenantId: string,
  destinationId: string,
  w: {
    amount: string; unit: string; canonical: string; issuedAt: string; expiresAt: string;
    baseline: string | null; now: string; replaceMissingBaseline: boolean; logDraw: boolean;
  },
): Promise<WriteResult> {
  const upsert = {
    sql: `INSERT INTO verify_deposit_challenges
            (id, destination_id, tenant_id, status, issued_at, expected_amount, unit, canonical_address,
             expires_at, rule, attempts, last_outcome, last_checked_at, proven_at, proof_ref, baseline, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'bound_v1', 0, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT (destination_id) DO UPDATE SET
            status = 'pending', issued_at = EXCLUDED.issued_at, expected_amount = EXCLUDED.expected_amount,
            unit = EXCLUDED.unit, canonical_address = EXCLUDED.canonical_address,
            expires_at = EXCLUDED.expires_at, rule = 'bound_v1', attempts = 0, last_outcome = NULL,
            last_checked_at = NULL, proven_at = NULL, proof_ref = NULL, baseline = EXCLUDED.baseline,
            updated_at = EXCLUDED.updated_at
          WHERE verify_deposit_challenges.tenant_id = EXCLUDED.tenant_id
            AND (verify_deposit_challenges.rule IS DISTINCT FROM 'bound_v1'
                 OR verify_deposit_challenges.status <> 'pending'
                 OR verify_deposit_challenges.expires_at IS NULL
                 OR verify_deposit_challenges.expires_at < ?${w.replaceMissingBaseline
                   ? `
                 OR verify_deposit_challenges.baseline IS NULL` : ''})`,
    args: [randomUUID(), destinationId, tenantId, w.issuedAt, w.amount, w.unit, w.canonical,
      w.expiresAt, w.baseline, w.now, w.now],
  };
  const log = {
    sql: `INSERT INTO verify_deposit_amount_log
            (id, tenant_id, canonical_address, expected_amount, issued_at, expires_at, baseline)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM verify_deposit_challenges
            WHERE destination_id = ? AND tenant_id = ? AND status = 'pending'
              AND expected_amount = ? AND issued_at = ?
          )`,
    args: [randomUUID(), tenantId, w.canonical, w.amount, w.issuedAt, w.expiresAt, w.baseline,
      destinationId, tenantId, w.amount, w.issuedAt],
  };
  try {
    const [res] = w.logDraw ? await db.batch([upsert, log], 'write') : [await db.execute(upsert)];
    return res.rowsAffected ? 'written' : 'lost_race';
  } catch (e) {
    if (isUniqueViolation(e)) return 'taken';
    throw e;
  }
}

/**
 * Issue the satoshi test for an address destination that still needs one (needsSelfSend:
 * unproven, or a legacy unbound claim taking it again in place). Called only on the
 * merchant's explicit "I'm ready to send", never when the panel opens. An unexpired pending test
 * is returned unchanged, so a second tap shows the same amount; an expired one is
 * replaced by a NEW amount. Tenant-scoped, and the result never contains an address to
 * send to.
 *
 * The amount can't be picked by drawing again and again (see planIssue): while this
 * tenant holds an unexpired amount for the address (even under a destination it deleted
 * and re-added), it gets that same amount and window back, and new draws are capped per
 * address and per tenant ('rate_limited', with the time a draw reopens). A new amount is
 * unique among pending challenges for this canonical address across tenants (the
 * pending-amount index; a collision draws again), skips this tenant's amounts from the
 * last 7 days and a few recent ones per other tenant (so no one can use up the pool). On
 * BTC/LTC the address's baseline is captured BEFORE the amount is drawn, and no amount is
 * issued without it ('unavailable').
 */
export async function issueDepositChallenge(tenantId: string, destinationId: string): Promise<DepositChallengeResult> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, destinationId);
  if (!dest) return { ok: false, error: 'not_found' };
  if (dest.kind !== 'address') return { ok: false, error: 'not_address' };
  if (!(await needsSelfSend(tenantId, dest))) return { ok: false, error: 'already_proven' };
  const spec = testAmountSpec(dest.rail);
  if (!spec) return { ok: false, error: 'unsupported_rail' };

  const nowMs = Date.now();
  const current = await readDepositChallenge(tenantId, destinationId);
  if (isBound(current, dest.rail) && current.status === 'pending' && nowMs <= stampMs(current.expiresAt)) {
    const view = challengeView(dest.rail, current, nowMs);
    if (view) return { ok: true, challenge: view };
  }

  const canonical = canonicalAddress(dest.rail, dest.value);
  const needsBaseline = railNeedsBaseline(dest.rail);
  const now = toStamp(nowMs);
  const reuseCutoff = toStamp(nowMs - DEPOSIT_REUSE_MS);

  // This tenant's issuance history: its draws for this address (7 days), and its draws for
  // any address in the last 24h (the per-tenant cap).
  const ownRes = await db.execute({
    sql: `SELECT expected_amount, issued_at, expires_at, baseline FROM verify_deposit_amount_log
          WHERE tenant_id = ? AND canonical_address = ? AND issued_at >= ?
          ORDER BY issued_at DESC`,
    args: [tenantId, canonical, reuseCutoff],
  });
  const dayRes = await db.execute({
    sql: `SELECT issued_at FROM verify_deposit_amount_log WHERE tenant_id = ? AND issued_at >= ?`,
    args: [tenantId, toStamp(nowMs - DAY_MS)],
  });
  // Cross-tenant on purpose, amounts only: what is pending on this address anywhere. Used
  // only to draw; nothing about another account's challenge is ever returned or revealed.
  const heldRes = await db.execute({
    sql: `SELECT expected_amount FROM verify_deposit_challenges
          WHERE canonical_address = ? AND status = 'pending' AND expected_amount IS NOT NULL`,
    args: [canonical],
  });

  const baselines = new Map<OwnDraw, string | null>();
  const own: OwnDraw[] = (ownRes.rows as any[]).map((r) => {
    const issuedAtMs = stampMs(r.issued_at);
    const expiresAtMs = r.expires_at ? stampMs(r.expires_at) : issuedAtMs + DEPOSIT_TTL_MS;
    const baseline = r.baseline ? String(r.baseline) : null;
    const draw: OwnDraw = {
      amount: String(r.expected_amount),
      issuedAtMs,
      expiresAtMs,
      reusable: Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs)
        && (!needsBaseline || parseSelfSendBaseline(baseline) !== null),
    };
    baselines.set(draw, baseline);
    return draw;
  });
  const held = new Set((heldRes.rows as any[]).map((r) => String(r.expected_amount)));
  const plan = planIssue({
    own,
    tenantDraws: (dayRes.rows as any[]).map((r) => stampMs(r.issued_at)),
    held,
    nowMs,
  });

  const readBack = async (): Promise<DepositChallengeResult> => {
    const row = await readDepositChallenge(tenantId, destinationId);
    const view = isBound(row, dest.rail) ? challengeView(dest.rail, row, Date.now()) : null;
    return view ? { ok: true, challenge: view } : { ok: false, error: 'unavailable' };
  };

  // No reroll: an unexpired amount this tenant already drew comes back as it was issued.
  if (plan.reuse) {
    const w = {
      amount: plan.reuse.amount, unit: spec.unit, canonical,
      issuedAt: toStamp(plan.reuse.issuedAtMs), expiresAt: toStamp(plan.reuse.expiresAtMs),
      baseline: baselines.get(plan.reuse) ?? null, now, replaceMissingBaseline: needsBaseline, logDraw: false,
    };
    const res = await writeChallenge(tenantId, destinationId, w);
    if (res === 'written') {
      const view = challengeView(dest.rail, { status: 'pending', expectedAmount: w.amount, unit: w.unit, issuedAt: w.issuedAt, expiresAt: w.expiresAt }, nowMs);
      if (view) return { ok: true, challenge: view };
    }
    if (res === 'lost_race') return readBack();
    // 'taken': another challenge holds it now, so this is a new draw after all.
  }
  if (!plan.canDraw) {
    return { ok: false, error: 'rate_limited', retryAt: stampIso(toStamp(plan.retryAtMs ?? nowMs + DAY_MS)) };
  }

  // Before the amount exists: what the address already shows (BTC/LTC). Fail closed.
  const baseline = await captureSelfSendBaseline(dest.rail, dest.value);
  if (baseline === 'unavailable') return { ok: false, error: 'unavailable' };
  const baselineJson = baseline ? JSON.stringify(baseline) : null;

  // Other tenants' recent amounts on this address, at most a few per tenant, so one
  // account can't fill the pool and lock the owner out. Cross-tenant, amounts only.
  const othersRes = await db.execute({
    sql: `SELECT tenant_id, expected_amount, issued_at FROM verify_deposit_amount_log
          WHERE canonical_address = ? AND issued_at >= ? AND tenant_id <> ?`,
    args: [canonical, reuseCutoff, tenantId],
  });
  const others = recentPerTenant((othersRes.rows as any[]).map((r) => ({
    tenantId: String(r.tenant_id), amount: String(r.expected_amount), issuedAtMs: stampMs(r.issued_at),
  })));
  const ownAmounts = own.map((d) => d.amount);

  const issuedAt = now;
  const expiresAt = toStamp(nowMs + DEPOSIT_TTL_MS);
  let lostRace = false;
  const tryClaim = async (amount: { base: string; unit: string }): Promise<boolean> => {
    const res = await writeChallenge(tenantId, destinationId, {
      amount: amount.base, unit: amount.unit, canonical, issuedAt, expiresAt, baseline: baselineJson,
      now, replaceMissingBaseline: needsBaseline, logDraw: true,
    });
    if (res === 'taken') return false; // amount just taken by another challenge: draw again
    if (res === 'lost_race') lostRace = true; // a concurrent tap issued an active test first
    return true;
  };
  // If other tenants' history ever fills the pool, draw again without it: the pending
  // amounts and this tenant's own history are all that must never repeat.
  const claimed = (await allocateTestAmount(dest.rail, [...held, ...ownAmounts, ...others], tryClaim))
    ?? (await allocateTestAmount(dest.rail, [...held, ...ownAmounts], tryClaim));

  if (lostRace) return readBack();
  if (!claimed) return { ok: false, error: 'busy' };

  // Drop this address's log entries past the 7-day window. Best-effort housekeeping.
  try {
    await db.execute({
      sql: `DELETE FROM verify_deposit_amount_log WHERE canonical_address = ? AND issued_at < ?`,
      args: [canonical, reuseCutoff],
    });
  } catch (e) {
    console.error('[verify] deposit amount log not purged:', e);
  }

  const view = challengeView(dest.rail, { status: 'pending', expectedAmount: claimed.base, unit: claimed.unit, issuedAt, expiresAt }, nowMs);
  return view ? { ok: true, challenge: view } : { ok: false, error: 'unavailable' };
}

export type MicroDepositOutcome =
  | 'proven' | 'not_yet' | 'no_challenge' | 'expired' | 'checking_late' | 'not_found' | 'not_address'
  | 'already_proven' | 'claimed_elsewhere' | 'unsupported_rail' | 'unavailable'
  | 'wrong_amount' | 'wrong_recipient' | 'sent_to_not_from';

/** Outcomes a throttled re-check may replay without reading the chain again. */
const REPLAYABLE_OUTCOMES = new Set<string>([
  'not_yet', 'unavailable', 'expired', 'checking_late', 'wrong_amount', 'wrong_recipient', 'sent_to_not_from',
]);

/**
 * Claim-once across letter case. The claim index compares the raw (rail, value), but EVM
 * hex and bech32 addresses are case-insensitive, so 'BC1Q…' and 'bc1q…' are one address.
 * True when another tenant has already proven this address on this rail in any case.
 * Cross-tenant existence check only (like the claim index): nothing about the other
 * account is returned.
 */
async function provenByAnotherTenant(tenantId: string, rail: string, value: string): Promise<boolean> {
  const v = String(value ?? '').trim();
  const caseless = isCaselessAddress(rail, v);
  const res = await db.execute({
    sql: `SELECT 1 FROM verify_destinations
          WHERE kind = 'address' AND proof_status = 'proven' AND rail = ? AND tenant_id <> ?
            AND ${caseless ? 'lower(value) = ?' : 'value = ?'}
          LIMIT 1`,
    args: [rail, tenantId, caseless ? v.toLowerCase() : v],
  });
  return res.rows.length > 0;
}

/**
 * Check the chain for the satoshi test (rule bound_v1): a self-send of exactly the
 * challenge's amount inside its window (see verifyDeposit.ts). When found, flip the
 * destination to proven (a legacy unbound claim taking the test again in place is re-proven
 * the same way; see needsSelfSend). The flip passes through the claim-once guard (the partial
 * unique index) and the S5a claim guard (canonical value, whatever the rail): if another
 * account already proved this address, we report 'claimed_elsewhere' rather than taking
 * it (in any letter case, too: see provenByAnotherTenant). A pre-binding challenge reports
 * 'no_challenge', so the merchant taps "I'm ready to send" for a bound one. For 2h past
 * expiry a miss is 'checking_late', not final, because a send made in time can be indexed
 * or confirmed late; after that it is 'expired'. Every check records attempts and
 * last_outcome. Read-only chain access; nothing moves.
 *
 * TODO(PR-6): a background job re-checks pending tests every 10 minutes until expiry and
 * emails the merchant on success; today only the browser checks (on "I've sent it",
 * every 20 s for 15 minutes, and on tab focus).
 */
export async function verifyMicroDeposit(
  tenantId: string,
  destinationId: string,
): Promise<{ outcome: MicroDepositOutcome; ref?: string }> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, destinationId);
  if (!dest) return { outcome: 'not_found' };
  if (dest.kind !== 'address') return { outcome: 'not_address' };
  if (!(await needsSelfSend(tenantId, dest))) return { outcome: 'already_proven' };

  const ch = await readDepositChallenge(tenantId, destinationId);
  if (!isBound(ch, dest.rail) || ch.status === 'proven') return { outcome: 'no_challenge' };
  if (ch.status === 'expired') return { outcome: 'expired' };

  const nowMs = Date.now();
  const stamp = toStamp(nowMs);
  const expiresMs = stampMs(ch.expiresAt);
  const record = (outcome: MicroDepositOutcome, status: 'pending' | 'expired' = 'pending') =>
    db.execute({
      sql: `UPDATE verify_deposit_challenges
            SET status = ?, attempts = attempts + 1, last_outcome = ?, last_checked_at = ?, updated_at = ?
            WHERE destination_id = ? AND tenant_id = ? AND status = 'pending'`,
      args: [status, outcome, stamp, stamp, destinationId, tenantId],
    });

  if (nowMs > expiresMs + DEPOSIT_CHECK_GRACE_MS) {
    await record('expired', 'expired'); // frees the amount; the log still blocks its reuse
    return { outcome: 'expired' };
  }
  if (ch.lastOutcome && REPLAYABLE_OUTCOMES.has(ch.lastOutcome)
      && nowMs - stampMs(ch.lastCheckedAt) < DEPOSIT_CHECK_MIN_INTERVAL_MS) {
    return { outcome: ch.lastOutcome as MicroDepositOutcome };
  }

  const detected = await detectBoundSelfSend({
    rail: dest.rail,
    address: dest.value,
    expected: BigInt(ch.expectedAmount),
    issuedAt: Math.floor(stampMs(ch.issuedAt) / 1000),
    expiresAt: Math.floor(expiresMs / 1000),
    baseline: parseSelfSendBaseline(ch.baseline),
  }, Math.floor(nowMs / 1000));

  if (!detected.found) {
    // Past expiry (inside the grace) a miss can't be fixed on this amount, so no hints:
    // just say we're still checking for a send made in time. Not final: the panel keeps
    // checking until the grace ends. An unreachable chain stays 'unavailable'.
    const outcome: MicroDepositOutcome =
      nowMs > expiresMs && detected.reason !== 'unavailable' ? 'checking_late' : detected.reason;
    await record(outcome);
    return { outcome };
  }

  // S5a: another account already proved this wallet under another spelling or rail,
  // which the exact index below can't see. Hold this one out. A DB error here throws,
  // so nothing flips (fail closed).
  if (await isClaimedElsewhere(tenantId, 'address', dest.value)) {
    await record('claimed_elsewhere');
    return { outcome: 'claimed_elsewhere' };
  }

  if (await provenByAnotherTenant(tenantId, dest.rail, dest.value)) {
    console.warn('[verify] self-send flip blocked (claimed elsewhere, other letter case):', destinationId);
    await record('claimed_elsewhere');
    return { outcome: 'claimed_elsewhere' };
  }

  // Claim-once: the partial unique index rejects the flip if another account already
  // proved this (rail, value). Catch and report rather than failing hard. A self-send
  // proves control only, so any domain anchor (and its confirmation) left over from an
  // earlier, now lapsed, file proof is cleared: only a fresh domain proof re-anchors it.
  // This is a bound proof, so the row is no longer a legacy unbound claim (decideAnchor);
  // on a legacy row taken again in place it replaces the old claim, and proven_at becomes
  // the date control was actually shown. The WHERE re-checks that the row still needs it.
  try {
    await db.execute({
      sql: `UPDATE verify_destinations
            SET proof_status = 'proven', proof_method = 'micro_deposit', proven_at = ?,
                proof_domain = NULL, domain_anchored_at = NULL, last_confirmed_at = NULL,
                legacy_unbound = false, updated_at = ?
            WHERE id = ? AND tenant_id = ?
              AND (proof_status <> 'proven' OR ${legacyClaimSql('verify_destinations')})`,
      args: [stamp, stamp, destinationId, tenantId],
    });
  } catch (e) {
    if (!isUniqueViolation(e)) {
      console.error('[verify] self-send flip failed:', destinationId, e);
      return { outcome: 'unavailable' };
    }
    console.warn('[verify] self-send flip blocked (claimed elsewhere):', destinationId);
    await record('claimed_elsewhere');
    return { outcome: 'claimed_elsewhere' };
  }
  await db.execute({
    sql: `UPDATE verify_deposit_challenges
          SET status = 'proven', proven_at = ?, proof_ref = ?, attempts = attempts + 1,
              last_outcome = 'proven', last_checked_at = ?, updated_at = ?
          WHERE destination_id = ? AND tenant_id = ?`,
    args: [stamp, detected.ref, stamp, stamp, destinationId, tenantId],
  });
  return { outcome: 'proven', ref: detected.ref };
}
