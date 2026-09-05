/**
 * email.ts
 *
 * Thin wrapper around nodemailer using the same EMAIL_SERVER / EMAIL_FROM
 * env vars that Auth.js magic-link uses.  Fire-and-forget where possible.
 */

import nodemailer from 'nodemailer';

const EMAIL_SERVER = process.env.EMAIL_SERVER ?? '';
const EMAIL_FROM   = process.env.EMAIL_FROM   ?? 'Almstins <no-reply@almstins.com>';

let _transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport(EMAIL_SERVER as any);
  }
  return _transport;
}

export async function sendMail({
  to,
  subject,
  text,
  html,
  replyTo,
}: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Where a reply goes. Mail sent on a user's behalf should reach the user, not no-reply. */
  replyTo?: string | null;
}): Promise<void> {
  if (!EMAIL_SERVER) {
    console.warn('[email] EMAIL_SERVER not set — skipping send');
    return;
  }
  const transport = getTransport();
  await transport.sendMail({
    from: EMAIL_FROM,
    to: Array.isArray(to) ? to.join(', ') : to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html: html ?? text.replace(/\n/g, '<br>'),
  });
}
