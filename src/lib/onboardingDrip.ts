/**
 * onboardingDrip.ts — enrollment + scheduling for the email drip campaigns.
 *
 * One engine, multiple campaigns (keyed by `campaign` in the campaign_drip table):
 *   • onboarding — every new signup (auth_users.created_at). Anti-blast: pre-launch
 *     rows have created_at NULL → never enrolled.
 *   • business   — a user who registered their first Verify destination (a merchant).
 *     Enrolled as the tenant OWNER, anchored to when they first registered.
 *   • verify-welcome — an account that signed up through Almstins Verify
 *     (auth_users.signup_service) and has not registered a destination yet. Two emails,
 *     three days apart, anchored to the enrollment itself (the first run after the sign-up).
 *     It ends the moment the account registers a destination, and `business` takes over.
 *     These accounts are left out of `onboarding` while they have no wallet (verifyOnlyUser).
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
import { verifyWelcomeLocales } from '@/i18n/emails/verifyWelcome';
import { VERIFY_WELCOME_REPLY_TO } from '@/lib/campaignEmail';
import { ensureAccountActivityColumns } from '@/lib/accountActivity';
import type { SignupServiceId } from '@/lib/signupService';
import { ensureReceivablesTables } from '@/lib/receivablesRegistry';
import { ensureCairnTables } from '@/lib/cairnRegistry';
import { ensureAgenticsSignupsTable } from '@/lib/agenticsSignup';

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Launch date (YYYY-MM-DD). Only events on/after this enroll a user. Bump if needed. */
export const CAMPAIGN_START_DATE = '2026-06-22';

export type Campaign = 'onboarding' | 'business' | 'verify-welcome';

interface CampaignDef {
  /** Day each step is due, measured from enrolled_at: step 1 now, then 2 / 5 / 10 (or 3, for the two-email series). */
  cadence: number[];
  locales: Record<Lang, DripLocale>;
  /** The mailbox a reply to this campaign's emails goes to. Absent: the sender's default (campaignEmail.ts). */
  replyTo?: string;
}

/**
 * The cron works through these in order. `verify-welcome` comes after `business` on purpose: an
 * account that registered a destination since the last run is enrolled in `business` first, and
 * the welcome series then sees that enrollment and sends nothing.
 */
export const CAMPAIGNS: Record<Campaign, CampaignDef> = {
  onboarding: { cadence: [0, 2, 5, 10], locales: onboardingLocales },
  business: { cadence: [0, 2, 5, 10], locales: businessLocales },
  'verify-welcome': { cadence: [0, 3], locales: verifyWelcomeLocales, replyTo: VERIFY_WELCOME_REPLY_TO },
};

export const CAMPAIGN_IDS = Object.keys(CAMPAIGNS) as Campaign[];

/** The mailbox replies to a campaign's emails go to, or undefined for the sender's default. */
export function campaignReplyTo(campaign: Campaign): string | undefined {
  return CAMPAIGNS[campaign].replyTo;
}

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

/**
 * Financing-only accounts: the user owns a tenant that uses the financing desks (receivables,
 * receivable access, or milestone-desk projects) and has no wallets. The onboarding campaign is
 * about wallets and crypto taxes, which is the wrong message for them, so they are skipped at
 * enrollment and again at send time. `userCol` is a trusted column reference, never user input.
 * Every subquery is scoped by the owned tenant.
 */
const financingOnlyUser = (userCol: string) => `
  EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.user_id = ${userCol} AND tm.role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.tenant_id = tm.tenant_id)
      AND (
        EXISTS (SELECT 1 FROM receivables r WHERE r.tenant_id = tm.tenant_id)
        OR EXISTS (SELECT 1 FROM receivable_access ra WHERE ra.tenant_id = tm.tenant_id AND ra.revoked_at IS NULL)
        OR EXISTS (SELECT 1 FROM cairn_projects cp WHERE cp.tenant_id = tm.tenant_id)
      )
  )`;

/**
 * Agentics-only accounts: the user owns a tenant that came in through the Agentics door
 * (agentics_signups, src/lib/agenticsSignup.ts) and has no wallets. The onboarding campaign is about
 * wallets and crypto taxes, the wrong message for them, and the Agentics welcome letter promises one
 * more email (when the vault opens) and no newsletter. So they are skipped at enrollment and again at
 * send time, like financing-only accounts; an account that later adds a wallet is a tracker user and
 * becomes eligible. The signup row is written the first time the account opens its welcome page, which
 * follows sign-in at once, and the send-time check covers the moment in between. `userCol` is a
 * trusted column reference, never user input. Every subquery is scoped by the owned tenant.
 */
