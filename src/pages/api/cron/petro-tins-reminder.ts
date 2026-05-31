/**
 * GET /api/cron/petro-tins-reminder
 *
 * Runs on the 25th of every month (Render Cron job).
 *
 * For every tenant that has at least one budget tin, finds any unchecked
 * entries for the current month and sends a reminder email to their
 * alert_email (or account email) listing what still needs to be paid.
 *
 * Protected by CRON_SECRET header.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret   = import.meta.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret')
    ?? new URL(request.url).searchParams.get('secret');

  if (!secret || provided !== secret) {
    console.warn('[cron/petro-tins-reminder] Unauthorized attempt');
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  // ── Find all tenants with budget tins ─────────────────────────────────────
  let tenants: { tenantId: string }[] = [];
  try {
    const res = await db.execute({
      sql: `SELECT DISTINCT tenant_id FROM petro_tins WHERE type = 'budget'`,
      args: [],
    });
    tenants = res.rows.map((r: any) => ({ tenantId: String(r.tenant_id) }));
  } catch (err) {
    // Table may not exist yet if no one has used PetroTins
    console.warn('[cron/petro-tins-reminder] petro_tins table not found or empty:', err);
    return json({ ok: true, skipped: 'no tenants', elapsed_ms: Date.now() - startedAt });
  }

  let reminded = 0;
  let skipped  = 0;
  const results: { tenantId: string; status: string; unpaidCount?: number }[] = [];

  for (const { tenantId } of tenants) {
    try {
      // ── Find unchecked entries for this month ────────────────────────────
      const unpaidRes = await db.execute({
        sql: `
          SELECT e.description, e.amount, e.kind, e.entry_date, t.name AS tin_name
          FROM petro_tin_entries e
          JOIN petro_tins t ON t.id = e.tin_id
          WHERE e.tenant_id = ?
            AND t.type = 'budget'
            AND e.checked = 0
            AND e.entry_date LIKE ?
          ORDER BY e.entry_date ASC, e.amount DESC
        `,
        args: [tenantId, `${thisMonth}%`],
      });

      if (!unpaidRes.rows.length) {
        skipped++;
        results.push({ tenantId, status: 'all_paid' });
        continue;
      }

      const unpaid = unpaidRes.rows as any[];

      // ── Look up the tenant's alert email ────────────────────────────────
      const emailRes = await db.execute({
        sql: `
          SELECT au.alert_email, au.email
          FROM tenant_memberships tm
          JOIN auth_users au ON au.id = tm.user_id
          WHERE tm.tenant_id = ?
          LIMIT 1
        `,
        args: [tenantId],
      });

      const row = emailRes.rows[0] as any;
      const to  = row?.alert_email || row?.email;
      if (!to) {
        skipped++;
        results.push({ tenantId, status: 'no_email' });
        continue;
      }

      // ── Build email ──────────────────────────────────────────────────────
      const totalUnpaid = unpaid.reduce((sum: number, e: any) => {
        return e.kind === 'expense' ? sum + Number(e.amount) : sum;
      }, 0);

      const fmt = (n: number) =>
        n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

      const lineItems = unpaid
        .map((e: any) => {
          const label = e.description || e.tin_name || 'Unnamed';
          const sign  = e.kind === 'expense' ? '−' : '+';
          return `  • ${label}: ${sign}${fmt(Math.abs(Number(e.amount)))}`;
        })
        .join('\n');

      const subject = `⛽ PetroTins reminder — ${unpaid.length} unpaid bill${unpaid.length === 1 ? '' : 's'} this month`;

      const text = [
        `Hi,`,
        ``,
        `It's the 25th — here's what's still unchecked in your PetroTins budget for ${thisMonth}:`,
        ``,
        lineItems,
        ``,
        totalUnpaid > 0
          ? `Total still due: ${fmt(totalUnpaid)}`
          : '',
        ``,
        `Log in to check things off as you pay them:`,
        `https://almstins.com/dashboard/petro-tins`,
        ``,
        `— PetroTins`,
      ].filter(l => l !== undefined).join('\n');

      const html = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#f5f8ff;background:#0d131f;padding:2rem;border-radius:12px;">
          <p style="font-size:1.5rem;margin:0 0 0.5rem">⛽ PetroTins</p>
          <p style="color:rgba(245,248,255,0.7);margin:0 0 1.5rem">Monthly bill reminder</p>
          <p style="margin:0 0 1rem">It's the 25th — here's what's still unchecked for <strong>${thisMonth}</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem">
            ${unpaid.map((e: any) => {
              const label  = e.description || e.tin_name || 'Unnamed';
              const amount = fmt(Math.abs(Number(e.amount)));
              const color  = e.kind === 'expense' ? '#ef4444' : '#34d399';
              const sign   = e.kind === 'expense' ? '−' : '+';
              return `<tr style="border-bottom:1px solid rgba(255,255,255,0.08)">
                <td style="padding:0.5rem 0.75rem;color:#f5f8ff">${label}</td>
                <td style="padding:0.5rem 0.75rem;text-align:right;color:${color};font-weight:700">${sign}${amount}</td>
              </tr>`;
            }).join('')}
            ${totalUnpaid > 0 ? `
            <tr>
              <td style="padding:0.75rem 0.75rem 0;color:rgba(245,248,255,0.5);font-size:0.85rem">Total still due</td>
              <td style="padding:0.75rem 0.75rem 0;text-align:right;color:#ef4444;font-weight:800">${fmt(totalUnpaid)}</td>
            </tr>` : ''}
          </table>
          <a href="https://almstins.com/dashboard/petro-tins"
             style="display:inline-block;background:#f59e0b;color:#09090f;font-weight:700;padding:0.65rem 1.5rem;border-radius:8px;text-decoration:none">
            Check off paid bills →
          </a>
          <p style="margin-top:2rem;font-size:0.75rem;color:rgba(245,248,255,0.35)">
            You're receiving this because you have a PetroTins budget. To stop these reminders, remove your bills from the register.
          </p>
        </div>
      `;

      await sendMail({ to, subject, text, html });

      reminded++;
      results.push({ tenantId, status: 'sent', unpaidCount: unpaid.length });

    } catch (err) {
      console.error(`[cron/petro-tins-reminder] Error for tenant ${tenantId}:`, err);
      results.push({ tenantId, status: 'error' });
    }
  }

  const elapsed_ms = Date.now() - startedAt;
  console.log(`[cron/petro-tins-reminder] done in ${elapsed_ms}ms — reminded:${reminded} skipped:${skipped}`);

  return json({ ok: true, elapsed_ms, total: tenants.length, reminded, skipped, results });
};
