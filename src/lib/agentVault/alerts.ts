/**
 * The real-time alert: when a KEYED check answers `flagged` for a destination that is in the
 * owner's registry, the operator is told at once, if the account turned alerts on. Called by
 * recordKeyedCheck (./checkLog.ts) after the check's event is written, without waiting for it: the
 * answer the agent gets and the `vault` block are fixed before this runs and nothing here can
 * change a byte of them. A failure here is logged by name and code and goes no further.
 *
 *   - Only a registered address. A mismatch on an address that is not in the registry does not
 *     alert (it shows in the report's "not confirmed" group); the caller never sends it here.
 *   - Only if the account turned alerts on (everything is off until the owner turns it on).
 *   - At most one an hour per account, agent and address, by an atomic claim (./deliveryStore.ts
 *     claimAlert): a burst of flagged checks on one address sends one email, even across processes.
 *     A claim is for an email that goes: when the send fails it is given back (releaseAlert), so the
 *     next flagged check on that address tries again instead of waiting out the hour.
 *   - To the verified operator email only (resolveAlertRecipient), looked up before the claim so a
 *     missing address does not use it up. The email carries no address, no label and no amount,
 *     and links to the Reports page (src/i18n/emails/agentReport.ts).
 *   - Sent by the Vault's own sender (./mailer.ts), which fails when no mail transport is set up
 *     and gives a send twenty seconds, so a send that did not happen is never taken for one that did.
 */
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { defaultAppBase, getAgentReportEmail } from '@/i18n/emails/agentReport';
import { claimAlert, readSettings, releaseAlert } from './deliveryStore';
import { sendVaultMail } from './mailer';

/** One alert's worth of a flagged check. */
export interface FlaggedCheckInfo {
  tenantId: string;
  tinId: string;
  /** The address as the ledger holds it (normalized). */
  address: string;
}

/** One alert per this long, per account, agent and address. */
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

export type AlertOutcome = 'sent' | 'alerts_off' | 'no_recipient' | 'rate_limited' | 'failed';

export interface AlertDeps {
  now: () => Date;
  recipient: (tenantId: string) => Promise<string | null>;
  send: (mail: { to: string; subject: string; text: string }) => Promise<void>;
  appBase: string;
}

export const defaultAlertDeps = (): AlertDeps => ({
  now: () => new Date(),
  recipient: async (tenantId) => (await resolveAlertRecipient(tenantId)).email,
  send: sendVaultMail,
  appBase: defaultAppBase(),
});

/** An error as it is logged: its name and code, never its text (a database or mail error can carry the values it was given). */
function logFailure(what: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error(what, { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/** Tells the operator about a flagged check, when they asked to be told and it has not been said this hour. Never throws. */
export async function alertFlaggedCheck(info: FlaggedCheckInfo, deps: AlertDeps = defaultAlertDeps()): Promise<AlertOutcome> {
  try {
    if (!(await readSettings(info.tenantId)).alerts) return 'alerts_off';
    const to = await deps.recipient(info.tenantId);
    if (!to) return 'no_recipient';
    const now = deps.now();
    const claimedAt = now.toISOString();
    const won = await claimAlert(info.tenantId, info.tinId, info.address, claimedAt, new Date(now.getTime() - ALERT_WINDOW_MS).toISOString());
    if (!won) return 'rate_limited';
    try {
      const mail = getAgentReportEmail('en').alert({ appBase: deps.appBase });
      await deps.send({ to, subject: mail.subject, text: mail.text });
      return 'sent';
    } catch (err) {
      // Nothing went out, so the hour is not spent: give the claim back before reporting the failure.
      try {
        await releaseAlert(info.tenantId, info.tinId, info.address, claimedAt);
      } catch (releaseErr) {
        logFailure('[agent-vault] flagged alert claim not given back', releaseErr);
      }
      throw err;
    }
  } catch (err) {
    logFailure('[agent-vault] flagged alert not sent', err);
    return 'failed';
  }
}
