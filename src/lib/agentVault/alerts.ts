/**
 * The real-time alert: when a KEYED check is answered anything but proven, the operator is told at
 * once. Called by recordKeyedCheck (./checkLog.ts) after the check's event is written, without
 * waiting for it: the answer the agent gets and the `vault` block are fixed before this runs and
 * nothing here can change a byte of them. A failure here is logged by name and code and goes no
 * further.
 *
 * Which answers email (the owner's decision, Nov 5, 2026):
 *   proven        never: the only answer to proceed on.
 *   established   only if the account turned the Established email on (off by default). The API
 *                 calls it consistent-with-history: the same trusted address this agent asked about
 *                 before, with nothing flagging it.
 *   everything else, always, with no switch: mismatch, flagged in the registry, not on the agent's
 *                 list, still pending, unanchored, unknown. An option to turn these off may come
 *                 with text messages, not before.
 *
 *   - At most one an hour per account, agent and address, by an atomic claim (./deliveryStore.ts
 *     claimAlert): a burst of checks on one address sends one email, even across processes. The
 *     Established email has an hour of its own (its claim key ends in "|established"), so an
 *     established answer never uses up the hour that a mismatch on the same address would need.
 *     A claim is for an email that goes: when the send fails it is given back (releaseAlert), so the
 *     next check on that address tries again instead of waiting out the hour.
 *   - To the verified operator email only (resolveAlertRecipient), looked up before the claim so a
 *     missing address does not use it up. The email names the answer, and carries no address, no
 *     label and no amount; it links to the Reports page (src/i18n/emails/agentReport.ts).
 *   - Sent by the Vault's own sender (./mailer.ts), which fails when no mail transport is set up
 *     and gives a send twenty seconds, so a send that did not happen is never taken for one that did.
 */
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import { defaultAppBase, getAgentReportEmail } from '@/i18n/emails/agentReport';
import { claimAlert, readSettings, releaseAlert } from './deliveryStore';
import { sendVaultMail } from './mailer';

/**
 * What a check was answered, as the alert names it. One word for each case an operator tells apart;
 * `proven` is not among them (it never emails).
 */
export const ALERT_KINDS = ['mismatch', 'flagged', 'not_on_list', 'pending', 'unanchored', 'unknown', 'established'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** One alert's worth of a check. */
export interface CheckAlertInfo {
  tenantId: string;
  tinId: string;
  /** The address as the ledger holds it (normalized). Never put in the email. */
  address: string;
  kind: AlertKind;
}

/**
 * The alert a check calls for, from the reason it was answered as it was (./checkLog.ts deriveAnswer)
 * and the public status, or null when it calls for none (proven). Pure.
 */
export function alertKindOf(basis: string, status: string): AlertKind | null {
  switch (basis) {
    case 'domain_proof':
      return null;
    case 'registered_and_checked_before':
      return 'established';
    case 'domain_mismatch':
      return 'mismatch';
    case 'registry_flagged':
      return 'flagged';
    case 'not_in_registry':
      return 'not_on_list';
    case 'registry_pending':
      return 'pending';
    default:
      // A trusted address's first check with no domain proof, or a reason this file does not know:
      // say what the public check said. When in doubt the operator is told, never left out.
      return status === 'unanchored' ? 'unanchored' : 'unknown';
  }
}

/** One alert per this long, per account, agent and address. */
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

export type AlertOutcome = 'sent' | 'not_turned_on' | 'no_recipient' | 'rate_limited' | 'failed';

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

/** The address as the claim table keys it: the Established email has an hour of its own. */
export const claimKeyOf = (info: Pick<CheckAlertInfo, 'address' | 'kind'>): string => (info.kind === 'established' ? `${info.address}|established` : info.address);

/** Tells the operator about a check that was not answered proven, unless it has been said this hour (or it is established and that email is off). Never throws. */
export async function alertCheck(info: CheckAlertInfo, deps: AlertDeps = defaultAlertDeps()): Promise<AlertOutcome> {
  try {
    if (info.kind === 'established' && !(await readSettings(info.tenantId)).establishedAlerts) return 'not_turned_on';
    const to = await deps.recipient(info.tenantId);
    if (!to) return 'no_recipient';
    const now = deps.now();
    const claimedAt = now.toISOString();
    const key = claimKeyOf(info);
    const won = await claimAlert(info.tenantId, info.tinId, key, claimedAt, new Date(now.getTime() - ALERT_WINDOW_MS).toISOString());
    if (!won) return 'rate_limited';
    try {
      const mail = getAgentReportEmail('en').alert({ appBase: deps.appBase, kind: info.kind });
      await deps.send({ to, subject: mail.subject, text: mail.text });
      return 'sent';
    } catch (err) {
      // Nothing went out, so the hour is not spent: give the claim back before reporting the failure.
      try {
        await releaseAlert(info.tenantId, info.tinId, key, claimedAt);
      } catch (releaseErr) {
        logFailure('[agent-vault] alert claim not given back', releaseErr);
      }
      throw err;
    }
  } catch (err) {
    logFailure('[agent-vault] alert not sent', err);
    return 'failed';
  }
}
