/**
 * SD1 — who a Verify alert (a lapse or a swap) reaches for a tenant.
 *
 * Signup never sets `alert_email`, so before this, a fresh account had no address on
 * record at all: the watchman's getOwner() found nothing and sent nothing, and the
 * merchant would only learn their Verified badge had lapsed by noticing it themselves.
 *
 * Falls back to the member's own sign-in email (`auth_users.email`, NOT NULL for every
 * real account) when `alert_email` is unset. Prefers the tenant's owner-role member when
 * there is more than one, then the earliest-added member, so the choice is stable across
 * runs — a tenant's alerts don't jump between members' inboxes from one cron run to the
 * next just because SQL didn't return rows in a fixed order.
 */
import { db } from './db';
import { isLang, type Lang } from './i18n/locale';

export interface AlertRecipient {
  email: string | null;
  lang: Lang;
}

export async function resolveAlertRecipient(tenantId: string): Promise<AlertRecipient> {
  try {
    const res = await db.execute({
      sql: `SELECT COALESCE(au.alert_email, au.email) AS email, au.lang
            FROM tenant_memberships tm
            JOIN auth_users au ON au.id = tm.user_id
            WHERE tm.tenant_id = ?
            ORDER BY (tm.role = 'owner') DESC, tm.created_at ASC
            LIMIT 1`,
      args: [tenantId],
    });
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return { email: null, lang: 'en' };
    const email = typeof row.email === 'string' && row.email ? row.email : null;
    const lang = typeof row.lang === 'string' && isLang(row.lang) ? row.lang : 'en';
    return { email, lang };
  } catch {
    // Non-fatal — no resolved email just means no alert this run.
    return { email: null, lang: 'en' };
  }
}
