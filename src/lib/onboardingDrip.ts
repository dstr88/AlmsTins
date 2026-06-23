/**
 * onboardingDrip.ts — enrollment + scheduling for the email drip campaigns.
 *
 * One engine, multiple campaigns (keyed by `campaign` in the campaign_drip table):
 *   • onboarding — every new signup (auth_users.created_at). Anti-blast: pre-launch
 *     rows have created_at NULL → never enrolled.
 *   • business   — a user who registered their first Verify destination (a merchant).
 *     Enrolled as the tenant OWNER, anchored to when they first registered.
 *
 * A daily/hourly cron (/api/cron/onboarding-drip) enrolls + sends the next due email.
 * Global lifecycle table keyed by (campaign, user_id) — NOT tenant data, so it's
 * intentionally not tenant-scoped (the cron is a privileged maintenance job).
 */
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { isLang, type Lang } from '@/lib/i18n/locale';
import type { DripLocale } from '@/i18n/emails/dripTemplate';
import { onboardingLocales } from '@/i18n/emails/onboarding';
import { businessLocales } from '@/i18n/emails/business';

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Launch date (YYYY-MM-DD). Only events on/after this enroll a user. Bump if needed. */
export const CAMPAIGN_START_DATE = '2026-06-22';

export type Campaign = 'onboarding' | 'business';

interface CampaignDef {
  /** Day each step is due, measured from enrolled_at: step 1 now, then 2 / 5 / 10. */
  cadence: number[];
  locales: Record<Lang, DripLocale>;
}

export const CAMPAIGNS: Record<Campaign, CampaignDef> = {
  onboarding: { cadence: [0, 2, 5, 10], locales: onboardingLocales },
  business: { cadence: [0, 2, 5, 10], locales: businessLocales },
};

export const CAMPAIGN_IDS = Object.keys(CAMPAIGNS) as Campaign[];

export function campaignLocale(campaign: Campaign, lang: Lang): DripLocale {
  const c = CAMPAIGNS[campaign];
  return c.locales[lang] ?? c.locales.en;
}

const ENSURE = `
  CREATE TABLE IF NOT EXISTS campaign_drip (
    campaign     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    email        TEXT NOT NULL,
    lang         TEXT NOT NULL DEFAULT 'en',
    enrolled_at  TEXT NOT NULL,
    last_step    INTEGER NOT NULL DEFAULT 0,
    unsubscribed INTEGER NOT NULL DEFAULT 0,
    unsub_token  TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    PRIMARY KEY (campaign, user_id)
  )
`;

let ensured = false;
export async function ensureDripTable(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE, args: [] });
  ensured = true;
}

export interface DueDrip {
  campaign: Campaign;
  userId: string;
  email: string;
  lang: Lang;
  lastStep: number;
  nextStep: number;
  unsubToken: string;
}

async function insertEnrollments(
  campaign: Campaign,
  rows: any[],
  enrolledAtOf: (r: any) => string,
): Promise<number> {
  const now = nowUtc();
  let n = 0;
  for (const r of rows) {
    const lang = typeof r.lang === 'string' && isLang(r.lang) ? r.lang : 'en';
    await db.execute({
      sql: `INSERT INTO campaign_drip (campaign, user_id, email, lang, enrolled_at, last_step, unsubscribed, unsub_token, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
            ON CONFLICT (campaign, user_id) DO NOTHING`,
      args: [campaign, String(r.id), String(r.email), lang, enrolledAtOf(r), randomUUID(), now],
    });
    n++;
  }
  return n;
}

