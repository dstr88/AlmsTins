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
 * Tenant isolation is the same rule as everywhere: every statement names tenant_id. Schema is
 * created lazily by ensureAgenticsSignupsTable and mirrored in
 * migrations-pg/0060_agentics_signups.sql (tests/agentics/doorSignup.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';
import { sendMail as realSendMail } from '@/lib/email';
import { renderAgenticsWelcome } from '@/i18n/emails/agenticsWelcome';
import { cleanSource, DEFAULT_SOURCE } from '@/lib/agenticsSource';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The table, in creation order. The migration file holds the same statement. */
export const AGENTICS_SIGNUPS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agentics_signups (
    tenant_id   TEXT NOT NULL PRIMARY KEY,
    source      TEXT NOT NULL DEFAULT 'direct',
    created_at  TEXT NOT NULL ${TS_DEFAULT},
    claimed_at  TEXT,
    welcomed_at TEXT
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgenticsSignupsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENTICS_SIGNUPS_DDL) await db.execute({ sql, args: [] });
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

/** Records the signup if this tenant has none yet. True when this call made the row. */
export async function registerSignup(tenantId: string, source: string): Promise<boolean> {
  await ensureAgenticsSignupsTable();
  const r = await db.execute({
    sql: `INSERT INTO agentics_signups (tenant_id, source) VALUES (?, ?) ON CONFLICT (tenant_id) DO NOTHING`,
    args: [tenantId, cleanSource(source)],
  });
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

export async function markWelcomed(tenantId: string, now: Date = new Date()): Promise<void> {
  await ensureAgenticsSignupsTable();
  await db.execute({
    sql: `UPDATE agentics_signups SET welcomed_at = ? WHERE tenant_id = ?`,
    args: [stamp(now), tenantId],
  });
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
    await registerSignup(input.tenantId, cleanSource(input.source));
    if (!email) return 'no_email';
    claimed = await claimWelcome(input.tenantId, deps.now());
    if (!claimed) return 'already';
    const letter = renderAgenticsWelcome(deps.appUrl.replace(/\/+$/, ''));
    await deps.send({ to: email, subject: letter.subject, text: letter.text, html: letter.html, replyTo: deps.replyTo });
    await markWelcomed(input.tenantId, deps.now());
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
