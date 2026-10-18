/**
 * An account's report delivery settings, as the owner reads and sets them: how often to be sent a
 * digest (off, daily, weekly, or only when something needs a look) and whether to be told at once
 * about a flagged check. Validation and rules here; SQL in ./deliveryStore.ts.
 *
 * Per ACCOUNT, not per agent: one operator has one inbox, so there is one digest for all of an
 * account's agents, and one place to turn it on or off. Everything is off until the owner turns it
 * on. Every operation takes the tenant first and never reads one from a request.
 */
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { CADENCES, readSettings, writeSettings, type Cadence } from './deliveryStore';
import { fail, type Failure } from './errors';
import { nowUtc } from './store';

export interface ReportSettings {
  cadence: Cadence;
  alerts: boolean;
}

export interface SettingsView {
  settings: ReportSettings;
  /** Whether the account has an email address to send to. The address itself is never returned. */
  recipientAvailable: boolean;
}

/** The account's settings (everything off when it has set none), and whether anything could be sent to it. */
export async function getReportSettings(tenantId: string): Promise<SettingsView> {
  const stored = await readSettings(tenantId);
  const recipient = await resolveAlertRecipient(tenantId);
  return { settings: { cadence: stored.cadence, alerts: stored.alerts }, recipientAvailable: recipient.email !== null };
}

/**
 * Sets the account's cadence and/or alerts. A field left out is left as it is; one that is not a
 * known cadence or not a real true/false is refused, and so is a request that sets nothing.
 */
export async function saveReportSettings(
  tenantId: string,
  input: { cadence?: unknown; alerts?: unknown },
): Promise<({ ok: true } & SettingsView) | Failure> {
  const hasCadence = input.cadence !== undefined;
  const hasAlerts = input.alerts !== undefined;
  if (!hasCadence && !hasAlerts) return fail('invalid_settings');
  if (hasCadence && !(typeof input.cadence === 'string' && (CADENCES as readonly string[]).includes(input.cadence))) return fail('invalid_settings');
  if (hasAlerts && typeof input.alerts !== 'boolean') return fail('invalid_settings');

  const current = await readSettings(tenantId);
  const next: ReportSettings = {
    cadence: hasCadence ? (input.cadence as Cadence) : current.cadence,
    alerts: hasAlerts ? (input.alerts as boolean) : current.alerts,
  };
  await writeSettings(tenantId, next, nowUtc());
  const recipient = await resolveAlertRecipient(tenantId);
  return { ok: true, settings: next, recipientAvailable: recipient.email !== null };
}
