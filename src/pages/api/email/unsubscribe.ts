/**
 * /api/email/unsubscribe — public, login-free. Opts a recipient out of the onboarding
 * drip via their per-user token. GET shows a confirmation page; POST is RFC-8058 one-click
 * (the List-Unsubscribe-Post header on every drip email). Only affects marketing email —
 * account/security/transactional mail is unaffected.
 */
import type { APIRoute } from 'astro';
import { unsubscribeByToken } from '@/lib/onboardingDrip';

export const prerender = false;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · Almstins</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0a0f1a;color:#f5f8ff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;">
<div style="max-width:440px;text-align:center;">
<div style="font-weight:700;font-size:20px;margin-bottom:14px;">Almstins</div>
<p style="color:rgba(245,248,255,.72);line-height:1.65;font-size:15px;">${body}</p>
<a href="https://almstins.com" style="color:#2dd4a8;text-decoration:none;font-weight:600;">almstins.com</a>
</div></body></html>`;

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const ok = await unsubscribeByToken(token).catch(() => false);
  return html(
    ok
      ? page('Unsubscribed', 'You’re unsubscribed from the Almstins welcome emails. You’ll still receive important account and security notices.')
      : page('Link not recognized', 'That unsubscribe link looks invalid or has already been used. If you keep getting these emails, just reply to one and we’ll take care of it.'),
  );
};

// One-click unsubscribe (RFC 8058) — mail clients POST here from the List-Unsubscribe header.
export const POST: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  await unsubscribeByToken(token).catch(() => {});
  return new Response(null, { status: 204 });
};
