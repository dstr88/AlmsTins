/**
 * GET /api/cron/upgrade-anchors
 *
 * Pulls Bitcoin confirmations down for every registry record whose anchor is still
 * pending, and persists the confirmed receipt — so a claim's timestamp becomes
 * permanent in our records without anyone opening the page. OpenTimestamps sends no
 * push; this is the scheduled "ask" that records a confirmation once it lands (~1-2h
 * after stamping). A still-pending receipt is left untouched and retried next run.
 *
 * Read-only against the chain: only ever handles each record's 32-byte digest receipt —
 * no key, no identity, no movement. Protected by CRON_SECRET; never touches sessions.
 * Called by the GitHub Actions workflow: .github/workflows/upgrade-anchors.yml
 */
import type { APIRoute } from 'astro';
import { listPendingAnchors, setRecordAnchor, type AnchorRecordKind } from '@/lib/receivablesRegistry';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import type { AnchorReceipt } from '@/lib/rwaProof/types';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_PER_RUN = 50;

export const GET: APIRoute = async ({ request }) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();

  let pending: Array<{ kind: AnchorRecordKind; id: string; tenantId: string; anchorJson: string }> = [];
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
        confirmed++;
      }
    } catch {
      failed++; // transient calendar/network issue — retried next run
    }
  }

  return json({ ok: true, checked, confirmed, failed, pending: pending.length, elapsed_ms: Date.now() - started });
};
