/**
 * What a tin's recorded transfers add up to. Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?tinId=  -> { totals: { transactions, bought, sold } }.
 *          `bought` is value that reached the agent's wallet from a trusted destination and `sold`
 *          is value that left it for one, each as a count and USD at the time of each transfer.
 *          `unpricedCount` counts transfers with no USD value on record; they are never added in
 *          as zero. Raw value in and out: nothing is netted and nothing is priced after the fact.
 */
import { failure, json, vaultRoute } from '@/lib/agentVault/api';
import { getTinTotals } from '@/lib/agentVault/vault';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const r = await getTinTotals(tenantId, url.searchParams.get('tinId'));
  return r.ok ? json(r) : failure(r);
});
