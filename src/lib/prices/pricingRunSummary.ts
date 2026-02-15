// src/lib/prices/pricingRunSummary.ts

export type PricingProvider = 'coingecko' | 'coinpaprika' | 'cryptocompare' | 'dex' | 'manual' | 'unknown';

export type SkipReason =
  | 'locked'
  | 'invalid_payload'
  | 'no_symbol'
  | 'excluded_source'
  | 'unsupported_asset'
  | 'already_priced'
  | 'zero_value'
  | 'bad_timestamp'
  | 'bad_amount'
  | 'bad_usd_value'
  | 'no_coingecko_id'
  | 'no_price_for_date'
  | 'no_spot_price'
  | 'provider_error'
  | 'db_error'
  | 'update_noop'
  | 'spam_unverified'
  | 'unknown';

export type ProviderCallKind =
  | 'spot'
  | 'historical'
  | 'contract'
  | 'metadata'
  | 'other';

export type PricingRunSummary = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;

  attemptedCount: number;
  pricedCount: number;
  skippedCount: number;
  rejectedCount: number;

  skippedByReason: Partial<Record<SkipReason, number>>;
  rejectedByReason: Partial<Record<SkipReason, number>>;

  providerCalls: Partial<Record<PricingProvider, number>>;
  providerCallsByKind: Partial<Record<PricingProvider, Partial<Record<ProviderCallKind, number>>>>;

  // "unique assets" == whatever identity you choose (see helpers below)
  uniqueAssetsRequested: number;
  uniqueAssetsKeySample: string[]; // keep it small for logs
};

const nowIso = () => new Date().toISOString();
const newRunId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(16).slice(2)}`);

const clampSamplePush = (arr: string[], item: string, limit = 20) => {
  if (arr.length >= limit) return;
  if (!arr.includes(item)) arr.push(item);
};

export function createPricingRunSummary(opts?: { runId?: string }): PricingRunSummary {
  const startedAt = nowIso();
  return {
    runId: opts?.runId ?? newRunId(),
    startedAt,
    attemptedCount: 0,
    pricedCount: 0,
    skippedCount: 0,
    rejectedCount: 0,
    skippedByReason: Object.create(null) as Partial<Record<SkipReason, number>>,
    rejectedByReason: Object.create(null) as Partial<Record<SkipReason, number>>,
    providerCalls: Object.create(null) as Partial<Record<PricingProvider, number>>,
    providerCallsByKind: Object.create(null) as Partial<Record<PricingProvider, Partial<Record<ProviderCallKind, number>>>>,
    uniqueAssetsRequested: 0,
    uniqueAssetsKeySample: [],
  };
}

export function finalizePricingRunSummary(summary: PricingRunSummary) {
  const finishedAt = nowIso();
  const started = Date.parse(summary.startedAt);
  const finished = Date.parse(finishedAt);
  summary.finishedAt = finishedAt;
  summary.durationMs = Number.isFinite(started) && Number.isFinite(finished) ? finished - started : undefined;
  summary.skippedCount = summary.attemptedCount - summary.pricedCount;
  return summary;
}

// --- mutation helpers (tiny, safe) ---

export function markAttempted(summary: PricingRunSummary, n = 1) {
  summary.attemptedCount += n;
}

export function markPriced(summary: PricingRunSummary, n = 1) {
  summary.pricedCount += n;
}

export function markSkipped(summary: PricingRunSummary, reason: SkipReason, n = 1) {
  summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + n;
}

// Attempted = eligible for pricing. Rejected = ineligible or policy-filtered before provider pricing.
export function markRejected(summary: PricingRunSummary, reason: SkipReason, n = 1) {
  summary.rejectedCount += n;
  summary.rejectedByReason[reason] = (summary.rejectedByReason[reason] ?? 0) + n;
}

export function countProviderCall(
  summary: PricingRunSummary,
  provider: PricingProvider,
  kind: ProviderCallKind = 'other',
  n = 1,
) {
  summary.providerCalls[provider] = (summary.providerCalls[provider] ?? 0) + n;
  const byKind = (summary.providerCallsByKind[provider] ??= Object.create(null));
  byKind[kind] = (byKind[kind] ?? 0) + n;
}

/**
 * Track unique “asset request keys” so you can see dedupe working.
 * You choose a key format; examples:
 * - `cg:bitcoin@2026-02-14`
 * - `erc20:1:0xa0b869...@2026-02-14`
 * - `sym:ETH@2026-02-14`
 */
export function trackUniqueAssetRequest(summary: PricingRunSummary, assetKey: string, set: Set<string>) {
  if (!assetKey) return;
  if (!set.has(assetKey)) {
    set.add(assetKey);
    summary.uniqueAssetsRequested = set.size;
    clampSamplePush(summary.uniqueAssetsKeySample, assetKey);
  }
}

// Pretty, human log line (optional)
export function formatPricingRunOneLiner(summary: PricingRunSummary) {
  const topSkipReasons = Object.entries(summary.skippedByReason)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 5)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const topRejectedReasons = Object.entries(summary.rejectedByReason)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 5)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const providerCalls = Object.entries(summary.providerCalls)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  return `pricing run ${summary.runId}: priced=${summary.pricedCount}, attempted=${summary.attemptedCount}, skipped=${summary.skippedCount}, rejected=${summary.rejectedCount}` +
    (topSkipReasons ? ` (top skips: ${topSkipReasons})` : '') +
    (topRejectedReasons ? ` (top rejects: ${topRejectedReasons})` : '') +
    (providerCalls ? ` | calls: ${providerCalls}` : '') +
    ` | uniqueAssets=${summary.uniqueAssetsRequested}` +
    (summary.durationMs != null ? ` | ${summary.durationMs}ms` : '');
}
