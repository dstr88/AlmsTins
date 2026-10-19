/**
 * Agentics signups: the record that an account came in through the Agentics door, and the
 * welcome letter that goes to it exactly once.
 *
 * Nothing here creates a tenant. A tenant exists when someone signs in for the first time
 * (ensureTenantForUser in ./tenants.ts, called by the sign-in flow), and the Agentics sign-in
 * (/agentics/login) goes through that same door. This table only remembers, per tenant, where the
 * account came from (`source`, a short label such as the campaign it followed) and whether the
 * letter was sent. It is also the list of people to write to once when the vault opens.
 *
 * The letter is sent at most once per account, by an atomic claim: the UPDATE that sets
 * `claimed_at` only matches a row that has neither a claim nor a send, so two requests at once
 * cannot both send it. A claim that was never finished (the process died mid-send) is taken over
 * after CLAIM_STALE_MS, and a send that fails releases its claim so the next visit tries again.
 *
 * The same table is the list for the one email the privacy policy promises "when the vault opens":
 * `opened_notified_at` says an account has been told (by the opening email, or by a welcome letter
 * sent after the vault was already open, which says so itself), and `open_claimed_at` is the same
 * once-only claim the welcome letter uses. sendOpeningNotices sends it, only when asked by an admin,
 * only after the vault is open, and a dry run sends nothing.
 *
 * Tenant isolation is the same rule as everywhere: every statement names tenant_id. Schema is
 * created lazily by ensureAgenticsSignupsTable and mirrored in
 * migrations-pg/0060_agentics_signups.sql (tests/agentics/doorSignup.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';
import { sendMail as realSendMail } from '@/lib/email';
import { sendVaultMail } from '@/lib/agentVault/mailer';
import { renderAgenticsOpening, renderAgenticsWelcomeFor } from '@/i18n/emails/agenticsWelcome';
import { AGENTICS_VAULT_PUBLIC } from '@/lib/agenticsAccess';
import { cleanSource, DEFAULT_SOURCE } from '@/lib/agenticsSource';
import { isOwner, OWNER_TENANT_ID } from '@/lib/owner';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The columns added after the table first shipped (migration 0061), with their types. */
const ADDED_COLUMNS: Readonly<Record<string, string>> = { open_claimed_at: 'TEXT', opened_notified_at: 'TEXT' };

