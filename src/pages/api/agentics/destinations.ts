/**
 * Agent Vault destinations: the trusted-destination registry of a tin. Owner only; not public.
 * Addresses go in the body, never in the URL.
 *
 * GET    ?tinId=                      -> the tin's live destinations, each with its pill and readout
 * POST   {tinId, text, chain?, trust?} -> Add + Trust. `text` is a pasted list, one destination per
 *          line ("0x..." or "0x..., label", CSV pastes fine); `chain` is the default for lines
 *          that name none (ethereum if omitted). Each address is stored, then checked once (OFAC
 *          sanctions, security screening, the Verify registry), and ends up trusted, flagged or
 *          pending. `trust: false` adds without checking. Answers
 *          "N added, M flagged": every line is in destinations, skipped or rejected.
 *          An address the account's plan has no place left for is skipped with the reason
 *          `over_limit` and stores nothing; a paste of which not one address fits is refused as a
 *          whole, 409 `plan_limit` (cap `addresses`, with `limit` and `used`), and that refusal also
 *          carries `skipped` and `rejected`, the same lists an accepted paste carries, so every line
 *          is accounted for (an address already registered is reported as that, not as over the
 *          limit). The limit is for all the account's agents together. Removing an address frees its
 *          place.
 *          Checking is paid for in addresses: an account on a plan with a cap on addresses may have
 *          30 addresses checked in a minute, for adds and re-checks together (429 `rate_limited`
 *          when a request would pass that, with nothing stored and nothing asked). `trust: false`
 *          adds without checking and costs none. An address checked in the last five minutes, by
 *          anyone, is answered from the public checker's cache when that holds a complete answer.
 * DELETE ?id=                          -> remove from the watched set; the row stays as history
 *
 * "Pass" means the address cleared the checks we ran. It never means the address is safe.
 * "Trusted" is the owner's own designation. Re-check or complete a check: POST /api/agentics/destinations/trust.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { addDestinations, listTinDestinations, removeDestination } from '@/lib/agentVault/vault';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const r = await listTinDestinations(tenantId, url.searchParams.get('tinId'));
  return r.ok ? json({ ok: true, destinations: r.destinations }) : failure(r);
});

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { tinId, text, chain, trust } = parsed.body;
  const r = await addDestinations(tenantId, { tinId, text, chain, trust });
  // 201 only when something was created; a paste whose every line was skipped or rejected is a 200.
  return r.ok ? json(r, r.summary.added > 0 ? 201 : 200) : failure(r);
});

export const DELETE = vaultRoute(async ({ tenantId, url }) => {
  const r = await removeDestination(tenantId, url.searchParams.get('id'));
  return r.ok ? json({ ok: true }) : failure(r);
});
