/**
 * Read the chain now for one tin. Owner only (a plain 404 for anyone else); not public.
 *
 * POST {tinId}  -> runs the same pass the daily job runs: for each of the tin's wallets, look for
 *          movements of funds between the wallet and the tin's trusted destinations, and record
 *          the new ones in the ledger. Answers what was read.
 *
 * The read stops starting new calls after about 20 seconds. A tin with many wallets may answer
 * `partial` for some of them; call again, or leave it to the daily run, and it continues where it
 * stopped. Only trusted, registered destinations are watched; a transfer to any other address is
 * not recorded, counted or mentioned. One read of a tin runs at a time (409 `refresh_in_progress`).
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { refreshTin } from '@/lib/agentVault/vault';

export const prerender = false;

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await refreshTin(tenantId, parsed.body.tinId);
  return r.ok ? json(r) : failure(r);
});
