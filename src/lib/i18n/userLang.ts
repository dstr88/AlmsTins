// Stored per-user language preference (Phase 2 i18n).
//
// The dashboard resolves language from the `almstins-lang` cookie, but emails sent
// outside a request (cron digests, price/health alerts, promo expiry, Stripe webhook
// receipts) have no cookie. They read this stored value instead. It is persisted when
// the user switches language (POST /api/account/lang) and on signup.
//
// The column is added lazily here too (idempotent ALTER) so this works whether or not
// `migrations/20260616_user_lang.sql` has been applied — reads default to 'en' and
// writes are best-effort, so a missing column never breaks an email or a signup.

import { db } from '@/lib/db';
import { type Lang, DEFAULT_LANG, isLang } from './locale';

let _ensured: Promise<void> | null = null;

/** Lazily add auth_users.lang (idempotent; memoized per process). */
export function ensureUserLangColumn(): Promise<void> {
  if (!_ensured) {
    _ensured = db
      .execute({ sql: "ALTER TABLE auth_users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'" })
      .then(() => undefined)
      .catch((err: unknown) => {
        const msg = String((err as { message?: string })?.message ?? err);
        // "duplicate column name" => already present (migration or prior run). Swallow
        // everything else too: reads fall back to 'en', writes are best-effort.
        if (!/duplicate column/i.test(msg)) {
          console.warn('[userLang] ensure column:', msg);
        }
      });
  }
  return _ensured;
}

/** Stored language for a user (for emails sent outside a request). Defaults to English. */
export async function getUserLang(userId: string): Promise<Lang> {
  try {
    await ensureUserLangColumn();
    const res = await db.execute({
      sql: 'SELECT lang FROM auth_users WHERE id = ? LIMIT 1',
      args: [userId],
    });
    const raw = res.rows[0]?.lang;
    return typeof raw === 'string' && isLang(raw) ? raw : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Stored language for a tenant (its owner, falling back to any member). For
 * tenant-scoped emails (Stripe receipts, promo expiry, error alerts) that have a
 * tenant_id but no single user id. Defaults to English.
 */
export async function getTenantLang(tenantId: string): Promise<Lang> {
  try {
    await ensureUserLangColumn();
    const res = await db.execute({
      sql: `SELECT au.lang
              FROM tenant_memberships tm
              JOIN auth_users au ON au.id = tm.user_id
             WHERE tm.tenant_id = ?
             ORDER BY (tm.role = 'owner') DESC
             LIMIT 1`,
      args: [tenantId],
    });
    const raw = res.rows[0]?.lang;
    return typeof raw === 'string' && isLang(raw) ? raw : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/** Persist a user's language preference. Best-effort — never throws. */
export async function setUserLang(userId: string, lang: Lang): Promise<void> {
  try {
    await ensureUserLangColumn();
    await db.execute({
      sql: 'UPDATE auth_users SET lang = ? WHERE id = ?',
      args: [lang, userId],
    });
  } catch (err) {
    console.warn('[userLang] setUserLang failed:', String((err as { message?: string })?.message ?? err));
  }
}
