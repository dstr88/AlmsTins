/**
 * GET /api/cron/onboarding-drip — sends the email drip campaigns (hourly).
 *
 * For each campaign (onboarding, business): enroll newly-eligible users, then send each
 * enrolled/subscribed/unfinished user the NEXT email that's due (one per user per run,
 * so a backlog catches up gently). Each campaign is isolated — one failing never blocks
 * the other. Every email carries an unsubscribe link + List-Unsubscribe header. Protected
 * by CRON_SECRET. Safe no-op if RESEND_API_KEY isn't set or nobody is due.
 */
import type { APIRoute } from 'astro';
import {
  CAMPAIGN_IDS, enrollForCampaign, getDueDrips, markStepSent, campaignLocale,
} from '@/lib/onboardingDrip';
import { renderDrip } from '@/i18n/emails/dripTemplate';
import { sendCampaignEmail, campaignEmailAvailable } from '@/lib/campaignEmail';

export const prerender = false;

const APP_BASE = process.env.APP_URL ?? 'https://almstins.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    console.warn('[cron/onboarding-drip] Unauthorized attempt');
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  if (!campaignEmailAvailable()) {
    console.warn('[cron/onboarding-drip] RESEND_API_KEY not set — nothing sent');
    return json({ ok: false, error: 'resend_not_configured' }, 200);
  }

  const campaigns: Record<string, { enrolled: number; sent: number; failed: number }> = {};

  for (const campaign of CAMPAIGN_IDS) {
    let enrolled = 0;
    let sent = 0;
    let failed = 0;
    try {
      enrolled = await enrollForCampaign(campaign);
    } catch (err) {
      console.error(`[cron/onboarding-drip] enroll ${campaign} failed`, err);
    }
    try {
      const due = await getDueDrips(campaign, 200);
      for (const d of due) {
        const unsubscribeUrl = `${APP_BASE}/api/email/unsubscribe?token=${encodeURIComponent(d.unsubToken)}`;
        const { subject, html, text } = renderDrip(
          campaignLocale(d.campaign, d.lang), d.nextStep, APP_BASE, unsubscribeUrl,
        );
        const res = await sendCampaignEmail({ to: d.email, subject, html, text, unsubscribeUrl });
        if (res.ok) {
          await markStepSent(d.campaign, d.userId, d.nextStep);
          sent++;
        } else {
          failed++;
        }
        await sleep(400); // gentle pacing — stay well under Resend rate limits
      }
    } catch (err) {
      console.error(`[cron/onboarding-drip] send ${campaign} failed`, err);
    }
    campaigns[campaign] = { enrolled, sent, failed };
  }

  const elapsed_ms = Date.now() - startedAt;
  console.log(`[cron/onboarding-drip] done in ${elapsed_ms}ms —`, campaigns);
  return json({ ok: true, elapsed_ms, campaigns });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
