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
 *   everything else, always, with no switch: mismatch, flagged in the registry, flagged by the
 *                 check's own sanctions or security screening, not on the agent's
 *                 list, still pending, unanchored, unknown. An option to turn these off may come
 *                 with text messages, not before.
 *
 * And one that is not a check (the owner's decision, Nov 6, 2026): an UNMATCHED payment, a transfer
 * out of an agent's own wallet to an address not on its list with no check about that address in the
 * hour before (./counterparty.ts isUnmatched). Always on, with no switch, like the answers above. The
 * watcher calls it when it writes such a transfer (./watcher.ts), and only for a transfer no older
 * than UNMATCHED_ALERT_MAX_AGE_MS when it is read, so a read that catches up on old history does not
 * email about payments made long ago. It links to the agent's page rather than the Reports page.
 * It says how many unmatched payments to that address it covers: every one this agent made to it in the
 * last UNMATCHED_ALERT_MAX_AGE_MS that was recorded after the previous unmatched email for the address
 * (the ones the hourly limit kept quiet, and the ones the read that calls it found), or, with no previous
 * email (or one whose send failed), every one in that window. Payments too old to email are not counted.
 *
 *   - At most one an hour per account, agent and address, by an atomic claim (./deliveryStore.ts
 *     claimAlert): a burst of checks on one address sends one email, even across processes. The
 *     Established email has an hour of its own (its claim key ends in "|established"), so an
 *     established answer never uses up the hour that a mismatch on the same address would need; the
 *     unmatched-payment email has its own too ("|unmatched"), so a payment and a check about the same
 *     address never hold each other back.
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
import { claimAlert, readAlertClaim, readSettings, releaseAlert } from './deliveryStore';
import { countUnmatchedPayments } from './events';
import { sendVaultMail } from './mailer';

/**
 * What a check was answered, as the alert names it. One word for each case an operator tells apart;
 * `proven` is not among them (it never emails).
 */
export const ALERT_KINDS = ['mismatch', 'flagged', 'screening', 'not_on_list', 'pending', 'unanchored', 'unknown', 'established', 'unmatched'] as const;
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
    case 'screening_flagged':
      // The check's own screening found something. The email says Flagged, and that it was the screening.
      return 'screening';
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

/**
 * The oldest an unmatched payment may be, against the moment the read finds it, and still be emailed.
 * The daily read runs once a day and can start late, so a payment made just after one read is found by
 * the next a little over a day later: 36 hours covers that. Older payments (a wallet left unread through
 * an outage) are recorded and marked as usual, and not emailed.
 */
export const UNMATCHED_ALERT_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Whether an unmatched payment made at `atMs` and read at `nowMs` is new enough to email. Pure. */
export const unmatchedAlertDue = (atMs: number, nowMs: number): boolean => Number.isFinite(atMs) && nowMs - atMs <= UNMATCHED_ALERT_MAX_AGE_MS;

export type AlertOutcome = 'sent' | 'not_turned_on' | 'no_recipient' | 'rate_limited' | 'failed';

export interface AlertDeps {
  now: () => Date;
  /** How many unmatched payments an unmatched-payment email covers (../events.ts countUnmatchedPayments); the real count when left out. */
  countUnmatched?: typeof countUnmatchedPayments;
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

/** The address as the claim table keys it: the Established email and the unmatched-payment email each have an hour of their own. */
export const claimKeyOf = (info: Pick<CheckAlertInfo, 'address' | 'kind'>): string =>
  info.kind === 'established' ? `${info.address}|established` : info.kind === 'unmatched' ? `${info.address}|unmatched` : info.address;

/** UTC "YYYY-MM-DD HH:MM:SS", the form the ledger's created_at is written in. */
const writtenStamp = (iso: string): string => iso.slice(0, 19).replace('T', ' ');

/** The unmatched payments one email covers, at least the one that called it (a count that reads 0 was raced by a concurrent read). */
async function unmatchedCount(info: CheckAlertInfo, previous: string | null, now: Date, deps: AlertDeps): Promise<number> {
  const count = deps.countUnmatched ?? countUnmatchedPayments;
  const n = await count(info.tenantId, info.tinId, info.address, {
    fromIso: new Date(now.getTime() - UNMATCHED_ALERT_MAX_AGE_MS).toISOString(),
    afterWritten: previous ? writtenStamp(previous) : null,
  });
  return Math.max(1, n);
}

/** Tells the operator about a check that was not answered proven, or an unmatched payment, unless it has been said this hour (or it is established and that email is off). Never throws. */
export async function alertCheck(info: CheckAlertInfo, deps: AlertDeps = defaultAlertDeps()): Promise<AlertOutcome> {
  try {
    if (info.kind === 'established' && !(await readSettings(info.tenantId)).establishedAlerts) return 'not_turned_on';
    const to = await deps.recipient(info.tenantId);
    if (!to) return 'no_recipient';
    const now = deps.now();
    const claimedAt = now.toISOString();
    const key = claimKeyOf(info);
    // The previous unmatched email for this address, read before the claim moves it: what the count runs from.
    const previous = info.kind === 'unmatched' ? await readAlertClaim(info.tenantId, info.tinId, key) : null;
    const won = await claimAlert(info.tenantId, info.tinId, key, claimedAt, new Date(now.getTime() - ALERT_WINDOW_MS).toISOString());
    if (!won) return 'rate_limited';
    try {
      const payments = info.kind === 'unmatched' ? await unmatchedCount(info, previous, now, deps) : undefined;
      const mail = getAgentReportEmail('en').alert({ appBase: deps.appBase, kind: info.kind, tinId: info.tinId, payments, sinceLast: previous !== null });
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
