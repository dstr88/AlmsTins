/**
 * /api/verify/receivables/notice-optout — public, login-free (aging A4 / D8). Opts a client
 * address out of the aging-notice emails via the per-address token every client notice
 * carries. GET shows a confirmation page; POST is RFC-8058 one-click. Only these notices are
 * affected — the records themselves, and the confirmation requests a financier sends by hand,
 * are untouched. The same pattern as /api/email/unsubscribe; listed in isPublicPath because
 * the client being emailed may hold no account at all.
 */
import type { APIRoute } from 'astro';
import { suppressNoticesByToken } from '@/lib/receivablesRegistry';
import {
  OPTOUT_BAD_BODY,
  OPTOUT_BAD_TITLE,
  OPTOUT_DONE_BODY,
  OPTOUT_DONE_TITLE,
} from '@/lib/receivables/copy/notices';

export const prerender = false;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · Almstins</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0a0f1a;color:#f5f8ff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;">
<div style="max-width:440px;text-align:center;">
<div style="font-weight:700;font-size:20px;margin-bottom:14px;">Almstins Verify</div>
<p style="color:rgba(245,248,255,.72);line-height:1.65;font-size:15px;">${body}</p>
<a href="https://almstins.com" style="color:#2dd4a8;text-decoration:none;font-weight:600;">almstins.com</a>
</div></body></html>`;

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const ok = await suppressNoticesByToken(token).catch(() => false);
  return html(ok ? page(OPTOUT_DONE_TITLE, OPTOUT_DONE_BODY) : page(OPTOUT_BAD_TITLE, OPTOUT_BAD_BODY));
};

// One-click opt-out (RFC 8058) — mail clients POST here from a List-Unsubscribe header.
export const POST: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  await suppressNoticesByToken(token).catch(() => {});
  return new Response(null, { status: 204 });
};
