/**
 * How an account wants to hear about its Agent Vault, and the two small records that keep a
 * message from going out twice. SQL only; the rules (what a setting may be, who is told what) live
 * in ./delivery.ts, ./digest.ts, ./reportJob.ts and ./alerts.ts.
 *
 * Everything here is per account (tenant_id on every statement), so a plan can cap it later
 * without any of it assuming one account. Nothing is on until the owner turns it on: an account
 * with no row has cadence `off` and alerts off.
 *
 *   agent_report_settings  one row per account: the digest cadence (off, daily, weekly, issues),
 *                          whether to be told at once about a flagged check, and the key of the
 *                          last digest sent, which is what stops the same digest going out twice.
 *   agent_alert_claims     one row per (account, tin, address): when it was last alerted about.
 *                          A claim is one atomic step, so a burst of flagged checks on one address
 *                          sends one email an hour, however many processes see them at once.
 *
 * Settings are configuration, not evidence, so they are updated in place; the ledger and the
 * reports stay append-only. Both tables are removed with the account
 * (src/lib/accountDeleteTables.ts). Schema is created lazily by ensureAgentDeliveryTables and
 * mirrored in migrations-pg/0054_agent_report_delivery.sql (tests/agentics/guards.test.ts keeps
 * the two equal).
 */
import { db } from '@/lib/db';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

export const CADENCES = ['off', 'daily', 'weekly', 'issues'] as const;
export type Cadence = (typeof CADENCES)[number];

/** The tables and indexes, in creation order. The migration file holds the same statements. */
export const AGENT_DELIVERY_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_report_settings (
    tenant_id       TEXT NOT NULL PRIMARY KEY,
    cadence         TEXT NOT NULL DEFAULT 'off' CHECK (cadence IN ('off', 'daily', 'weekly', 'issues')),
    alerts          INTEGER NOT NULL DEFAULT 0 CHECK (alerts IN (0, 1)),
    last_digest_key TEXT,
    updated_at      TEXT NOT NULL ${TS_DEFAULT}
  )`,
  `CREATE TABLE IF NOT EXISTS agent_alert_claims (
    tenant_id    TEXT NOT NULL,
    tin_id       TEXT NOT NULL,
    address      TEXT NOT NULL,
    last_sent_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, tin_id, address)
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the delivery tables if they are missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentDeliveryTables(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_DELIVERY_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

const isCadence = (v: unknown): v is Cadence => typeof v === 'string' && (CADENCES as readonly string[]).includes(v);

/** One account's settings. */
export interface StoredSettings {
  cadence: Cadence;
  alerts: boolean;
  /** The key of the last digest sent (see digestKey in ./digest.ts), or null when none has been. */
  lastDigestKey: string | null;
}

/** What an account has when it has set nothing: nothing is sent. */
export const NO_SETTINGS: StoredSettings = { cadence: 'off', alerts: false, lastDigestKey: null };

function settingsFrom(r: any): StoredSettings {
  return {
    cadence: isCadence(r.cadence) ? r.cadence : 'off',
    alerts: Number(r.alerts) === 1,
    lastDigestKey: r.last_digest_key == null ? null : String(r.last_digest_key),
  };
}

/** One account's settings, or the defaults (everything off) when it has set none. */
export async function readSettings(tenantId: string): Promise<StoredSettings> {
  await ensureAgentDeliveryTables();
  const r = await db.execute({
    sql: `SELECT cadence, alerts, last_digest_key FROM agent_report_settings WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  return r.rows.length ? settingsFrom(r.rows[0]) : { ...NO_SETTINGS };
}

/** Saves an account's cadence and alerts, creating its row if it has none. The last digest key is left as it is. */
export async function writeSettings(tenantId: string, next: { cadence: Cadence; alerts: boolean }, at: string): Promise<void> {
  await ensureAgentDeliveryTables();
  await db.execute({
    sql: `INSERT INTO agent_report_settings (tenant_id, cadence, alerts, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (tenant_id) DO UPDATE SET cadence = excluded.cadence, alerts = excluded.alerts, updated_at = excluded.updated_at`,
    args: [tenantId, next.cadence, next.alerts ? 1 : 0, at],
  });
}

/** An account that asked for a digest, as the daily job finds it. */
export interface OptedIn {
  tenantId: string;
  cadence: Exclude<Cadence, 'off'>;
  lastDigestKey: string | null;
}

/**
 * The accounts that have turned a digest on, for the daily job. The one read here that spans
 * accounts, because the job has to visit each of them; it returns what the job needs to decide,
 * and every statement after it is scoped to the account of the row it came from.
 */
export async function listOptedIn(limit: number): Promise<OptedIn[]> {
  await ensureAgentDeliveryTables();
  const r = await db.execute({
    sql: `SELECT tenant_id, cadence, last_digest_key FROM agent_report_settings WHERE cadence <> 'off' ORDER BY tenant_id ASC LIMIT ?`,
    args: [limit],
  });
  const out: OptedIn[] = [];
  for (const row of r.rows as any[]) {
    if (!isCadence(row.cadence) || row.cadence === 'off') continue;
    out.push({ tenantId: String(row.tenant_id), cadence: row.cadence, lastDigestKey: row.last_digest_key == null ? null : String(row.last_digest_key) });
  }
  return out;
}

/**
 * Claims the right to send the digest named `key` to one account: true only for the one caller
 * whose statement changed the row, so two runs of the job (a manual re-run, two instances) cannot
 * both send it. The claim is made before the email goes out and given back if the send fails.
 */
export async function claimDigest(tenantId: string, key: string): Promise<boolean> {
  await ensureAgentDeliveryTables();
  const r = await db.execute({
    sql: `UPDATE agent_report_settings SET last_digest_key = ? WHERE tenant_id = ? AND (last_digest_key IS NULL OR last_digest_key <> ?)`,
    args: [key, tenantId, key],
  });
  return (r.rowsAffected ?? 0) > 0;
}

/** Gives a digest claim back (after a failed send) so a re-run the same day tries again. Only if it is still ours. */
export async function releaseDigest(tenantId: string, key: string, previous: string | null): Promise<void> {
  await ensureAgentDeliveryTables();
  await db.execute({
    sql: `UPDATE agent_report_settings SET last_digest_key = ? WHERE tenant_id = ? AND last_digest_key = ?`,
    args: [previous, tenantId, key],
  });
}

/**
 * Claims the right to send a flagged-check alert about one address on one agent: at most one an
 * hour. Two statements, each atomic in Postgres, which together cannot let two callers both win:
 * the first INSERT wins a new address (a conflict is skipped), and otherwise the UPDATE wins only
 * if the last alert is older than the cutoff, and a second caller's UPDATE then reads the time
 * the first one just wrote and changes nothing.
 */
export async function claimAlert(tenantId: string, tinId: string, address: string, nowIso: string, cutoffIso: string): Promise<boolean> {
  await ensureAgentDeliveryTables();
  const inserted = await db.execute({
    sql: `INSERT INTO agent_alert_claims (tenant_id, tin_id, address, last_sent_at) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, tin_id, address) DO NOTHING`,
    args: [tenantId, tinId, address, nowIso],
  });
  if ((inserted.rowsAffected ?? 0) > 0) return true;
  const updated = await db.execute({
    sql: `UPDATE agent_alert_claims SET last_sent_at = ? WHERE tenant_id = ? AND tin_id = ? AND address = ? AND last_sent_at < ?`,
    args: [nowIso, tenantId, tinId, address, cutoffIso],
  });
  return (updated.rowsAffected ?? 0) > 0;
}