/** Onboarding: every new SIGNUP (auth_users.created_at) since launch. */
async function enrollOnboarding(): Promise<number> {
  const res = await db.execute({
    sql: `SELECT au.id, au.email, au.lang, au.created_at
          FROM auth_users au
          WHERE au.email IS NOT NULL AND au.email <> ''
            AND au.created_at IS NOT NULL
            AND substr(au.created_at, 1, 10) >= ?
            AND NOT EXISTS (SELECT 1 FROM campaign_drip d WHERE d.user_id = au.id AND d.campaign = 'onboarding')`,
    args: [CAMPAIGN_START_DATE],
  });
  return insertEnrollments('onboarding', res.rows as any[], (r) => String(r.created_at));
}

/** Business: a tenant OWNER who registered their first Verify destination, since launch. */
async function enrollBusiness(): Promise<number> {
  const res = await db.execute({
    sql: `SELECT au.id, au.email, au.lang, MIN(vd.registered_at) AS first_registered
          FROM verify_destinations vd
          JOIN tenant_memberships tm ON tm.tenant_id = vd.tenant_id AND tm.role = 'owner'
          JOIN auth_users au ON au.id = tm.user_id
          WHERE au.email IS NOT NULL AND au.email <> ''
            AND NOT EXISTS (SELECT 1 FROM campaign_drip d WHERE d.user_id = au.id AND d.campaign = 'business')
          GROUP BY au.id, au.email, au.lang
          HAVING substr(MIN(vd.registered_at), 1, 10) >= ?`,
    args: [CAMPAIGN_START_DATE],
  });
  return insertEnrollments('business', res.rows as any[], (r) => String(r.first_registered));
}

export async function enrollForCampaign(campaign: Campaign): Promise<number> {
  await ensureDripTable();
  await ensureUserLangColumn();
  if (campaign === 'onboarding') return enrollOnboarding();
  if (campaign === 'business') return enrollBusiness();
  return 0;
}

/** Enrolled + subscribed + unfinished users in a campaign whose NEXT step is now due. */
export async function getDueDrips(campaign: Campaign, limit = 200): Promise<DueDrip[]> {
  await ensureDripTable();
  const cadence = CAMPAIGNS[campaign].cadence;
  const res = await db.execute({
    sql: `SELECT user_id, email, lang, enrolled_at, last_step, unsub_token
          FROM campaign_drip
          WHERE campaign = ? AND unsubscribed = 0 AND last_step < ?
          ORDER BY enrolled_at ASC
          LIMIT ?`,
    args: [campaign, cadence.length, limit],
  });
  const nowMs = Date.now();
  const out: DueDrip[] = [];
  for (const r of res.rows as any[]) {
    const lastStep = Number(r.last_step ?? 0);
    const dueDay = cadence[lastStep];
    const enrolledMs = Date.parse(String(r.enrolled_at).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(enrolledMs)) continue;
    const daysSince = (nowMs - enrolledMs) / 86_400_000;
    if (daysSince + 1e-6 >= dueDay) {
      out.push({
        campaign,
        userId: String(r.user_id),
        email: String(r.email),
        lang: (isLang(r.lang) ? r.lang : 'en') as Lang,
        lastStep,
        nextStep: lastStep + 1,
        unsubToken: String(r.unsub_token),
      });
    }
  }
  return out;
}

/** Advance a user to `step` in a campaign (only forward). */
export async function markStepSent(campaign: Campaign, userId: string, step: number): Promise<void> {
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE campaign_drip SET last_step = ?, updated_at = ? WHERE campaign = ? AND user_id = ? AND last_step < ?`,
    args: [step, now, campaign, userId, step],
  });
}

/** Mark unsubscribed by token (campaign-agnostic — each row has its own token). */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  await ensureDripTable();
  if (!token || token.length < 8) return false;
  const found = await db.execute({
    sql: `SELECT 1 FROM campaign_drip WHERE unsub_token = ? LIMIT 1`,
    args: [token],
  });
  if (!found.rows.length) return false;
  await db.execute({
    sql: `UPDATE campaign_drip SET unsubscribed = 1, updated_at = ? WHERE unsub_token = ?`,
    args: [nowUtc(), token],
  });
  return true;
}
