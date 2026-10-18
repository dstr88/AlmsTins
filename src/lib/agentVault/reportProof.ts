/**
 * The signature on an operator report, built from the same parts as a Year Summary proof so the
 * same checkers read it: the public page /verify-record, POST /api/verify-record and the offline
 * script scripts/verify-record.mjs all verify a report's proof bundle without a change.
 *
 *   report content -> ordered leaves -> Merkle root -> manifest -> Ed25519 signature -> bundle
 *
 * The leaves are the report's own lines: one for the summary (every count and the strip) and one
 * for each address the report lists. So the signature commits to exactly what the report prints,
 * and a changed count, address or reason breaks the root. The MANIFEST, the part that travels
 * with the signature, carries no address, label or name: an opaque record id and tenant tag, the
 * day, the bucket counts and the root. The addresses are in the leaves, which stay with the
 * owner's own bundle and PDF.
 *
 * Almstins signs with its OWN key (recordProof/signing.ts) and never touches anyone else's. With
 * no key configured the bundle comes back unsigned (signature null) and says so; nothing here
 * presents an unsigned report as signed. Verification is against the keys Almstins publishes now,
 * its current key and any retired one it still lists, so a report signed before a rotation still
 * verifies after it.
 *
 * The proof evidences what the Vault recorded and when. It does not say the underlying checks or
 * transfers were right, complete or legitimate (Terms clause 9).
 */
import { canonicalBytes, sha256Hex } from '@/lib/recordProof/isoSign';
import { PROOF_FORMAT, TREE_ALGO, tenantScopeTag, type ProofBundle } from '@/lib/recordProof/buildProof';
import { LEAF_SCHEMA_VERSION, orderLeaves, serializeLeaf, toFixedTrimmed, USD_SCALE, type CanonicalLeaf } from '@/lib/recordProof/leaf';
import { buildMerkleRoot, hashLeaf, toHex } from '@/lib/recordProof/merkle';
import { canonicalManifestBytes, getPublishedKeys, getSigningKey, signManifestWithKey } from '@/lib/recordProof/signing';
import { verifyBundle, type VerifyOutcome } from '@/lib/recordProof/verify';
import { LISTED_BUCKETS, type ListedBucketName, type ReportContent } from './report';

export const REPORT_RECORD_TYPE = 'agent_report' as const;

const APP_BASE = process.env.APP_URL ?? 'https://almstins.com';

export const AGENT_REPORT_DISCLAIMER =
  'This proof attests INTEGRITY (the lines of this report are unaltered), ORIGIN (signed by the Almstins key ' +
  'it names, which Almstins publishes) and the time the report was generated. It evidences what the Agent Vault ' +
  'recorded, asked and answered, and when. It does NOT attest that any underlying check, address or transfer ' +
  'was correct, complete or legitimate.';

/** The hash of a report's content: equal content always has an equal hash, so it decides whether a new version is needed. */
export function contentHashOf(content: ReportContent): string {
  return sha256Hex(canonicalBytes(content));
}

// ── The leaves ───────────────────────────────────────────────────────────────

export interface SummaryLeaf {
  v: 1;
  kind: 'summary';
  /** The first moment of the period: the leaf's place in time. */
  date: string;
  tin_id: string;
  tin_label: string;
  period_start: string;
  period_end: string;
  partial: boolean;
  events_checked: number;
  events_transaction: number;
  addresses: number;
  issues_addresses: number;
  issues_checks: number;
  issues_omitted: number;
  not_confirmed_addresses: number;
  not_confirmed_checks: number;
  not_confirmed_omitted: number;
  new_addresses: number;
  new_checks: number;
  new_omitted: number;
  no_issues_addresses: number;
  no_issues_checks: number;
  transfers: number;
  bought_count: number;
  bought_priced: number;
  bought_unpriced: number;
  bought_usd: string;
  sold_count: number;
  sold_priced: number;
  sold_unpriced: number;
  sold_usd: string;
  transfers_proven: number;
  transfers_consistent_with_history: number;
  transfers_flagged: number;
  transfers_unknown: number;
  transfers_no_preceding_check: number;
}

export interface AddressLeaf {
  v: 1;
  kind: 'address';
  /** When the first of the listed checks happened. */
  date: string;
  bucket: ListedBucketName;
  address: string;
  label: string | null;
  chain: string | null;
  registry: string | null;
  reasons: string[];
  checks: number;
  checks_in_period: number;
  first_at: string;
  last_at: string;
  event_id: string;
}

