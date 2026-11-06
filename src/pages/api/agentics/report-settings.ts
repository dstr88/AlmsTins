/**
 * Agent Vault report delivery settings: who hears what, and how often. Owner only (a plain 404 for
 * anyone else); not public.
 *
 * GET           -> { settings: { cadence, establishedAlerts }, recipientAvailable }
 * PUT {cadence?, establishedAlerts?}  -> saves what is given, leaves the rest, and answers the same.
 *          cadence: off (the default), daily, weekly, or issues (only when something needs a look).
 *          establishedAlerts: true or false (false by default): an email at once when a check comes
 *                   back established, at most one an hour per address.
 *          Anything else is 400 invalid_settings. A check that is neither proven nor established is
 *          always emailed (src/lib/agentVault/alerts.ts); there is no setting for it.
 *
 * Per account, not per agent: one inbox, one digest. The digest and the Established email are off until turned on. The
 * email goes to the account's verified operator email; the address is never returned here, only
 * whether there is one (`recipientAvailable`).
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { getReportSettings, saveReportSettings } from '@/lib/agentVault/delivery';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId }) => json({ ok: true, ...(await getReportSettings(tenantId)) }));

export const PUT = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await saveReportSettings(tenantId, { cadence: parsed.body.cadence, establishedAlerts: parsed.body.establishedAlerts });
  return r.ok ? json({ ok: true, settings: r.settings, recipientAvailable: r.recipientAvailable }) : failure(r);
});
