/**
 * Agent Vault ledger: the dated events on one tin. Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?tinId=&limit=&before=  -> the tin's events, newest first.
 *          `limit` is 1 to 200 (50 when omitted). `next` in the answer is the `before` value for the
 *          following (older) page, or null when this is the last one.
 *
 * Each `checked` event says: this address, at this time, what was answered (`answer`, one of
 * proven, consistent-with-history, flagged, unknown), what the tin's registry said about the
 * address (`registry`), and which key asked (`keyId`, with `keyStatus` so a rotated key stays
 * marked). Events are append-only; there is no way to change or remove one here.
 */
import { failure, json, vaultRoute } from '@/lib/agentVault/api';
import { listTinEvents } from '@/lib/agentVault/vault';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const r = await listTinEvents(tenantId, url.searchParams.get('tinId'), {
    limit: url.searchParams.get('limit'),
    before: url.searchParams.get('before'),
  });
  if (!r.ok) return failure(r);
  return json({ ok: true, events: r.events, next: r.next });
});
