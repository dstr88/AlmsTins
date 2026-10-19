/**
 * The live feed: what the Vault has written to an account's ledger lately, for a page that asks every few
 * seconds. Owner only (a plain 404 for anyone else); not public.
 *
 * GET                   -> the newest events of every agent on the account, oldest first (`limit` 1 to 100, 30
 *                          when omitted). What a page that is just opening shows.
 * GET ?since=<time>     -> a live poll: events written from five seconds before `since` on, oldest first
 *                          (`limit` 1 to 200, 100 when omitted). `since` is the `since` of the last answer,
 *                          "YYYY-MM-DD HH:MM:SS" in UTC. The overlap is deliberate (the ledger stamps events
 *                          to the second): a page drops what it already has by `id`.
 * GET ?after=<cursor>   -> the next page of a backlog: events strictly after `cursor`, the `cursor` of the
 *                          last answer, which said `more: true`.
 * ...&tinId=<id>        -> only that agent (404 `tin_not_found` when it is not this account's).
 *
 * The answer is `{ ok, events, since, cursor, more, now }`. Each event is what /api/agentics/events gives its
 * owner, plus `writtenAt` (when the Vault wrote it; `at` is when it happened, which for a transfer is minutes
 * earlier), `agent` (the agent's name) and `label` (the owner's label for the address, or null). Text in
 * `agent`, `label` and the asset is the account's own or the chain's, and untrusted: escape it.
 *
 * At most 120 requests a minute for an account (429 `rate_limited`, with `Retry-After`); the count is per
 * process and resets on a restart. A page that polls every three seconds uses 20.
 */
import { failure, json, vaultRoute } from '@/lib/agentVault/api';
import { fail } from '@/lib/agentVault/errors';
import { FEED_REQUEST_WINDOW_MS, FEED_REQUESTS_PER_WINDOW, readFeed } from '@/lib/agentVault/feed';
import { createFixedWindowLimiter } from '@/lib/rateLimit';

export const prerender = false;

const limiter = createFixedWindowLimiter({ windowMs: FEED_REQUEST_WINDOW_MS, max: FEED_REQUESTS_PER_WINDOW });

export const GET = vaultRoute(async ({ tenantId, url }) => {
  if (limiter.hit(`t:${tenantId}`)) return failure(fail('rate_limited'));
  const q = url.searchParams;
  const r = await readFeed(tenantId, { since: q.get('since'), after: q.get('after'), limit: q.get('limit'), tinId: q.get('tinId') });
  return r.ok ? json(r) : failure(r);
});
