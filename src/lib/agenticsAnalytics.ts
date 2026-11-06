/**
 * Agentics analytics for the admin page (src/pages/admin/agentics.astro): who has an account, how much
 * of the Vault each one uses, where they are, and when their agents are active.
 *
 * Read-only, across every account: this is the one place outside the Vault that reads its tables
 * without a tenant_id in the WHERE, and only the admin page calls it (behind requireAdminSession).
 * The deployment owner's account is left out of every number, so the page shows customers only.
 *
 * Two halves. loadAgenticsAnalytics runs a handful of grouped queries; summarizeAgentics turns their
 * rows into the page's numbers and is pure, so tests/agentics/adminAnalytics.test.ts can check it
 * without a database. A query that fails (a table a fresh process has not made yet) answers no rows
 * and is named in `unavailable`, so the page still renders what it can.
 *
 * "Active" is the ledger's own time: a check is stamped when it was answered, a transfer with the time
 * of its block (src/lib/agentVault/events.ts). Every time here is UTC.
 */
import { db } from '@/lib/db';
import { ensureAgenticsSignupsTable } from '@/lib/agenticsSignup';
import { ensureAgentEventsTable } from '@/lib/agentVault/events';
import { ensureAgentVaultTables } from '@/lib/agentVault/store';
import { isOwner } from '@/lib/owner';

/** How far back the activity charts look. */
export const ACTIVITY_DAYS = 30;
/** The daily chart's length. */
export const DAILY_DAYS = 14;
/** An account counts as active when its agents did something in this many days. */
export const ACTIVE_DAYS = 7;

export interface RawRows {
  signups: Array<{ tenant_id: unknown; source: unknown; created_at: unknown; country: unknown; last_seen_at: unknown }>;
  emails: Array<{ tenant_id: unknown; email: unknown; created_at: unknown; id: unknown }>;
  tins: Array<{ tenant_id: unknown; n: unknown }>;
  wallets: Array<{ tenant_id: unknown; n: unknown }>;
  addresses: Array<{ tenant_id: unknown; n: unknown }>;
  events: Array<{ tenant_id: unknown; checks: unknown; transactions: unknown; sent: unknown; usd: unknown; first_at: unknown; last_at: unknown }>;
  /** Events per account per UTC hour (`YYYY-MM-DDTHH`) over the last ACTIVITY_DAYS days. */
  hours: Array<{ tenant_id: unknown; hour: unknown; n: unknown }>;
}

export interface AccountStats {
  tenantId: string;
  email: string | null;
  /** Two-letter code, or null when no visit had one. */
  country: string | null;
  source: string | null;
  /** UTC ISO-8601, or null for an account with agents and no signup row. */
  signedUpAt: string | null;
  /** When the account last opened Agentics (moved at most once an hour). */
  lastSeenAt: string | null;
  bots: number;
  wallets: number;
  addresses: number;
  checks: number;
  transactions: number;
  sent: number;
  received: number;
  usd: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  /** Events in the last ACTIVE_DAYS days. */
  recentEvents: number;
}

