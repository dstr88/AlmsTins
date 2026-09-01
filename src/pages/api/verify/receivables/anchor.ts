/**
 * POST /api/verify/receivables/anchor — Bitcoin-anchor a registry record (authenticated).
 *
 * Body:
 *   { kind, id }                 -> stamp the record's digest, store + return a pending receipt
 *   { kind, id, upgrade: true }  -> upgrade the stored receipt once Bitcoin confirms (~1-2h)
 *
 * kind ∈ 'receivable' | 'claim' | 'attestation'. Tenant-scoped: only the record's owner
 * can attach its anchor. Gives every signed record an unforgeable, backdate-proof date.
 * Non-fatal: calendar hiccups return ok:false, never a 500 — the signed record is
 * unaffected. Anchoring only ever handles the record's 32-byte digest; no key, no identity.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getRecordForAnchor, setRecordAnchor, type AnchorRecordKind } from '@/lib/receivablesRegistry';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import type { AnchorReceipt } from '@/lib/rwaProof/types';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const KINDS: AnchorRecordKind[] = ['receivable', 'claim', 'attestation'];

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const kind = body.kind as AnchorRecordKind;
  if (!KINDS.includes(kind)) return json({ ok: false, error: 'invalid_kind' }, 400);
  const id = String(body.id ?? '');

  const record = await getRecordForAnchor(session.tenantId, kind, id);
  if (!record) return json({ ok: false, error: 'not_found' }, 404);

  const anchor = new OpenTimestampsAnchor();
  try {
    if (body.upgrade) {
      if (!record.anchorJson) return json({ ok: false, error: 'no_anchor' }, 400);
      const receipt = JSON.parse(record.anchorJson) as AnchorReceipt;
      const upgraded = await anchor.upgrade(receipt);
      await setRecordAnchor(session.tenantId, kind, id, JSON.stringify(upgraded));
      return json({ ok: true, anchor: upgraded });
    }
    const receipt = await anchor.stamp(record.digest.toLowerCase());
    await setRecordAnchor(session.tenantId, kind, id, JSON.stringify(receipt));
    return json({ ok: true, anchor: receipt });
  } catch (err) {
    return json({ ok: false, error: 'anchor_unavailable', detail: String((err as Error)?.message || err) }, 502);
  }
};
