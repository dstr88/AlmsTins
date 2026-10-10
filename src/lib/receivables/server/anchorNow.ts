/**
 * anchorNow: stamp one receivables record's digest into Bitcoin (OpenTimestamps) right after it
 * was written, and keep the pending receipt on the record. The upgrade-anchors cron later pulls
 * the Bitcoin confirmation down, so the record's timestamp becomes permanent without anyone
 * opening a page.
 *
 * One helper for every place that stamps at write time (diligence-accept, discharge, settle)
 * and for the cron's batches, instead of a copy of the stamping code and a limiter in each route.
 *
 * Fail-soft by design. The signed record is already saved when this runs; a stamp that is rate
 * limited, slow or refused by the calendars leaves the record without a timestamp for now, and
 * the result says so plainly ({ anchored: false, anchorError }) instead of pretending. It never
 * throws. Who stamps it later depends on the kind (ANCHOR_SPEC cronStamps): the upgrade-anchors
 * cron retries discharges and settlements (and stamps re-verifications); a diligence acceptance
 * (kind attestation) can still be stamped through /api/verify/receivables/anchor.
 *
 * Rate-limited per tenant: every stamp is a request to the public OpenTimestamps calendars, a
 * shared resource one account must not be able to hammer. Limits are per process (they reset on
 * a deploy), which is enough to blunt bursts.
 *
 * Server-only: it reaches the database through the registry. Only the record's 32-byte digest
 * leaves Almstins; no key, no identity.
 */
import { getRecordForAnchor, setRecordAnchor, type AnchorRecordKind } from '@/lib/receivablesRegistry';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import type { AnchorReceipt } from '@/lib/rwaProof/types';
import { createFixedWindowLimiter, type FixedWindowLimiter } from '@/lib/rateLimit';

const HOUR_MS = 60 * 60 * 1000;

/** Evidence a person just recorded (a diligence acceptance, a discharge, a settlement): 30 stamps
 *  an hour per tenant, shared across those routes. */
export const evidenceStampLimiter = createFixedWindowLimiter({ windowMs: HOUR_MS, max: 30 });

/** Stamps one tenant may get in one run of the anchor cron. */
export const CRON_STAMPS_PER_TENANT = 10;

/**
 * A fresh budget for one run of the anchor cron, which stamps re-verifications ("Verify now"
 * runs) and retries discharges and settlements in batches: CRON_STAMPS_PER_TENANT stamps per
 * tenant, so one account running Verify now in a loop cannot use up a run. With the hourly
 * schedule that is about 10 an hour per tenant.
 *
 * Per run on purpose, not a shared one-hour window: a fixed window opens at a tenant's first
 * stamp, and GitHub starts scheduled runs late by uneven amounts, so the next run can begin a
 * few minutes short of an hour later, find the window still shut and stamp nothing for that
 * tenant all run.
 */
export function newCronStampLimiter(): FixedWindowLimiter {
  return createFixedWindowLimiter({ windowMs: HOUR_MS, max: CRON_STAMPS_PER_TENANT });
}

/** How long one stamp may take before it is reported as not anchored. The calendars are external;
 *  a hung one must not hold a person's request (or the cron) open. */
export const STAMP_TIMEOUT_MS = 15_000;

export type AnchorNowResult =
  | { anchored: true; anchor: AnchorReceipt }
  | { anchored: false; anchorError?: string };

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('anchor_timeout')), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stamp the record `kind`/`id` owned by `tenantId` (always the session's tenant, or the row's own
 * tenant in the cron; never a tenant named in a request body) and store the pending receipt.
 *
 *   { anchored: true, anchor }               stamped now (or already carried a receipt)
 *   { anchored: false, anchorError: 'rate_limited' }   over the tenant's budget; nothing sent
 *   { anchored: false, anchorError }         the calendars failed or timed out
 *   { anchored: false }                      no such record of this tenant's, or nothing to stamp
 */
export async function anchorNow(
  tenantId: string,
  kind: AnchorRecordKind,
  id: string,
  limiter: FixedWindowLimiter,
  opts: { timeoutMs?: number } = {},
): Promise<AnchorNowResult> {
  if (limiter.hit(`tenant:${tenantId}`)) return { anchored: false, anchorError: 'rate_limited' };
  try {
    const record = await getRecordForAnchor(tenantId, kind, id);
    if (!record) return { anchored: false };
    // Never replace a receipt the record already carries: it may be the confirmed one.
    if (record.anchorJson) return { anchored: true, anchor: JSON.parse(record.anchorJson) as AnchorReceipt };
    const receipt = await withTimeout(
      new OpenTimestampsAnchor().stamp(record.digest.toLowerCase()),
      opts.timeoutMs ?? STAMP_TIMEOUT_MS,
    );
    await setRecordAnchor(tenantId, kind, id, JSON.stringify(receipt));
    return { anchored: true, anchor: receipt };
  } catch (err) {
    return { anchored: false, anchorError: String((err as Error)?.message || err) };
  }
}
