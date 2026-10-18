/**
 * Agent Vault report delivery settings: who hears what, and how often. Owner only (a plain 404 for
 * anyone else); not public.
 *
 * GET           -> { settings: { cadence, alerts }, recipientAvailable }
 * PUT {cadence?, alerts?}  -> saves what is given, leaves the rest, and answers the same.
 *          cadence: off (the default), daily, weekly, or issues (only when something needs a look).
 *          alerts:  true or false (false by default): an email at once when a check on a registered
 *                   address comes back flagged, at most one an hour per address.
 *          Anything else is 400 invalid_settings.
 *
 * Per account, not per agent: one inbox, one digest. Everything is off until it is turned on. The
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
  const r = await saveReportSettings(tenantId, { cadence: parsed.body.cadence, alerts: parsed.body.alerts });
  return r.ok ? json({ ok: true, settings: r.settings, recipientAvailable: r.recipientAvailable }) : failure(r);
});
