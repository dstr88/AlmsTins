/**
 * POST /api/verify/cairn/send — email an outstanding inspector request.
 *
 * Body: { token }
 *
 * Same posture as receivables/send: the message comes FROM Almstins (we cannot and will
 * not send as the lender's domain), reply-to is the lender's own address, and the body
 * leads with facts only a legitimate sender would have — the project, the milestone, who
 * is asking — so a cautious inspector can check before clicking anything.
 *
 * Tenant-scoped: you can only send a request you created, that is still open.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAuthSession } from '@/lib/authSession';
import { getSendableCairnRequest, countRecentCairnInvites } from '@/lib/cairnRegistry';
import { sendMail } from '@/lib/email';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A working desk sends a handful a day; this only stops the thing being used as a cannon.
const MAX_PER_HOUR = 50;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  if (await countRecentCairnInvites(session.tenantId) > MAX_PER_HOUR) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const req = await getSendableCairnRequest(session.tenantId, token);
  if (!req) return json({ ok: false, error: 'not_found' }, 404);

  if (!process.env.EMAIL_SERVER) {
    return json({ ok: false, error: 'email_not_configured' }, 503);
  }

  const auth = await getAuthSession(request);
  const from = auth?.user?.email ?? null;

  // NOT new URL(request.url).origin — behind Render's proxy that is https://localhost.
  const origin = (process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');
  const link = `${origin}/verify/cairn-attest?token=${encodeURIComponent(req.token)}`;
  const expires = req.expiresAt.slice(0, 10);

  const subject = `Attest a project milestone: ${req.milestoneTitle}`;
  const lead = `You have been asked, as an independent inspector, to attest whether a stage of "${req.projectName}" has been reached: milestone ${req.seq}, ${req.milestoneTitle}.`;
  const ask = 'A lender releases money against this stage only once someone independent puts their name to it. Answer from your own inspection of the work, not from anyone’s report. If the stage is not reached, or something is wrong, record that instead: a true "not yet" is worth more than a hopeful "done".';

  const replyLine = from
    ? `If you would rather check first, reply to this email and it goes to ${from}.`
    : 'If you would rather check first, reply to this email.';

  const text = [
    lead,
    '',
    ask,
    '',
    `Open the request: ${link}`,
    `The link works once and expires on ${expires}. You do not need an account.`,
    '',
    replyLine,
    '',
    'Almstins Verify records and proves. It never holds or moves money, and it never says who anyone is.',
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#111;max-width:34rem">
      <p style="margin:0 0 1rem">${esc(lead)}</p>
      <p style="margin:0 0 1rem">${esc(ask)}</p>
      <table style="border-collapse:collapse;margin:0 0 1.25rem;font-size:14px">
        <tr><td style="padding:2px 14px 2px 0;color:#666">Project</td><td style="padding:2px 0"><b>${esc(req.projectName)}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Contractor</td><td style="padding:2px 0">${esc(req.counterparty)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Milestone</td><td style="padding:2px 0"><b>${esc(String(req.seq))}. ${esc(req.milestoneTitle)}</b></td></tr>
        ${req.targetDate ? `<tr><td style="padding:2px 14px 2px 0;color:#666">Target date</td><td style="padding:2px 0">${esc(req.targetDate)}</td></tr>` : ''}
      </table>
      <p style="margin:0 0 1.25rem">
        <a href="${esc(link)}" style="background:#0a7f62;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:8px;font-weight:600;display:inline-block">Open the request</a>
      </p>
      <p style="margin:0 0 1rem;font-size:13px;color:#555">
        The link works once and expires on ${esc(expires)}. You do not need an account.<br>${esc(replyLine)}
      </p>
      <p style="margin:0;font-size:12px;color:#888">
        Almstins Verify records and proves. It never holds or moves money, and it never says who anyone is.
      </p>
    </div>`;

  try {
    await sendMail({ to: req.sentTo, subject, text, html, replyTo: from });
  } catch (err) {
    const e = err as any;
    const detail = String(e?.response ?? e?.message ?? e ?? '').split('\n')[0].slice(0, 300);
    console.error('[cairn/send] failed:', { to: req.sentTo, code: e?.code, detail });
    return json({
      ok: false,
      error: 'send_failed',
      code: e?.code ? String(e.code).slice(0, 40) : null,
      detail: detail || null,
    }, 502);
  }

  return json({ ok: true, sentTo: req.sentTo });
};
