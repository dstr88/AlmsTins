/**
 * POST /api/verify/receivables/send — email an outstanding confirmation request.
 *
 * Body: { token }
 *
 * Sends on the financier's behalf, but honestly: the message comes FROM Almstins, because
 * we cannot and will not send as his domain. Reply-to is his own address, so a cautious
 * recipient who replies reaches a human at the firm that is asking.
 *
 * The hard part is not delivery, it is credibility. An unexpected email asking someone to
 * click a link and confirm a debt is indistinguishable in shape from a phishing attempt.
 * So the message leads with facts only a legitimate sender would have — their company, the
 * invoice number, the amount, who is asking — and tells them to check it against their own
 * records before opening anything.
 *
 * Tenant-scoped: you can only send a request you created, that is still open.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAuthSession } from '@/lib/authSession';
import { getSendableRequest, countRecentInvites } from '@/lib/receivablesRegistry';
import { sendMail } from '@/lib/email';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A working desk sends a handful a day. This only has to stop the thing being used as a
// cannon; it should never be reachable by legitimate use.
const MAX_PER_HOUR = 50;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const money = (n: number, ccy: string) =>
  `${ccy} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  if (await countRecentInvites(session.tenantId) > MAX_PER_HOUR) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const req = await getSendableRequest(session.tenantId, token);
  if (!req) return json({ ok: false, error: 'not_found' }, 404);

  if (!process.env.EMAIL_SERVER) {
    return json({ ok: false, error: 'email_not_configured' }, 503);
  }

  const auth = await getAuthSession(request);
  const from = auth?.user?.email ?? null;

  // NOT new URL(request.url).origin. Behind Render's proxy that resolves to
  // https://localhost, and every emailed link went out pointing at the recipient's own
  // machine. AUTH_URL is what the rest of the app's mail already uses.
  const origin = (process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');
  const page = req.kind === 'debtor' ? 'authenticate'
             : req.kind === 'client' ? 'countersign'
             : 'invite';
  const link = `${origin}/verify/${page}?token=${encodeURIComponent(req.token)}`;
  const expires = req.expiresAt.slice(0, 10);
  const amount = money(req.amount, req.currency);

  let subject: string;
  let lead: string;
  let ask: string;
  if (req.kind === 'invitation') {
    const who = req.label ? req.label : 'A financier';
    subject = 'You have been invited onto the Almstins receivables registry';
    lead = `${who} has invited you onto the Almstins receivables registry.`;
    ask = 'Accepting creates your own account, where you can see what you are owed and what any financier has claimed against it. Your records stay yours: whoever invited you cannot see inside your account, and you cannot see inside theirs.';
  } else if (req.kind === 'debtor') {
    subject = `Confirm invoice ${req.invoiceNo} from ${req.supplier}`;
    lead = `${req.supplier} has recorded that ${req.buyer} owes ${amount} on invoice ${req.invoiceNo}, and is using it to raise finance.`;
    ask = 'You are being asked to confirm that this debt is real and the amount is right. A lender will advance money against your answer, so please check it against your own records first. If it is wrong, or the invoice is not yours, say so on the same page.';
  } else {
    subject = `Confirm you received ${amount} against invoice ${req.invoiceNo}`;
    lead = `An advance of ${amount} has been registered against invoice ${req.invoiceNo} to ${req.buyer}.`;
    ask = 'You are being asked to confirm that this money actually reached you. Until you do, it is only the lender’s word that it was paid. If it never arrived, or the amount is different, say so on the same page.';
  }

  const replyLine = from
    ? `If you would rather check first, reply to this email and it goes to ${from}.`
    : 'If you would rather check first, reply to this email.';

  const text = [
    lead,
    '',
    ask,
    '',
    `${req.kind === 'invitation' ? 'Accept it here' : 'Open the request'}: ${link}`,
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
      ${req.kind === 'invitation' ? '' : `<table style="border-collapse:collapse;margin:0 0 1.25rem;font-size:14px">
        <tr><td style="padding:2px 14px 2px 0;color:#666">Invoice</td><td style="padding:2px 0"><b>${esc(req.invoiceNo)}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Amount</td><td style="padding:2px 0"><b>${esc(amount)}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Supplier</td><td style="padding:2px 0">${esc(req.supplier)}</td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#666">Debtor</td><td style="padding:2px 0">${esc(req.buyer)}</td></tr>
      </table>`}
      <p style="margin:0 0 1.25rem">
        <a href="${esc(link)}" style="background:#0a7f62;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:8px;font-weight:600;display:inline-block">${req.kind === 'invitation' ? 'Accept the invitation' : 'Open the request'}</a>
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
    // Return the reason, not just the fact. This endpoint is authenticated and the caller
    // is the person who has to act on the failure: a rejected recipient, a throttle, and a
    // dead transport all look identical otherwise, and diagnosing a live one by asking the
    // user to describe the message costs more than showing it to them.
    const e = err as any;
    const detail = String(e?.response ?? e?.message ?? e ?? '').split('\n')[0].slice(0, 300);
    console.error('[receivables/send] failed:', { to: req.sentTo, code: e?.code, detail });
    return json({
      ok: false,
      error: 'send_failed',
      code: e?.code ? String(e.code).slice(0, 40) : null,
      detail: detail || null,
    }, 502);
  }

  return json({ ok: true, sentTo: req.sentTo });
};