export interface AgenticsAnalytics {
  accounts: AccountStats[];
  totals: {
    accounts: number;
    /** Accounts with at least one agent. */
    withAgents: number;
    /** Accounts whose agents did something in the last ACTIVE_DAYS days. */
    active: number;
    bots: number;
    wallets: number;
    addresses: number;
    checks: number;
    transactions: number;
    usd: number;
  };
  countries: Array<{ country: string; accounts: number }>;
  /** Events by UTC hour of day, 0 to 23, over the last ACTIVITY_DAYS days. */
  byHour: number[];
  /** Events by UTC weekday, Sunday first, over the last ACTIVITY_DAYS days. */
  byWeekday: number[];
  /** The last DAILY_DAYS UTC days, oldest first: events, and how many accounts had any. */
  daily: Array<{ day: string; events: number; accounts: number }>;
  /** The parts that could not be read, by name. */
  unavailable: string[];
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A stored time as UTC ISO-8601: the Vault's are already, the signup table's are `YYYY-MM-DD HH:MM:SS`. */
export function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

/** Turns the query rows into the page's numbers. Pure. */
export function summarizeAgentics(raw: RawRows, now: Date = new Date(), unavailable: string[] = []): AgenticsAnalytics {
  const byTenant = new Map<string, AccountStats>();
  const account = (id: unknown): AccountStats | null => {
    const tenantId = str(id);
    if (!tenantId || isOwner(tenantId)) return null;
    let a = byTenant.get(tenantId);
    if (!a) {
      a = {
        tenantId, email: null, country: null, source: null, signedUpAt: null, lastSeenAt: null,
        bots: 0, wallets: 0, addresses: 0, checks: 0, transactions: 0, sent: 0, received: 0, usd: 0,
        firstActivityAt: null, lastActivityAt: null, recentEvents: 0,
      };
      byTenant.set(tenantId, a);
    }
    return a;
  };

  for (const r of raw.signups) {
    const a = account(r.tenant_id);
    if (!a) continue;
    a.source = str(r.source);
    a.signedUpAt = toIso(r.created_at);
    const c = str(r.country);
    a.country = c && /^[A-Z]{2}$/.test(c) ? c : null;
    a.lastSeenAt = toIso(r.last_seen_at);
  }
  for (const r of raw.tins) { const a = account(r.tenant_id); if (a) a.bots = num(r.n); }
  for (const r of raw.wallets) { const a = account(r.tenant_id); if (a) a.wallets = num(r.n); }
  for (const r of raw.addresses) { const a = account(r.tenant_id); if (a) a.addresses = num(r.n); }
  for (const r of raw.events) {
    const a = account(r.tenant_id);
    if (!a) continue;
    a.checks = num(r.checks);
    a.transactions = num(r.transactions);
    a.sent = num(r.sent);
    a.received = Math.max(0, a.transactions - a.sent);
    a.usd = num(r.usd);
    a.firstActivityAt = toIso(r.first_at);
    a.lastActivityAt = toIso(r.last_at);
  }

  // The email of the account's first sign-in, as emailOfTenant picks it: the earliest membership.
  const firstMember = new Map<string, { at: string; id: string; email: string }>();
  for (const r of raw.emails) {
    const tenantId = str(r.tenant_id);
    const email = str(r.email)?.trim() ?? '';
    if (!tenantId || !byTenant.has(tenantId) || !/^[^\s@]+@[^\s@]+$/.test(email)) continue;
    const at = str(r.created_at) ?? '';
    const id = str(r.id) ?? '';
    const best = firstMember.get(tenantId);
    if (!best || at < best.at || (at === best.at && id < best.id)) firstMember.set(tenantId, { at, id, email });
  }
  for (const [tenantId, m] of firstMember) byTenant.get(tenantId)!.email = m.email;

  // Activity: hour of day, weekday, and the daily window, from events per account per hour.
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Array.from({ length: DAILY_DAYS }, (_, i) => new Date(today - (DAILY_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const dailyEvents = new Map(days.map((d) => [d, 0]));
  const dailyAccounts = new Map(days.map((d) => [d, new Set<string>()]));
  const activityFrom = today - ACTIVITY_DAYS * 86_400_000;
  const recentFrom = now.getTime() - ACTIVE_DAYS * 86_400_000;
  for (const r of raw.hours) {
    const tenantId = str(r.tenant_id);
    const hour = str(r.hour);
    const n = num(r.n);
    if (!tenantId || !byTenant.has(tenantId) || !hour || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour) || n <= 0) continue;
    const t = Date.parse(`${hour}:00:00Z`);
    if (!Number.isFinite(t) || t < activityFrom) continue;
    const at = new Date(t);
    byHour[at.getUTCHours()] += n;
    byWeekday[at.getUTCDay()] += n;
    const day = hour.slice(0, 10);
    if (dailyEvents.has(day)) {
      dailyEvents.set(day, dailyEvents.get(day)! + n);
      dailyAccounts.get(day)!.add(tenantId);
    }
    // The hour's end, so an hour that began before the window and ran into it still counts.
    if (t + 3_600_000 > recentFrom) byTenant.get(tenantId)!.recentEvents += n;
  }

  const accounts = [...byTenant.values()].sort((a, b) => {
    const x = later(a.lastActivityAt, a.lastSeenAt) ?? a.signedUpAt ?? '';
    const y = later(b.lastActivityAt, b.lastSeenAt) ?? b.signedUpAt ?? '';
    return x === y ? a.tenantId.localeCompare(b.tenantId) : x < y ? 1 : -1;
  });

  const countryCounts = new Map<string, number>();
  for (const a of accounts) {
    const c = a.country ?? 'Unknown';
    countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
  }
  const countries = [...countryCounts]
    .map(([country, n]) => ({ country, accounts: n }))
    .sort((a, b) => Number(a.country === 'Unknown') - Number(b.country === 'Unknown') || b.accounts - a.accounts || a.country.localeCompare(b.country));

  const sum = (f: (a: AccountStats) => number) => accounts.reduce((s, a) => s + f(a), 0);
  return {
    accounts,
    totals: {
      accounts: accounts.length,
      withAgents: accounts.filter((a) => a.bots > 0).length,
      active: accounts.filter((a) => a.recentEvents > 0).length,
      bots: sum((a) => a.bots),
      wallets: sum((a) => a.wallets),
      addresses: sum((a) => a.addresses),
      checks: sum((a) => a.checks),
      transactions: sum((a) => a.transactions),
      usd: sum((a) => a.usd),
    },
    countries,
    byHour,
    byWeekday,
    daily: days.map((day) => ({ day, events: dailyEvents.get(day)!, accounts: dailyAccounts.get(day)!.size })),
    unavailable,
  };
}

/** The accounts the page is about: every signup, and every account with an agent. */
const AGENTICS_TENANTS = `SELECT tenant_id FROM agentics_signups UNION SELECT tenant_id FROM agent_tins`;

const QUERIES: Record<keyof RawRows, (since: string) => { sql: string; args: string[] }> = {
  signups: () => ({ sql: `SELECT tenant_id, source, created_at, country, last_seen_at FROM agentics_signups`, args: [] }),
  emails: () => ({
    sql: `SELECT m.tenant_id, u.email, m.created_at, m.id
          FROM tenant_memberships m JOIN auth_users u ON u.id = m.user_id
          WHERE m.tenant_id IN (${AGENTICS_TENANTS})`,
    args: [],
  }),
  tins: () => ({ sql: `SELECT tenant_id, COUNT(*) AS n FROM agent_tins WHERE deleted_at IS NULL GROUP BY tenant_id`, args: [] }),
  wallets: () => ({ sql: `SELECT tenant_id, COUNT(*) AS n FROM agent_wallets WHERE deleted_at IS NULL GROUP BY tenant_id`, args: [] }),
  addresses: () => ({ sql: `SELECT tenant_id, COUNT(*) AS n FROM agent_destinations WHERE deleted_at IS NULL GROUP BY tenant_id`, args: [] }),
  events: () => ({
    sql: `SELECT tenant_id,
                 COUNT(*) FILTER (WHERE kind = 'checked') AS checks,
                 COUNT(*) FILTER (WHERE kind = 'transaction') AS transactions,
                 COUNT(*) FILTER (WHERE kind = 'transaction' AND direction = 'out') AS sent,
                 COALESCE(SUM(usd_value) FILTER (WHERE kind = 'transaction'), 0) AS usd,
                 MIN(occurred_at) AS first_at,
                 MAX(occurred_at) AS last_at
          FROM agent_events GROUP BY tenant_id`,
    args: [],
  }),
  hours: (since) => ({
    sql: `SELECT tenant_id, substr(occurred_at, 1, 13) AS hour, COUNT(*) AS n
          FROM agent_events WHERE occurred_at >= ?
          GROUP BY tenant_id, substr(occurred_at, 1, 13)`,
    args: [since],
  }),
};

/** Reads every account's numbers. Never throws: a part that fails is empty and named in `unavailable`. */
export async function loadAgenticsAnalytics(now: Date = new Date()): Promise<AgenticsAnalytics> {
  await Promise.all([ensureAgenticsSignupsTable(), ensureAgentVaultTables(), ensureAgentEventsTable()].map((p) => p.catch(() => undefined)));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - ACTIVITY_DAYS * 86_400_000).toISOString();
  const unavailable: string[] = [];
  const names = Object.keys(QUERIES) as Array<keyof RawRows>;
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const r = await db.execute(QUERIES[name](since));
        return r.rows as unknown[];
      } catch (err) {
        const e = err as { name?: unknown; code?: unknown } | null;
        console.error('[admin] agentics analytics part not read', { part: name, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
        unavailable.push(name);
        return [];
      }
    }),
  );
  const raw = Object.fromEntries(names.map((n, i) => [n, results[i]])) as unknown as RawRows;
  return summarizeAgentics(raw, now, unavailable.sort());
}