export type ReportLeaf = SummaryLeaf | AddressLeaf;

const usdText = (usd: number): string => toFixedTrimmed(usd, USD_SCALE) ?? '0';

/** The leaves of a report, in no particular order (the proof orders them). */
export function leavesOf(content: ReportContent): ReportLeaf[] {
  const { buckets, strip } = content;
  const summary: SummaryLeaf = {
    v: 1,
    kind: 'summary',
    date: content.period.start,
    tin_id: content.tin.id,
    tin_label: content.tin.label,
    period_start: content.period.start,
    period_end: content.period.end,
    partial: content.period.partial,
    events_checked: content.events.checked,
    events_transaction: content.events.transaction,
    addresses: content.addresses,
    issues_addresses: buckets.issues.addresses,
    issues_checks: buckets.issues.checks,
    issues_omitted: buckets.issues.omitted,
    not_confirmed_addresses: buckets.not_confirmed.addresses,
    not_confirmed_checks: buckets.not_confirmed.checks,
    not_confirmed_omitted: buckets.not_confirmed.omitted,
    new_addresses: buckets.new.addresses,
    new_checks: buckets.new.checks,
    new_omitted: buckets.new.omitted,
    no_issues_addresses: buckets.no_issues.addresses,
    no_issues_checks: buckets.no_issues.checks,
    transfers: strip.transfers,
    bought_count: strip.bought.count,
    bought_priced: strip.bought.pricedCount,
    bought_unpriced: strip.bought.unpricedCount,
    bought_usd: usdText(strip.bought.usd),
    sold_count: strip.sold.count,
    sold_priced: strip.sold.pricedCount,
    sold_unpriced: strip.sold.unpricedCount,
    sold_usd: usdText(strip.sold.usd),
    transfers_proven: strip.byStatus.proven,
    transfers_consistent_with_history: strip.byStatus['consistent-with-history'],
    transfers_flagged: strip.byStatus.flagged,
    transfers_unknown: strip.byStatus.unknown,
    transfers_no_preceding_check: strip.noPrecedingCheck,
  };
  const leaves: ReportLeaf[] = [summary];
  for (const bucket of LISTED_BUCKETS) {
    for (const a of buckets[bucket].listed) {
      leaves.push({
        v: 1,
        kind: 'address',
        date: a.firstAt,
        bucket,
        address: a.address,
        label: a.label,
        chain: a.chain,
        registry: a.registry,
        reasons: a.reasons,
        checks: a.checks,
        checks_in_period: a.checksInPeriod,
        first_at: a.firstAt,
        last_at: a.lastAt,
        event_id: a.eventId,
      });
    }
  }
  return leaves;
}

/** Ordered the way every verifier orders them (recordProof/leaf.ts), so the root does not depend on how they were listed. */
const ordered = (leaves: ReportLeaf[]): ReportLeaf[] => orderLeaves(leaves as unknown as CanonicalLeaf[]) as unknown as ReportLeaf[];

// ── The manifest and the bundle ──────────────────────────────────────────────

export interface AgentReportManifest {
  v: 1;
  record_id: string;
  /** An opaque tag for the account (recordProof tenantScopeTag): the same account always gets the same tag, and it is not the account id. */
  tenant_scope_tag: string;
  record_type: typeof REPORT_RECORD_TYPE;
  /** The UTC day the report covers, `YYYY-MM-DD`. */
  period: string;
  period_start: string;
  period_end: string;
  partial: boolean;
  version: number;
  data_source: 'ledger';
  merkle_root: string;
  leaf_count: number;
  leaf_schema_version: number;
  tree_algo: string;
  /** Addresses per bucket. */
  counts: { issues: number; not_confirmed: number; new: number; no_issues: number };
  /** The root of the version this one supersedes, or null for the first version of the day. */
  prev_root: string | null;
  generated_at: string;
  signing_key_id: string | null;
  schema_version: '1';
  verify_url: string;
  disclaimer: string;
}

export interface AgentReportBundle {
  manifest: AgentReportManifest;
  signature: { alg: 'Ed25519'; key_id: string; signature_hex: string } | null;
  /** Ordered, so the bundle verifies offline from itself alone. */
  leaves: ReportLeaf[];
  leaf_hashes: string[];
  proof_format: string;
}

