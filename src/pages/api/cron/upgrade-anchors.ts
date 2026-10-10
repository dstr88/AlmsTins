/**
 * GET /api/cron/upgrade-anchors
 *
 * Two passes over the receivables registry, hourly:
 *
 * 1. Upgrade. Pulls Bitcoin confirmations down for every record whose anchor is still
 *    pending, and persists the confirmed receipt — so a claim's timestamp becomes
 *    permanent in our records without anyone opening the page. OpenTimestamps sends no
 *    push; this is the scheduled "ask" that records a confirmation once it lands (~1-2h
 *    after stamping). A still-pending receipt is left untouched and retried next run;
 *    each ask is noted in receivable_anchor_attempts, so a receipt that never confirms
 *    rotates to the back of the queue instead of taking a slot every hour.
 *
 * 2. Stamp. Re-verifications ("Verify now" runs) are not stamped when they are recorded, and a
 *    discharge or settlement whose stamp failed or was rate limited when it was recorded has
 *    none yet; this pass stamps a batch of them (anchorNow), which the next run's upgrade pass
 *    confirms. At most MAX_STAMPS_PER_RUN a run and CRON_STAMPS_PER_TENANT per tenant a run,
 *    with the tenants taking turns (listUnanchoredRecords), and no new stamp after
 *    STAMP_BUDGET_MS.
 *
 * Fail-soft: a calendar hiccup counts as failed and is retried next run; neither pass can
 * fail the other. Read-only against the chain: only ever handles each record's 32-byte
 * digest receipt — no key, no identity, no movement. Protected by CRON_SECRET; never
 * touches sessions. Called by the GitHub Actions workflow: .github/workflows/upgrade-anchors.yml
 */
import type { APIRoute } from 'astro';
import {
  listPendingAnchors,
  listUnanchoredRecords,
  setRecordAnchor,
  recordAnchorAttempt,
  clearAnchorAttempts,
  type PendingAnchor,
} from '@/lib/receivablesRegistry';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import type { AnchorReceipt } from '@/lib/rwaProof/types';
import { anchorNow, newCronStampLimiter, CRON_STAMPS_PER_TENANT } from '@/lib/receivables/server/anchorNow';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_PER_RUN = 50;
/** Records stamped per run. Each is one request to the public calendars. */
const MAX_STAMPS_PER_RUN = 20;
/** No new stamp starts after this much of the run has passed (the workflow allows 600 s). */
const STAMP_BUDGET_MS = 300_000;

export const GET: APIRoute = async ({ request }) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();

  // ── 1. Upgrade pending receipts ─────────────────────────────────────────
  let pending: PendingAnchor[] = [];
  try {
    pending = await listPendingAnchors(MAX_PER_RUN);
  } catch (err) {
    return json({ ok: false, error: 'list_failed', detail: String((err as Error)?.message || err) }, 500);
  }

  const anchor = new OpenTimestampsAnchor();
  let checked = 0, confirmed = 0, failed = 0;

  for (const p of pending) {
    checked++;
    try {
      const receipt = JSON.parse(p.anchorJson) as AnchorReceipt;
      const upgraded = await anchor.upgrade(receipt);
      // Only persist when Bitcoin has actually confirmed it — a still-pending
      // receipt is left as-is and asked again next run.
      if (upgraded && (upgraded as { anchoredAt?: string }).anchoredAt) {
        await setRecordAnchor(p.tenantId, p.kind, p.id, JSON.stringify(upgraded));
        await clearAnchorAttempts(p.kind, p.id);
        confirmed++;
      } else {
        await recordAnchorAttempt(p.kind, p.id);
      }
    } catch {
      failed++; // transient calendar/network issue — retried next run
      await recordAnchorAttempt(p.kind, p.id);
    }
  }

  // ── 2. Stamp a batch of unstamped records ───────────────────────────────
  let stamped = 0, stampFailed = 0, stampLimited = 0;
  let stampError: string | undefined;
  try {
    const toStamp = await listUnanchoredRecords(MAX_STAMPS_PER_RUN, CRON_STAMPS_PER_TENANT);
    const limiter = newCronStampLimiter(); // this run's per-tenant budget
    for (const r of toStamp) {
      if (Date.now() - started > STAMP_BUDGET_MS) break;
      const res = await anchorNow(r.tenantId, r.kind, r.id, limiter);
      if (res.anchored) {
        stamped++;
        await clearAnchorAttempts(r.kind, r.id);
      } else if (res.anchorError === 'rate_limited') {
        // Over this run's budget for the tenant (the listing already caps each tenant, so this is
        // a backstop). Nothing was sent, so nothing is noted; the record waits for a later run.
        stampLimited++;
      } else {
        // The calendars failed or timed out: noted, so the record rotates behind the ones not yet
        // tried instead of taking the first slot every run.
        stampFailed++;
        await recordAnchorAttempt(r.kind, r.id);
      }
    }
  } catch {
    stampError = 'list_failed';
  }

  return json({
    ok: true, checked, confirmed, failed, pending: pending.length,
    stamped, stampFailed, stampLimited, ...(stampError ? { stampError } : {}),
    elapsed_ms: Date.now() - started,
  });
};
