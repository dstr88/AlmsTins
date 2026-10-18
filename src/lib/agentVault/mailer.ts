/**
 * The one way the Vault sends an email: a digest or a flagged-check alert. It wraps the shared
 * mailer (src/lib/email.ts) and changes two things, because the Vault counts a send as done and
 * remembers it (a digest key, an hourly alert claim):
 *
 *   - No mail transport is a failure. The shared mailer logs "skipping send" and returns as if it
 *     had sent, which is right for a feature that only wants to try. A job that counts the message
 *     as sent, and stores that it went out, must hear that nothing was handed to a transport. So
 *     this throws when EMAIL_SERVER is not set, the same condition the shared mailer skips on.
 *   - One send gets 20 seconds. A mail server that accepts the connection and then says nothing
 *     must not hold the daily job's serial loop past its budget. A send that times out may still
 *     complete in the background; the caller treats it as failed, gives its claim back, and a
 *     retry can then send it again.
 *
 * Both failures carry a name and a code and no address, so they log safely (the job logs name and
 * code only). Who may be sent what, and how often, is ./alerts.ts and ./reportJob.ts; this file
 * does not decide that. The shared mailer is not changed: many other features use it as it is.
 */
import { sendMail } from '@/lib/email';

export interface VaultMail {
  to: string;
  subject: string;
  text: string;
}

/** One send is given this long before it counts as failed. */
export const SEND_TIMEOUT_MS = 20_000;

/** No mail transport is configured, so nothing could be sent. */
export class MailUnavailableError extends Error {
  readonly code = 'E_NO_MAIL_TRANSPORT';
  constructor() {
    super('no mail transport is configured');
    this.name = 'MailUnavailableError';
  }
}

/** The mail server did not finish the send in time. */
export class MailTimeoutError extends Error {
  readonly code = 'E_MAIL_TIMEOUT';
  constructor() {
    super('the mail send timed out');
    this.name = 'MailTimeoutError';
  }
}

/** Sends one email, or throws: no transport, a refusal from the mail server, or a send that took too long. */
export async function sendVaultMail(mail: VaultMail): Promise<void> {
  // Read when called, like the other settings: the same question the shared mailer asks.
  if (!process.env.EMAIL_SERVER) throw new MailUnavailableError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError()), SEND_TIMEOUT_MS);
  });
  try {
    await Promise.race([sendMail(mail), tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}
