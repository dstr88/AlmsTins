/**
 * The agent's OWN wallets, the ones it sends from and receives to. Owner only; not public.
 * The address goes in the body, never in the URL.
 *
 * POST   {tinId, chain, address}  -> register a wallet on a tin (adding one that is already there is a 200, added: false).
 *          409 `plan_limit` (cap `wallets`, with `limit` and `used`) when the agent already lists as many
 *          own wallets as its plan allows; removing a wallet frees its place.
 * DELETE ?id=                     -> remove a wallet from the tin (the row stays as history)
 *
 * Wallets are listed with their tin: GET /api/agentics/tins?id=.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { addWallet, removeWallet } from '@/lib/agentVault/vault';

export const prerender = false;

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await addWallet(tenantId, { tinId: parsed.body.tinId, chain: parsed.body.chain, address: parsed.body.address });
  if (!r.ok) return failure(r);
  return json({ ok: true, added: r.added, wallet: r.wallet }, r.added ? 201 : 200);
});

export const DELETE = vaultRoute(async ({ tenantId, url }) => {
  const r = await removeWallet(tenantId, url.searchParams.get('id'));
  return r.ok ? json({ ok: true }) : failure(r);
});