/** The table, in creation order. The migration file holds the same statements. */
export const AGENTICS_SIGNUPS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agentics_signups (
    tenant_id   TEXT NOT NULL PRIMARY KEY,
    source      TEXT NOT NULL DEFAULT 'direct',
    created_at  TEXT NOT NULL ${TS_DEFAULT},
    claimed_at  TEXT,
    welcomed_at TEXT
  )`,
  ...Object.entries(ADDED_COLUMNS).map(([name, type]) => `ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS ${name} ${type}`),
];

let ensurePromise: Promise<void> | null = null;

/**
 * Creates the table if it is missing and adds the columns it does not have yet. Runs once per process; a
 * failed run is retried by the next call. It looks before it alters: ALTER TABLE takes an exclusive lock
 * even when the column is already there, and this runs on the first request of every process, so a
 * transaction holding a row (an account being deleted) would queue every statement behind the ALTER. When
 * a column is missing it is added under a 2 second lock timeout, so a busy table makes this attempt fail
 * and retry later instead of holding up the page (the same rule as src/lib/sessionGate.ts).
 */
export function ensureAgenticsSignupsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      await db.execute({ sql: AGENTICS_SIGNUPS_DDL[0], args: [] });
      const names = Object.keys(ADDED_COLUMNS);
      const present = await db.execute({
        sql: `SELECT column_name FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'agentics_signups'
                AND column_name IN (${names.map((n) => `'${n}'`).join(', ')})`,
        args: [],
      });
      const have = new Set((present.rows as Array<Record<string, unknown>>).map((r) => String(r.column_name)));
      const missing = names.filter((n) => !have.has(n));
      if (!missing.length) return;
      await db.batch(
        [
          { sql: "SET LOCAL lock_timeout = '2s'", args: [] },
          ...missing.map((n) => ({ sql: `ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS ${n} ${ADDED_COLUMNS[n]}`, args: [] })),
        ],
        'write',
      );
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** A claim older than this with no send is treated as abandoned. */
export const CLAIM_STALE_MS = 15 * 60_000;
export { DEFAULT_SOURCE, cleanSource };

/** UTC time as the other tables store it: YYYY-MM-DD HH:MM:SS. */
const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Records the signup if this tenant has none yet. True when this call made the row. `vaultOpen` is for a
 * signup made once the vault is already open: that account is marked told, because the opening email
 * ("you signed up before the vault opened") is not true of it and must never reach it.
 */
export async function registerSignup(tenantId: string, source: string, vaultOpen = false, now: Date = new Date()): Promise<boolean> {
  await ensureAgenticsSignupsTable();
  const r = await db.execute(
    vaultOpen
      ? {
          sql: `INSERT INTO agentics_signups (tenant_id, source, opened_notified_at) VALUES (?, ?, ?) ON CONFLICT (tenant_id) DO NOTHING`,
          args: [tenantId, cleanSource(source), stamp(now)],
        }
      : {
          sql: `INSERT INTO agentics_signups (tenant_id, source) VALUES (?, ?) ON CONFLICT (tenant_id) DO NOTHING`,
          args: [tenantId, cleanSource(source)],
        },
  );
  return (r.rowsAffected ?? 0) > 0;
}

/** Takes the right to send the letter. True for exactly one caller until the letter is sent or the claim is released. */
export async function claimWelcome(tenantId: string, now: Date = new Date()): Promise<boolean> {
  await ensureAgenticsSignupsTable();
  const r = await db.execute({
    sql: `UPDATE agentics_signups SET claimed_at = ? WHERE tenant_id = ? AND welcomed_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)`,
    args: [stamp(now), tenantId, stamp(new Date(now.getTime() - CLAIM_STALE_MS))],
  });
  return (r.rowsAffected ?? 0) > 0;
}

/**
 * Records that the letter went out. `alsoOpened` is for a letter sent once the vault is open, which tells the
 * account so: it then needs no opening email.
 */
export async function markWelcomed(tenantId: string, now: Date = new Date(), alsoOpened = false): Promise<void> {
  await ensureAgenticsSignupsTable();
  await db.execute(
    alsoOpened
      ? { sql: `UPDATE agentics_signups SET welcomed_at = ?, opened_notified_at = ? WHERE tenant_id = ?`, args: [stamp(now), stamp(now), tenantId] }
      : { sql: `UPDATE agentics_signups SET welcomed_at = ? WHERE tenant_id = ?`, args: [stamp(now), tenantId] },
  );
}

/** Gives the claim back after a failed send, so the next visit tries again. Does nothing once the letter is sent. */
export async function releaseWelcome(tenantId: string): Promise<void> {
  await ensureAgenticsSignupsTable();
  await db.execute({
    sql: `UPDATE agentics_signups SET claimed_at = NULL WHERE tenant_id = ? AND welcomed_at IS NULL`,
    args: [tenantId],
  });
}

export type WelcomeOutcome = 'sent' | 'already' | 'no_email' | 'failed';

export interface WelcomeDeps {
  send: typeof realSendMail;
  now: () => Date;
  /** The site's address with no trailing slash. */
  appUrl: string;
  /** Where a reply goes: a person reads it. */
  replyTo: string;
  /** Whether the vault is open to every account: the letter says which. */
  vaultOpen: boolean;
}

/** The site's address for links in the letter: AUTH_URL when it is set (with https:// added if it has no scheme), else almstins.com. No trailing slash. */
export function siteUrl(env: string | undefined = process.env.AUTH_URL): string {
  const raw = (env ?? '').trim();
  if (!raw) return 'https://almstins.com';
  return (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
}

const defaultDeps = (): WelcomeDeps => ({
  send: realSendMail,
  now: () => new Date(),
  appUrl: siteUrl(),
  replyTo: 'support@almstins.com',
  vaultOpen: AGENTICS_VAULT_PUBLIC,
});

/**
 * Called when a signed-in account opens the Agentics door. Records the signup (once) and sends
 * the letter (once). Never throws: the page renders whatever happens here, and a failure is
 * logged by name and code only (an error message can carry the address it was given).
 *
 *   sent      the letter went out on this call
 *   already   a letter was sent before, or another request holds the claim
 *   no_email  the account has no email address to write to (the signup is still recorded)
 *   failed    the database or the mail server failed; a failed send releases its claim
 */
export async function welcomeOnFirstVisit(
  input: { tenantId: string; email: string | null | undefined; source?: unknown },
  deps: WelcomeDeps = defaultDeps(),
): Promise<WelcomeOutcome> {
  const email = typeof input.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(input.email.trim()) ? input.email.trim() : null;
  let claimed = false;
  try {
    await registerSignup(input.tenantId, cleanSource(input.source), deps.vaultOpen, deps.now());
    if (!email) return 'no_email';
    claimed = await claimWelcome(input.tenantId, deps.now());
    if (!claimed) return 'already';
    const letter = renderAgenticsWelcomeFor(deps.appUrl.replace(/\/+$/, ''), deps.vaultOpen);
    await deps.send({ to: email, subject: letter.subject, text: letter.text, html: letter.html, replyTo: deps.replyTo });
    await markWelcomed(input.tenantId, deps.now(), deps.vaultOpen);
    return 'sent';
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[agentics] welcome letter not sent', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
    if (claimed) {
      try {
        await releaseWelcome(input.tenantId);
      } catch {
        // The claim goes stale on its own after CLAIM_STALE_MS.
      }
    }
    return 'failed';
  }
}

// ── The opening email ────────────────────────────────────────────────────────

/** The most one admin call sends, and what it sends when it is not told. A few seconds each, and the call has a time budget. */
export const OPENING_BATCH_MAX = 200;
export const OPENING_BATCH_DEFAULT = 100;

/** The accounts still to be told the vault is open: signed up, not yet told, and not the deployment owner's. */
export async function countOpeningWaiting(): Promise<number> {
  await ensureAgenticsSignupsTable();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM agentics_signups WHERE opened_notified_at IS NULL AND tenant_id <> ?`,
    args: [OWNER_TENANT_ID],
  });
  return Number((r.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
}

/** Takes the right to send one account its opening email. True for exactly one caller until it is sent or released. */
export async function claimOpening(tenantId: string, now: Date = new Date()): Promise<boolean> {
  await ensureAgenticsSignupsTable();
  const r = await db.execute({
    sql: `UPDATE agentics_signups SET open_claimed_at = ? WHERE tenant_id = ? AND opened_notified_at IS NULL AND (open_claimed_at IS NULL OR open_claimed_at < ?)`,
    args: [stamp(now), tenantId, stamp(new Date(now.getTime() - CLAIM_STALE_MS))],
  });
  return (r.rowsAffected ?? 0) > 0;
}

export async function markOpened(tenantId: string, now: Date = new Date()): Promise<void> {
  await ensureAgenticsSignupsTable();
  await db.execute({ sql: `UPDATE agentics_signups SET opened_notified_at = ? WHERE tenant_id = ?`, args: [stamp(now), tenantId] });
}

/** Marks an account told after its mail went out: three tries, a short wait between them. Never throws. */
async function markOpenedWithRetries(tenantId: string, now: () => Date): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await markOpened(tenantId, now());
      return;
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown } | null;
      console.error('[agentics] opening email sent but not marked', { attempt, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

/**
 * Gives the claim back after a failed send, so the next call tries again. Does nothing once the email is
 * sent. Given the time the claim was taken (`claimedAt`, the one passed to claimOpening), it releases only
 * that claim: a call that was slow must not release the claim a later call took over from it.
 */
export async function releaseOpening(tenantId: string, claimedAt?: Date): Promise<void> {
  await ensureAgenticsSignupsTable();
  await db.execute(
    claimedAt
      ? { sql: `UPDATE agentics_signups SET open_claimed_at = NULL WHERE tenant_id = ? AND opened_notified_at IS NULL AND open_claimed_at = ?`, args: [tenantId, stamp(claimedAt)] }
      : { sql: `UPDATE agentics_signups SET open_claimed_at = NULL WHERE tenant_id = ? AND opened_notified_at IS NULL`, args: [tenantId] },
  );
}

/** The address of the account's first sign-in, or null when it has none that looks like one. */
export async function emailOfTenant(tenantId: string): Promise<string | null> {
  const m = await db.execute({
    sql: `SELECT user_id FROM tenant_memberships WHERE tenant_id = ? ORDER BY created_at ASC, id ASC LIMIT 1`,
    args: [tenantId],
  });
  const userId = (m.rows[0] as { user_id?: unknown } | undefined)?.user_id;
  if (!userId) return null;
  const u = await db.execute({ sql: `SELECT email FROM auth_users WHERE id = ? LIMIT 1`, args: [String(userId)] });
  const email = String((u.rows[0] as { email?: unknown } | undefined)?.email ?? '').trim();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/** What the opening email hands to a sender. */
export interface OpeningMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
}

/** One opening send gets this long. The admin call has OPENING_CALL_BUDGET_MS in all and the host cuts a request at 30 seconds. */
export const OPENING_SEND_TIMEOUT_MS = 8_000;

export interface OpeningDeps {
  send: (mail: OpeningMail) => Promise<void>;
  now: () => Date;
  appUrl: string;
  replyTo: string;
  emailOf: (tenantId: string) => Promise<string | null>;
}

export const defaultOpeningDeps = (): OpeningDeps => ({
  // Not the shared mailer: it returns quietly when no mail transport is set up, and this job would then
  // mark every account told for a mail that never went. This one throws, and gives a send a short time.
  send: (mail) => sendVaultMail(mail, { timeoutMs: OPENING_SEND_TIMEOUT_MS }),
  now: () => new Date(),
  appUrl: siteUrl(),
  replyTo: 'support@almstins.com',
  emailOf: emailOfTenant,
});

export interface OpeningReport {
  dryRun: boolean;
  /** Accounts still to be told, before this call. */
  waiting: number;
  sent: number;
  /** Sends that failed. Their claim is released: the next call tries them again. */
  failed: number;
  /** Sends that ran out of time. The mail may still arrive, so the claim is kept: they are tried again after CLAIM_STALE_MS, not at once. */
  timedOut: number;
  /** Accounts with no address to write to. They are marked told, so they do not wait forever. */
  noEmail: number;
  /** Accounts still to be told, after this call. */
  remaining: number;
}

/**
 * Sends the opening email to accounts that signed up while the vault was private, once each.
 *
 * A dry run (`apply: false`) counts and sends nothing. A real run takes at most `limit` accounts,
 * oldest signup first, and stops starting new sends at `deadlineAt`; calling it again carries on. Each
 * account is claimed before its email goes out (claimOpening), so two calls at once cannot send it
 * twice, and a send that fails gives its claim back. Never throws for one account's failure; the
 * caller (an admin) sees the counts. The deployment owner's account is never written to.
 *
 * Whether the vault is open is the caller's to check before this runs: the email says it is.
 */
export async function sendOpeningNotices(
  opts: { apply: boolean; limit?: number; deadlineAt?: number },
  deps: OpeningDeps = defaultOpeningDeps(),
): Promise<OpeningReport> {
  const waiting = await countOpeningWaiting();
  if (!opts.apply) return { dryRun: true, waiting, sent: 0, failed: 0, timedOut: 0, noEmail: 0, remaining: waiting };

  const limit = Math.max(1, Math.min(OPENING_BATCH_MAX, Math.floor(opts.limit ?? OPENING_BATCH_DEFAULT) || OPENING_BATCH_DEFAULT));
  const stale = stamp(new Date(deps.now().getTime() - CLAIM_STALE_MS));
  const rows = await db.execute({
    sql: `SELECT tenant_id FROM agentics_signups
          WHERE opened_notified_at IS NULL AND tenant_id <> ? AND (open_claimed_at IS NULL OR open_claimed_at < ?)
          ORDER BY created_at ASC, tenant_id ASC LIMIT ?`,
    args: [OWNER_TENANT_ID, stale, limit],
  });

  const letter = renderAgenticsOpening(deps.appUrl.replace(/\/+$/, ''));
  let sent = 0;
  let failed = 0;
  let timedOut = 0;
  let noEmail = 0;
  for (const row of rows.rows as Array<{ tenant_id?: unknown }>) {
    if (opts.deadlineAt !== undefined && deps.now().getTime() >= opts.deadlineAt) break;
    const tenantId = String(row.tenant_id ?? '');
    if (!tenantId || isOwner(tenantId)) continue; // the owner's id is matched in the query; this is for a spelling of it that is not
    let claimedAt: Date | null = null;
    try {
      const at = deps.now();
      if (!(await claimOpening(tenantId, at))) continue;
      claimedAt = at;
      const email = await deps.emailOf(tenantId);
      if (!email) {
        await markOpened(tenantId, deps.now());
        noEmail += 1;
        continue;
      }
      await deps.send({ to: email, subject: letter.subject, text: letter.text, html: letter.html, replyTo: deps.replyTo });
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown } | null;
      console.error('[agentics] opening email not sent', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
      if (e?.code === 'E_MAIL_TIMEOUT') {
        // Whether the mail went is not known, and it may still arrive. The claim stays, so it is not sent a second time at once.
        timedOut += 1;
      } else {
        failed += 1;
        if (claimedAt) await releaseOpening(tenantId, claimedAt).catch(() => undefined);
      }
      continue;
    }
    // The mail went out. Marking it told is tried a few times; if that still fails the claim stays (it is not
    // released), so the account is not mailed again at once, and the failure is logged by name and code only.
    sent += 1;
    await markOpenedWithRetries(tenantId, deps.now);
  }
  return { dryRun: false, waiting, sent, failed, timedOut, noEmail, remaining: await countOpeningWaiting() };
}
