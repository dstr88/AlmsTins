/**
 * Agent Vault tins: one tin per agent. Owner only (a plain 404 for anyone else); not public.
 *
 * GET              -> the tenant's tins
 * GET    ?id=      -> one tin with its own wallets and its destinations
 * POST   {label, agentKeyId?}        -> create a tin (agentKeyId: an active key from /api/verify/agent-keys).
 *          409 `plan_limit` (cap `bots`, with `limit` and `used`) when the account already has as many
 *          agents as its plan allows; removing an agent frees its place. See GET /api/agentics/plan.
 * PATCH  {id, label?, agentKeyId?}   -> rename, or link, relink or unlink (null) the agent key
 * DELETE ?id=      -> remove the tin; its wallets and destinations go with it, as history
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { createTin, getTinDetail, listTins, removeTin, renameOrRelinkTin } from '@/lib/agentVault/vault';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const id = url.searchParams.get('id');
  if (id !== null) {
    const r = await getTinDetail(tenantId, id);
    return r.ok ? json({ ok: true, tin: r.tin, wallets: r.wallets, destinations: r.destinations }) : failure(r);
  }
  return json({ ok: true, tins: await listTins(tenantId) });
});

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await createTin(tenantId, { label: parsed.body.label, agentKeyId: parsed.body.agentKeyId });
  return r.ok ? json({ ok: true, tin: r.tin }, 201) : failure(r);
});

export const PATCH = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await renameOrRelinkTin(tenantId, parsed.body.id, {
    label: parsed.body.label,
    agentKeyId: parsed.body.agentKeyId,
  });
  return r.ok ? json({ ok: true, tin: r.tin }) : failure(r);
});

export const DELETE = vaultRoute(async ({ tenantId, url }) => {
  const r = await removeTin(tenantId, url.searchParams.get('id'));
  return r.ok ? json({ ok: true }) : failure(r);
});
