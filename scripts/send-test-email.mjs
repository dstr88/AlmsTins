/**
 * One-off nodemailer smoke test.
 *
 * Sends a single email using the same EMAIL_SERVER / EMAIL_FROM env vars the app
 * uses, to verify the nodemailer 9 upgrade sends cleanly against real SMTP.
 *
 * Run where the SMTP env is present (Render shell, or locally with the vars set):
 *   EMAIL_SERVER='smtp://user:pass@host:587' EMAIL_FROM='Almstins <no-reply@almstins.com>' \
 *   node scripts/send-test-email.mjs titaniumhut@gmail.com
 */
import nodemailer from 'nodemailer';

const to = process.argv[2] || 'titaniumhut@gmail.com';
const EMAIL_SERVER = process.env.EMAIL_SERVER ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Almstins <no-reply@almstins.com>';

if (!EMAIL_SERVER) {
  console.error('EMAIL_SERVER is not set — cannot send.');
  process.exit(1);
}

const transport = nodemailer.createTransport(EMAIL_SERVER);
const stamp = new Date().toISOString();

try {
  const info = await transport.sendMail({
    from: EMAIL_FROM,
    to,
    subject: `Almstins nodemailer 9 test — ${stamp}`,
    text: `This is a test send from nodemailer ${nodemailer.version}. If you received it, the upgrade works. Sent ${stamp}.`,
    html: `<p>This is a test send from <strong>nodemailer ${nodemailer.version}</strong>.</p><p>If you received it, the upgrade works.</p><p>Sent ${stamp}.</p>`,
  });
  console.log('Sent OK. messageId=', info.messageId, 'accepted=', info.accepted, 'response=', info.response);
} catch (err) {
  console.error('Send FAILED:', err);
  process.exit(1);
}