export const agenticsOnlyUser = (userCol: string): string => `
  EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.user_id = ${userCol} AND tm.role = 'owner'
      AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.tenant_id = tm.tenant_id)
      AND EXISTS (SELECT 1 FROM agentics_signups s WHERE s.tenant_id = tm.tenant_id)
  )`;

/** The product a Verify sign-up carries in auth_users.signup_service (the ids of src/lib/signupService.ts). */
const VERIFY_SIGNUP: SignupServiceId = 'verify';

/**
 * Verify-only accounts: the account signed up through Almstins Verify (auth_users.signup_service,
 * written once when it gets its first tenant, src/lib/accountActivity.ts) and owns no tenant with a
 * wallet. The onboarding campaign is about wallets and crypto taxes, the wrong message for them: they
 * get the Verify welcome series, then the business series once they register a destination. So they
 * are skipped at enrollment and again at send time, like Agentics-only accounts; one already part-way
 * through the onboarding series gets no further email from it. An account that later adds a wallet is
 * a tracker user and becomes eligible. An account with no signup_service (every account older than the
 * column) is never Verify-only: nothing is guessed for it. `userCol` is a trusted column reference,
 * never user input. The wallet subquery is scoped by the owned tenant.
 */
export const verifyOnlyUser = (userCol: string): string => `
  EXISTS (
    SELECT 1 FROM auth_users vu
    WHERE vu.id = ${userCol} AND vu.signup_service = '${VERIFY_SIGNUP}'
      AND NOT EXISTS (
        SELECT 1 FROM tenant_memberships tm
        WHERE tm.user_id = vu.id AND tm.role = 'owner'
          AND EXISTS (SELECT 1 FROM wallets w WHERE w.tenant_id = tm.tenant_id)
      )
  )`;

/**
 * Whether the account has started with Verify: it owns a tenant with a registered destination, or it
 * is already in the business series. The business series enrolls on the first destination and keeps
 * going if that destination is later removed, so the second test makes the hand-over final: once
 * `business` has an account, the welcome series never sends to it again. Applied at enrollment and
 * again at send time, so the welcome series ends the moment a destination is registered. `userCol` is
 * a trusted column reference, never user input. The destination subquery is scoped by the owned tenant.
 */
export const verifyStartedUser = (userCol: string): string => `(
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.user_id = ${userCol} AND tm.role = 'owner'
        AND EXISTS (SELECT 1 FROM verify_destinations vd WHERE vd.tenant_id = tm.tenant_id)
    )
    OR EXISTS (SELECT 1 FROM campaign_drip b WHERE b.user_id = ${userCol} AND b.campaign = 'business')
  )`;

/**
 * auth_users.signup_service is added lazily (accountActivity.ts); make sure it is there before a rule
 * reads it. A failed ensure is not final: the migration may have added the column, and if it is truly
 * missing the query that reads it throws and that campaign sends nothing this run.
 */
async function ensureSignupServiceColumn(): Promise<void> {
  await ensureAccountActivityColumns().catch(() => {});
}

/** The tables the exclusion filters read are created lazily, and so is the sign-up product column; make sure they exist before the filters run. */
async function ensureExclusionTables(): Promise<void> {
  await ensureReceivablesTables();
  await ensureCairnTables();
  await ensureAgenticsSignupsTable();
  await ensureSignupServiceColumn();
}

/**
 * Only accounts whose address is known to be real: a verified email, or a Google/GitHub
 * sign-in. An unverified password sign-up is just an address someone typed into a form, so
 * it gets no drip until it verifies (the next enrollment run picks it up then).
 */
const reachableUser = (alias: string) => `(
    (${alias}.email_verified IS NOT NULL AND ${alias}.email_verified <> '')
    OR EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = ${alias}.id)
  )`;

