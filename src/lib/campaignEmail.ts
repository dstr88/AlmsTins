/**
 * campaignEmail.ts — Resend sender for marketing/lifecycle email (the onboarding drip).
 *
 * Separate from src/lib/email.ts (nodemailer, used for transactional alerts) — campaign
 * mail goes through Resend's HTTP API with RESEND_API_KEY. Sending domain almstins.com is
 * verified in Resend, so any @almstins.com From address works. No npm dep — just fetch.
 *
 * Adjust FROM / REPLY_TO below if you want a different sender identity.
 */
const RESEND_API_KEY = (import.meta.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY ?? '') as string;

/** Founder-personal sender — onboarding drips read better from a person than "no-reply". */
const CAMPAIGN_FROM = 'Donnie at Almstins <donnie@almstins.com>';
/** Replies land in the owner's real inbox. */
const CAMPAIGN_REPLY_TO = 'donnie@titaniumhut.com';
/**
 * Replies to the Verify welcome series go to the founder's Almstins mailbox: its first email asks
 * a question and says the answer comes to him (src/i18n/emails/verifyWelcome.ts). The campaign
 * names it in src/lib/onboardingDrip.ts; the other campaigns keep the default above.
 */
export const VERIFY_WELCOME_REPLY_TO = 'donnie@almstins.com';

export function campaignEmailAvailable(): boolean {
  return RESEND_API_KEY.length > 0;
}

export type CampaignSendResult = { ok: true; id?: string } | { ok: false; error: string };

export async function sendCampaignEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Absolute unsubscribe URL — added as a List-Unsubscribe header (one-click) too. */
  unsubscribeUrl?: string;
  /** Where a reply goes, when the campaign names its own mailbox; the default above otherwise. */
  replyTo?: string;
}): Promise<CampaignSendResult> {
  if (!RESEND_API_KEY) {
    console.warn('[campaign] RESEND_API_KEY not set — skipping send');
    return { ok: false, error: 'no_api_key' };
  }

  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: CAMPAIGN_FROM,
        to: opts.to,
        reply_to: opts.replyTo || CAMPAIGN_REPLY_TO,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[campaign] Resend error', res.status, body.slice(0, 200));
      return { ok: false, error: `http_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[campaign] send failed', err instanceof Error ? err.message : err);
    return { ok: false, error: 'exception' };
  }
}