/** The signed surface of a manifest: everything but the presentational fields (the same rule every verifier applies). */
function signedView(m: AgentReportManifest): Omit<AgentReportManifest, 'verify_url' | 'disclaimer'> {
  const { verify_url: _v, disclaimer: _d, ...signed } = m;
  return signed;
}

export interface BuildBundleInput {
  tenantId: string;
  reportId: string;
  version: number;
  /** When the report was generated, UTC ISO-8601 with milliseconds. */
  generatedAt: string;
  content: ReportContent;
  /** The Merkle root of the version this one supersedes, or null. */
  prevRoot: string | null;
}

/** Hashes the leaves of a report and returns the ordered leaves with their hashes and the root. */
function commit(content: ReportContent): { leaves: ReportLeaf[]; hashes: string[]; root: string } {
  const leaves = ordered(leavesOf(content));
  const hashes = leaves.map((l) => hashLeaf(serializeLeaf(l as unknown as CanonicalLeaf)));
  return { leaves, hashes: hashes.map(toHex), root: toHex(buildMerkleRoot(hashes)) };
}

/** The Merkle root of a report's leaves. */
export const rootOf = (content: ReportContent): string => commit(content).root;

/**
 * The signed bundle for a report, or an unsigned one (signature null, signing_key_id null) when no
 * signing key is configured. Pure apart from reading the key.
 */
export function buildReportBundle(input: BuildBundleInput): AgentReportBundle {
  const { leaves, hashes, root } = commit(input.content);
  const key = getSigningKey();
  const manifest: AgentReportManifest = {
    v: 1,
    record_id: input.reportId,
    tenant_scope_tag: tenantScopeTag(input.tenantId),
    record_type: REPORT_RECORD_TYPE,
    period: input.content.period.start.slice(0, 10),
    period_start: input.content.period.start,
    period_end: input.content.period.end,
    partial: input.content.period.partial,
    version: input.version,
    data_source: 'ledger',
    merkle_root: root,
    leaf_count: leaves.length,
    leaf_schema_version: LEAF_SCHEMA_VERSION,
    tree_algo: TREE_ALGO,
    counts: {
      issues: input.content.buckets.issues.addresses,
      not_confirmed: input.content.buckets.not_confirmed.addresses,
      new: input.content.buckets.new.addresses,
      no_issues: input.content.buckets.no_issues.addresses,
    },
    prev_root: input.prevRoot,
    generated_at: input.generatedAt,
    signing_key_id: key ? key.keyId : null,
    schema_version: '1',
    verify_url: `${APP_BASE}/verify-record`,
    disclaimer: AGENT_REPORT_DISCLAIMER,
  };
  const signed = key ? signManifestWithKey(canonicalManifestBytes(signedView(manifest))) : null;
  return {
    manifest,
    signature: signed ? { alg: signed.alg, key_id: signed.keyId, signature_hex: signed.signatureHex } : null,
    leaves,
    leaf_hashes: hashes,
    proof_format: PROOF_FORMAT,
  };
}

/** What a stored report keeps of its proof. */
export interface StoredProof {
  manifest: AgentReportManifest | null;
  signature: { keyId: string; signatureHex: string } | null;
}

/**
 * Rebuilds the bundle of a stored report from its frozen content and the manifest and signature it
 * was stored with, never from live data. Null when the report was stored without a manifest.
 */
export function bundleFromStored(content: ReportContent, proof: StoredProof): AgentReportBundle | null {
  if (!proof.manifest) return null;
  const { leaves, hashes } = commit(content);
  return {
    manifest: proof.manifest,
    signature: proof.signature ? { alg: 'Ed25519', key_id: proof.signature.keyId, signature_hex: proof.signature.signatureHex } : null,
    leaves,
    leaf_hashes: hashes,
    proof_format: PROOF_FORMAT,
  };
}

/**
 * Checks a bundle the way the public verifier does, against the keys Almstins publishes now:
 * `verified` only when the root is the commitment over these leaves and the signature is valid
 * under a published key; `tampered` when either is broken; `unverifiable` when it is intact but
 * unsigned or signed under a key that is not published.
 */
export function verifyReportBundle(bundle: AgentReportBundle): VerifyOutcome {
  const keys = getPublishedKeys().map((k) => ({ key_id: k.key_id, public_key_hex: k.public_key_hex }));
  return verifyBundle(bundle as unknown as ProofBundle, keys);
}
