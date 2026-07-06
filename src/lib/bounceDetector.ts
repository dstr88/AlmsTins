// Bounce detector — finds P2P "bounces" and alerts the tenant that their crypto
// did NOT send.
//
// A bounce = a `crypto_transfer` OUT whose exact asset+amount comes back as a
// `crypto_transfer` IN within BOUNCE_WINDOW_SECONDS. Per Donnie's policy a
// round-trip within 4 seconds is a bounce (the recipient's number/account can't
// receive it, so the platform instantly returns the funds); anything slower is a
// genuine transfer and is left alone.
//
// Idempotent: each bounced send is alerted at most once, tracked in the
// lazily-created `bounce_alerts` table. Safe to call fire-and-forget after an
// import (mirrors autoClassifyOwnWalletTransfers).

import { db } from './db';
import { sendMail } from './email';
import { getBounceAlertEmail } from '@/i18n/emails/bounceAlert';
import { isLang } from '@/lib/i18n/locale';

const APP_BASE = process.env.APP_URL || 'https://almstins.com';
const BOUNCE_WINDOW_SECONDS = 4;

async function ensureBounceTable(): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS bounce_alerts (
    tenant_id     TEXT NOT NULL,
    out_source_id TEXT NOT NULL,
    alerted_at    TEXT NOT NULL DEFAULT (now()::text),
    PRIMARY KEY (tenant_id, out_source_id)
  )`);
}

type BounceRow = {
  out_id: string;
  asset_symbol: string;
  amount: number;
  native_usd: number | null;
  out_desc: string;
  out_ts: string;
};

/**
 * Detect new bounces for one tenant and email them. Returns counts.
 * `found` = new bounces this run; `alerted` = emails actually sent.
 */
export async function detectAndAlertBounces(
  tenantId: string,
): Promise<{ found: number; alerted: number }> {
  await ensureBounceTable();

  // Out-legs whose exact asset+amount returned within the bounce window,
  // and that we haven't already alerted on.
  const res = await db.execute({
    sql: `
      SELECT o.id            AS out_id,
             o.asset_symbol  AS asset_symbol,
             o.amount        AS amount,
             o.native_usd    AS native_usd,
             o.description   AS out_desc,
             o.timestamp_utc AS out_ts
      FROM import_transactions o
      WHERE o.tenant_id = ?
        AND o.kind = 'crypto_transfer'
        AND o.direction = 'out'
        AND EXISTS (
          SELECT 1 FROM import_transactions i
          WHERE i.tenant_id = o.tenant_id
            AND i.kind = 'crypto_transfer'
            AND i.direction = 'in'
            AND UPPER(i.asset_symbol) = UPPER(o.asset_symbol)
            AND ABS(ABS(i.amount) - ABS(o.amount)) <= ABS(o.amount) * 1e-6
            AND i.timestamp_utc::timestamptz >  o.timestamp_utc::timestamptz
            AND i.timestamp_utc::timestamptz <= o.timestamp_utc::timestamptz + interval '${BOUNCE_WINDOW_SECONDS} seconds'
        )
        AND NOT EXISTS (
          SELECT 1 FROM bounce_alerts ba
          WHERE ba.tenant_id = o.tenant_id AND ba.out_source_id = o.id
        )
    `,
    args: [tenantId],
  });

  const rows = (res.rows ?? []) as unknown as BounceRow[];
  if (!rows.length) return { found: 0, alerted: 0 };

  // Resolve the tenant's recipient email + language (same join the wallet-error
  // alert uses). alert_email wins over the login email.
  const uRes = await db.execute({
    sql: `SELECT au.alert_email AS alert_email, au.email AS email, au.lang AS lang
          FROM tenant_memberships tm
          JOIN auth_users au ON au.id = tm.user_id
          WHERE tm.tenant_id = ?
          ORDER BY tm.created_at ASC
          LIMIT 1`,
    args: [tenantId],
  });
  const u = uRes.rows?.[0] as
    | { alert_email?: unknown; email?: unknown; lang?: unknown }
    | undefined;
  const toEmail = String((u?.alert_email as string) ?? (u?.email as string) ?? '');
  const lang = isLang(u?.lang) ? u.lang : 'en';

  let alerted = 0;
  for (const b of rows) {
    try {
      if (toEmail) {
        const amountNum = Math.abs(Number(b.amount) || 0);
        const usdNum = Number(b.native_usd);
        const rendered = getBounceAlertEmail(lang).render({
          symbol: String(b.asset_symbol || '').toUpperCase(),
          fmtAmount: String(amountNum),
          fmtUsd: Number.isFinite(usdNum)
            ? `$${usdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : 'n/a',
          recipient: (b.out_desc || '').replace(/^To\s*/i, '').trim() || 'unknown',
          fmtDate: `${String(b.out_ts || '').slice(0, 16).replace('T', ' ')} UTC`,
          appBase: APP_BASE,
        });
        await sendMail({ to: toEmail, subject: rendered.subject, text: rendered.text });
        alerted += 1;
      }
      // Record even when there's no email on file, so we don't reprocess forever.
      await db.execute({
        sql: `INSERT INTO bounce_alerts (tenant_id, out_source_id) VALUES (?, ?)
              ON CONFLICT (tenant_id, out_source_id) DO NOTHING`,
        args: [tenantId, b.out_id],
      });
    } catch (err) {
      console.error('[bounceDetector] alert failed', { tenantId, out_id: b.out_id, err });
    }
  }
  return { found: rows.length, alerted };
}