/** Onboarding: every new SIGNUP (auth_users.created_at) since launch, except financing-only, Agentics-only and Verify-only accounts. */
async function enrollOnboarding(): Promise<number> {
  await ensureExclusionTables();
  const res = await db.execute({
    sql: `SELECT au.id, au.email, au.lang, au.created_at
          FROM auth_users au
          WHERE au.email IS NOT NULL AND au.email <> ''
            AND au.created_at IS NOT NULL
            AND substr(au.created_at, 1, 10) >= ?
            AND NOT EXISTS (SELECT 1 FROM campaign_drip d WHERE d.user_id = au.id AND d.campaign = 'onboarding')
            AND ${reachableUser('au')}
            AND NOT ${financingOnlyUser('au.id')}
            AND NOT ${agenticsOnlyUser('au.id')}
            AND NOT ${verifyOnlyUser('au.id')}`,
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
            AND ${reachableUser('au')}
          GROUP BY au.id, au.email, au.lang
          HAVING substr(MIN(vd.registered_at), 1, 10) >= ?`,
    args: [CAMPAIGN_START_DATE],
  });
  return insertEnrollments('business', res.rows as any[], (r) => String(r.first_registered));
}

/**
 * Verify welcome: an account that signed up through Verify, since launch, and has not started with it
 * (no destination, not in the business series). Same reachability rule as the other campaigns: an
 * unverified password sign-up gets nothing until it verifies.
 *
 * Anchored to the enrollment itself, not to the sign-up. The cron runs hourly, so for a Google, GitHub
 * or confirmed sign-up that is the day it signs up, and the second email follows three days later. An
 * account that can only be written to later (it confirmed its address days after signing up, or it was
 * already there when this series first ran) would otherwise be due both emails at once and get them
 * an hour apart; anchored here, it gets the first then and the second three days after it.
 *
 * verify_destinations is the Verify registry's own table, created on its first use, as the business
 * enrollment above assumes.
 */
async function enrollVerifyWelcome(): Promise<number> {
  await ensureSignupServiceColumn();
  const res = await db.execute({
    sql: `SELECT au.id, au.email, au.lang
          FROM auth_users au
          WHERE au.email IS NOT NULL AND au.email <> ''
            AND au.created_at IS NOT NULL
            AND substr(au.created_at, 1, 10) >= ?
            AND au.signup_service = '${VERIFY_SIGNUP}'
            AND NOT EXISTS (SELECT 1 FROM campaign_drip d WHERE d.user_id = au.id AND d.campaign = 'verify-welcome')
            AND ${reachableUser('au')}
            AND NOT ${verifyStartedUser('au.id')}`,
    args: [CAMPAIGN_START_DATE],
  });
  const enrolledAt = nowUtc();
  return insertEnrollments('verify-welcome', res.rows as any[], () => enrolledAt);
}

export async function enrollForCampaign(campaign: Campaign): Promise<number> {
  await ensureDripTable();
  await ensureUserLangColumn();
  if (campaign === 'onboarding') return enrollOnboarding();
  if (campaign === 'business') return enrollBusiness();
  if (campaign === 'verify-welcome') return enrollVerifyWelcome();
  return 0;
}

/**
 * Enrolled + subscribed + unfinished users in a campaign whose NEXT step is now due, and
 * whose account still exists: a deleted account's enrollment never sends, even if its
 * campaign_drip row outlived the delete.
 * Onboarding also re-checks the financing-only, Agentics-only and Verify-only rules at send time: an
 * account enrolled at signup that has since turned out to be one of them gets no further tracker
 * emails. The Verify welcome series re-checks whether the account has started with Verify: once it
 * registers a destination, nothing more is sent from this series. If a check errors, the whole call
 * throws and the cron sends nothing this run (no email beats a wrong one).
 */
export async function getDueDrips(campaign: Campaign, limit = 200): Promise<DueDrip[]> {
  await ensureDripTable();
  const cadence = CAMPAIGNS[campaign].cadence;
  const skipFinancingOnly = campaign === 'onboarding';
  if (skipFinancingOnly) await ensureExclusionTables();
  const stopOnceVerifyStarted = campaign === 'verify-welcome';
  const res = await db.execute({
    sql: `SELECT user_id, email, lang, enrolled_at, last_step, unsub_token
          FROM campaign_drip
          WHERE campaign = ? AND unsubscribed = 0 AND last_step < ?
            AND EXISTS (SELECT 1 FROM auth_users au WHERE au.id = campaign_drip.user_id)
            ${skipFinancingOnly ? `AND NOT ${financingOnlyUser('campaign_drip.user_id')} AND NOT ${agenticsOnlyUser('campaign_drip.user_id')} AND NOT ${verifyOnlyUser('campaign_drip.user_id')}` : ''}
            ${stopOnceVerifyStarted ? `AND NOT ${verifyStartedUser('campaign_drip.user_id')}` : ''}
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
