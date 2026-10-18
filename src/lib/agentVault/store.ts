/**
 * Agent Vault storage: one tin per agent, the agent's own wallets, and the destinations it may
 * send to. SQL only; the rules (what a label may be, which key may be linked, what the checks
 * decide) live in ./vault.ts.
 *
 * Tenant isolation is enforced here, in the app, like the rest of the product: every statement
 * below that reads or writes a row names tenant_id, and there is no JOIN, so a row id from
 * another account can never match. A tin, wallet or destination of someone else answers exactly
 * like one that does not exist.
 *
 * Soft delete only. A removed tin, wallet or destination keeps its row with deleted_at set, and
 * every read here skips those rows. The partial unique indexes count live rows only, so removing
 * a destination frees its slot (adding the same address again makes a new row, and a fresh check)
 * while the old row stays as history. Removing a tin removes its wallets and destinations in the
 * same transaction. A hard delete happens only when the whole account is deleted
 * (src/lib/accountDeleteTables.ts).
 *
 * A plan's caps (./entitlements.ts) are enforced here, in the statement, not only in the code that
 * calls it: the *WithinCap inserts count the account's live rows and insert in one transaction
 * that first takes an advisory lock for the account, so any number of requests at once can never
 * fill more slots than the plan has. Rows that were removed (deleted_at set) do not count.
 *
 * Schema is created lazily by ensureAgentVaultTables, the house pattern, and mirrored in
 * migrations-pg/0050_agent_vault.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { parseChain, type VaultChain } from './addresses';
import { parseReadout, statusFromStored, type TrustReadout, type TrustStatus } from './trustPolicy';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The tables and indexes, in creation order. The migration file holds the same statements. */
export const AGENT_VAULT_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_tins (
    id           TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    label        TEXT NOT NULL,
    agent_key_id TEXT,
    created_at   TEXT NOT NULL ${TS_DEFAULT},
    deleted_at   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS agent_tins_tenant ON agent_tins (tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_tins_live_key ON agent_tins (tenant_id, agent_key_id) WHERE agent_key_id IS NOT NULL AND deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS agent_wallets (
    id         TEXT NOT NULL PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    tin_id     TEXT NOT NULL,
    chain      TEXT NOT NULL,
    address    TEXT NOT NULL,
    created_at TEXT NOT NULL ${TS_DEFAULT},
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS agent_wallets_tin ON agent_wallets (tenant_id, tin_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_wallets_live ON agent_wallets (tenant_id, tin_id, chain, address) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS agent_destinations (
    id                TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    tin_id            TEXT NOT NULL,
    chain             TEXT NOT NULL,
    address           TEXT NOT NULL,
    label             TEXT,
    trust_status      TEXT NOT NULL DEFAULT 'pending' CHECK (trust_status IN ('trusted', 'flagged', 'pending')),
    trust_checked_at  TEXT,
    trust_detail_json TEXT,
    created_at        TEXT NOT NULL ${TS_DEFAULT},
    deleted_at        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS agent_destinations_tin ON agent_destinations (tenant_id, tin_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_destinations_live ON agent_destinations (tenant_id, tin_id, chain, address) WHERE deleted_at IS NULL`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the Vault tables if they are missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentVaultTables(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_VAULT_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** UTC time as the other tables store it: YYYY-MM-DD HH:MM:SS. */
export function nowUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Postgres unique_violation: the partial unique index refused a second live row. */
export const isUniqueViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

// ── Shapes handed to callers (never a tenant id) ─────────────────────────────

export interface Tin {
  id: string;
  label: string;
  agentKeyId: string | null;
  createdAt: string;
}

export interface AgentWallet {
  id: string;
  tinId: string;
  chain: VaultChain;
  address: string;
  createdAt: string;
}

export interface Destination {
  id: string;
  tinId: string;
  chain: VaultChain;
  address: string;
  label: string | null;
  trustStatus: TrustStatus;
  /** When the checks last ran for this destination, or null if they never have. */
  trustCheckedAt: string | null;
  /** The readout behind the pill, or null if the checks never ran. */
  trust: TrustReadout | null;
  createdAt: string;
}

const text = (v: unknown): string | null => (v == null ? null : String(v));

function tinFrom(r: any): Tin {
  return { id: String(r.id), label: String(r.label), agentKeyId: text(r.agent_key_id), createdAt: String(r.created_at) };
}

function walletFrom(r: any): AgentWallet {
  return {
    id: String(r.id),
    tinId: String(r.tin_id),
    chain: (parseChain(r.chain) ?? String(r.chain)) as VaultChain,
    address: String(r.address),
    createdAt: String(r.created_at),
  };
}

function destinationFrom(r: any): Destination {
  return {
    id: String(r.id),
    tinId: String(r.tin_id),
    chain: (parseChain(r.chain) ?? String(r.chain)) as VaultChain,
    address: String(r.address),
    label: text(r.label),
    trustStatus: statusFromStored(r.trust_status),
    trustCheckedAt: text(r.trust_checked_at),
    trust: parseReadout(r.trust_detail_json),
    createdAt: String(r.created_at),
  };
}

// ── Plan caps ────────────────────────────────────────────────────────────────

/** The first key of the advisory locks taken here ("AGVL"), so they never meet another feature's. */
const CAP_LOCK_CLASS = 0x4147564c;

/**
 * The statement that opens a capped insert: an advisory lock for this account, held until the
 * transaction ends. Two requests for one account take turns, so the second one counts the rows the
 * first one wrote. Other accounts do not wait for each other (the second key is a hash of the
 * account id). A hash collision only makes two accounts take turns, never share a count.
 */
const capLock = (tenantId: string): { sql: string; args: string[] } => ({
  sql: `SELECT pg_advisory_xact_lock(${CAP_LOCK_CLASS}, hashtext(?))`,
  args: [tenantId],
});

const count = (r: { rows: unknown[] }): number => Number((r.rows[0] as { n?: unknown } | undefined)?.n ?? 0);

/** How many live agents the account has. */
export async function countLiveTins(tenantId: string): Promise<number> {
  await ensureAgentVaultTables();
  return count(await db.execute({ sql: `SELECT COUNT(*) AS n FROM agent_tins WHERE tenant_id = ? AND deleted_at IS NULL`, args: [tenantId] }));
}

/** How many live registered destinations the account has, over all its agents. */
export async function countLiveDestinations(tenantId: string): Promise<number> {
  await ensureAgentVaultTables();
  return count(await db.execute({ sql: `SELECT COUNT(*) AS n FROM agent_destinations WHERE tenant_id = ? AND deleted_at IS NULL`, args: [tenantId] }));
}

/** How many live own wallets one agent has. */
export async function countLiveWallets(tenantId: string, tinId: string): Promise<number> {
  await ensureAgentVaultTables();
  return count(
    await db.execute({ sql: `SELECT COUNT(*) AS n FROM agent_wallets WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL`, args: [tenantId, tinId] }),
  );
}

// ── Tins ─────────────────────────────────────────────────────────────────────

const TIN_COLUMNS = `id, label, agent_key_id, created_at`;

export async function insertTin(tenantId: string, input: { label: string; agentKeyId: string | null; at: string }): Promise<Tin> {
  await ensureAgentVaultTables();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO agent_tins (id, tenant_id, label, agent_key_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, tenantId, input.label, input.agentKeyId, input.at],
  });
  return { id, label: input.label, agentKeyId: input.agentKeyId, createdAt: input.at };
}

/**
 * Adds a tin only while the account has fewer than `cap` live tins. The count and the insert run in
 * one transaction, behind the account's lock (see capLock), so twenty requests at once for the
 * last slot add one tin and refuse nineteen. `over_limit` writes nothing.
 */
export async function insertTinWithinCap(
  tenantId: string,
  input: { label: string; agentKeyId: string | null; at: string },
  cap: number,
): Promise<{ kind: 'inserted'; tin: Tin } | { kind: 'over_limit' }> {
  await ensureAgentVaultTables();
  const id = randomUUID();
  const results = await db.batch(
    [
      capLock(tenantId),
      {
        sql: `INSERT INTO agent_tins (id, tenant_id, label, agent_key_id, created_at)
              SELECT ?, ?, ?, ?, ?
              WHERE (SELECT COUNT(*) FROM agent_tins WHERE tenant_id = ? AND deleted_at IS NULL) < ?`,
        args: [id, tenantId, input.label, input.agentKeyId, input.at, tenantId, cap],
      },
    ],
    'write',
  );
  if ((results[1]?.rowsAffected ?? 0) === 0) return { kind: 'over_limit' };
  return { kind: 'inserted', tin: { id, label: input.label, agentKeyId: input.agentKeyId, createdAt: input.at } };
}

export async function listTins(tenantId: string): Promise<Tin[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${TIN_COLUMNS} FROM agent_tins WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    args: [tenantId],
  });
  return r.rows.map(tinFrom);
}

export async function getTin(tenantId: string, id: string): Promise<Tin | null> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${TIN_COLUMNS} FROM agent_tins WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    args: [id, tenantId],
  });
  return r.rows.length ? tinFrom(r.rows[0]) : null;
}

/** The live tin this agent key is linked to, if any: one tin is one agent, so one key is one tin. */
export async function findLiveTinByKey(tenantId: string, agentKeyId: string): Promise<Tin | null> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${TIN_COLUMNS} FROM agent_tins WHERE tenant_id = ? AND agent_key_id = ? AND deleted_at IS NULL LIMIT 1`,
    args: [tenantId, agentKeyId],
  });
  return r.rows.length ? tinFrom(r.rows[0]) : null;
}

/** Sets a live tin's label and linked key. False when there is no such live tin. */
export async function updateTin(tenantId: string, id: string, next: { label: string; agentKeyId: string | null }): Promise<boolean> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `UPDATE agent_tins SET label = ?, agent_key_id = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    args: [next.label, next.agentKeyId, id, tenantId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

/**
 * Removes a tin and its wallets and destinations in one transaction (rows stay, deleted_at is
 * set). False when there is no such live tin; nothing else is touched then, because the child
 * statements are scoped to the same tenant and tin.
 */
export async function softDeleteTin(tenantId: string, id: string, at: string): Promise<boolean> {
  await ensureAgentVaultTables();
  const results = await db.batch(
    [
      { sql: `UPDATE agent_destinations SET deleted_at = ? WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL`, args: [at, tenantId, id] },
      { sql: `UPDATE agent_wallets SET deleted_at = ? WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL`, args: [at, tenantId, id] },
      { sql: `UPDATE agent_tins SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, args: [at, id, tenantId] },
    ],
    'write',
  );
  return (results[2]?.rowsAffected ?? 0) > 0;
}

// ── The agent's own wallets ──────────────────────────────────────────────────

const WALLET_COLUMNS = `id, tin_id, chain, address, created_at`;

export async function findLiveWallet(tenantId: string, tinId: string, chain: VaultChain, address: string): Promise<AgentWallet | null> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${WALLET_COLUMNS} FROM agent_wallets WHERE tenant_id = ? AND tin_id = ? AND chain = ? AND address = ? AND deleted_at IS NULL LIMIT 1`,
    args: [tenantId, tinId, chain, address],
  });
  return r.rows.length ? walletFrom(r.rows[0]) : null;
}

/** Adds a wallet unless the tin already has this one live. */
export async function insertWallet(
  tenantId: string,
  input: { tinId: string; chain: VaultChain; address: string; at: string },
): Promise<{ kind: 'inserted'; wallet: AgentWallet } | { kind: 'duplicate'; wallet: AgentWallet }> {
  const existing = await findLiveWallet(tenantId, input.tinId, input.chain, input.address);
  if (existing) return { kind: 'duplicate', wallet: existing };
  const id = randomUUID();
  try {
    await db.execute({
      sql: `INSERT INTO agent_wallets (id, tenant_id, tin_id, chain, address, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, tenantId, input.tinId, input.chain, input.address, input.at],
    });
  } catch (e) {
    // A concurrent add won the race for the live slot.
    if (!isUniqueViolation(e)) throw e;
    const raced = await findLiveWallet(tenantId, input.tinId, input.chain, input.address);
    if (raced) return { kind: 'duplicate', wallet: raced };
    throw e;
  }
  return { kind: 'inserted', wallet: { id, tinId: input.tinId, chain: input.chain, address: input.address, createdAt: input.at } };
}

/**
 * Adds a wallet unless the tin already has this one live, and only while the tin has fewer than
 * `cap` live wallets (counted and inserted in one transaction, behind the account's lock). A wallet
 * the tin already holds is a duplicate whatever the cap says: it takes no new slot.
 */
export async function insertWalletWithinCap(
  tenantId: string,
  input: { tinId: string; chain: VaultChain; address: string; at: string },
  cap: number,
): Promise<{ kind: 'inserted'; wallet: AgentWallet } | { kind: 'duplicate'; wallet: AgentWallet } | { kind: 'over_limit' }> {
  const existing = await findLiveWallet(tenantId, input.tinId, input.chain, input.address);
  if (existing) return { kind: 'duplicate', wallet: existing };
  const id = randomUUID();
  try {
    const results = await db.batch(
      [
        capLock(tenantId),
        {
          sql: `INSERT INTO agent_wallets (id, tenant_id, tin_id, chain, address, created_at)
                SELECT ?, ?, ?, ?, ?, ?
                WHERE (SELECT COUNT(*) FROM agent_wallets WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL) < ?`,
          args: [id, tenantId, input.tinId, input.chain, input.address, input.at, tenantId, input.tinId, cap],
        },
      ],
      'write',
    );
    if ((results[1]?.rowsAffected ?? 0) === 0) return { kind: 'over_limit' };
  } catch (e) {
    // A concurrent add won the race for the live slot.
    if (!isUniqueViolation(e)) throw e;
    const raced = await findLiveWallet(tenantId, input.tinId, input.chain, input.address);
    if (raced) return { kind: 'duplicate', wallet: raced };
    throw e;
  }
  return { kind: 'inserted', wallet: { id, tinId: input.tinId, chain: input.chain, address: input.address, createdAt: input.at } };
}

export async function listWallets(tenantId: string, tinId: string): Promise<AgentWallet[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${WALLET_COLUMNS} FROM agent_wallets WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    args: [tenantId, tinId],
  });
  return r.rows.map(walletFrom);
}

export async function softDeleteWallet(tenantId: string, id: string, at: string): Promise<boolean> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `UPDATE agent_wallets SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    args: [at, id, tenantId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

// ── Destinations ─────────────────────────────────────────────────────────────

const DESTINATION_COLUMNS = `id, tin_id, chain, address, label, trust_status, trust_checked_at, trust_detail_json, created_at`;

export async function findLiveDestination(tenantId: string, tinId: string, chain: VaultChain, address: string): Promise<Destination | null> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${DESTINATION_COLUMNS} FROM agent_destinations WHERE tenant_id = ? AND tin_id = ? AND chain = ? AND address = ? AND deleted_at IS NULL LIMIT 1`,
    args: [tenantId, tinId, chain, address],
  });
  return r.rows.length ? destinationFrom(r.rows[0]) : null;
}

/**
 * Adds a destination as pending, with no check recorded, unless the tin already has this address
 * live on this chain. Nothing becomes trusted here: trust is written only by recordTrust, from a
 * stored readout.
 */
export async function insertDestination(
  tenantId: string,
  input: { tinId: string; chain: VaultChain; address: string; label: string | null; at: string },
): Promise<{ kind: 'inserted'; destination: Destination } | { kind: 'duplicate'; destination: Destination }> {
  const existing = await findLiveDestination(tenantId, input.tinId, input.chain, input.address);
  if (existing) return { kind: 'duplicate', destination: existing };
  const id = randomUUID();
  try {
    await db.execute({
      sql: `INSERT INTO agent_destinations (id, tenant_id, tin_id, chain, address, label, trust_status, trust_checked_at, trust_detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, tenantId, input.tinId, input.chain, input.address, input.label, 'pending', null, null, input.at],
    });
  } catch (e) {
    // A concurrent add won the race for the live slot.
    if (!isUniqueViolation(e)) throw e;
    const raced = await findLiveDestination(tenantId, input.tinId, input.chain, input.address);
    if (raced) return { kind: 'duplicate', destination: raced };
    throw e;
  }
  return {
    kind: 'inserted',
    destination: {
      id,
      tinId: input.tinId,
      chain: input.chain,
      address: input.address,
      label: input.label,
      trustStatus: 'pending',
      trustCheckedAt: null,
      trust: null,
      createdAt: input.at,
    },
  };
}

/**
 * Adds a destination as pending, like insertDestination, and only while the account has fewer than
 * `cap` live destinations over all its tins (counted and inserted in one transaction, behind the
 * account's lock). An address the tin already holds live is a duplicate whatever the cap says: it
 * takes no new slot.
 */
export async function insertDestinationWithinCap(
  tenantId: string,
  input: { tinId: string; chain: VaultChain; address: string; label: string | null; at: string },
  cap: number,
): Promise<{ kind: 'inserted'; destination: Destination } | { kind: 'duplicate'; destination: Destination } | { kind: 'over_limit' }> {
  const existing = await findLiveDestination(tenantId, input.tinId, input.chain, input.address);
  if (existing) return { kind: 'duplicate', destination: existing };
  const id = randomUUID();
  try {
    const results = await db.batch(
      [
        capLock(tenantId),
        {
          sql: `INSERT INTO agent_destinations (id, tenant_id, tin_id, chain, address, label, trust_status, trust_checked_at, trust_detail_json, created_at)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                WHERE (SELECT COUNT(*) FROM agent_destinations WHERE tenant_id = ? AND deleted_at IS NULL) < ?`,
          args: [id, tenantId, input.tinId, input.chain, input.address, input.label, 'pending', null, null, input.at, tenantId, cap],
        },
      ],
      'write',
    );
    if ((results[1]?.rowsAffected ?? 0) === 0) return { kind: 'over_limit' };
  } catch (e) {
    // A concurrent add won the race for the live slot.
    if (!isUniqueViolation(e)) throw e;
    const raced = await findLiveDestination(tenantId, input.tinId, input.chain, input.address);
    if (raced) return { kind: 'duplicate', destination: raced };
    throw e;
  }
  return {
    kind: 'inserted',
    destination: {
      id,
      tinId: input.tinId,
      chain: input.chain,
      address: input.address,
      label: input.label,
      trustStatus: 'pending',
      trustCheckedAt: null,
      trust: null,
      createdAt: input.at,
    },
  };
}

export async function listDestinations(tenantId: string, tinId: string): Promise<Destination[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${DESTINATION_COLUMNS} FROM agent_destinations WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    args: [tenantId, tinId],
  });
  return r.rows.map(destinationFrom);
}

/**
 * Every live destination of one tin with this normalized address, on any chain (an EVM address is
 * the same wallet on each EVM chain, so the owner may have listed it on more than one).
 */
export async function listDestinationsByAddress(tenantId: string, tinId: string, address: string): Promise<Destination[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${DESTINATION_COLUMNS} FROM agent_destinations WHERE tenant_id = ? AND tin_id = ? AND address = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
    args: [tenantId, tinId, address],
  });
  return r.rows.map(destinationFrom);
}

/** The live destinations of one tin among `ids`. An id that is not this tenant's, or not this tin's, simply is not returned. */
export async function getDestinations(tenantId: string, tinId: string, ids: readonly string[]): Promise<Destination[]> {
  if (!ids.length) return [];
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT ${DESTINATION_COLUMNS} FROM agent_destinations WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at ASC, id ASC`,
    args: [tenantId, tinId, ...ids],
  });
  return r.rows.map(destinationFrom);
}

/**
 * Records a check on a live destination. The flag is a ratchet enforced here, in the statement:
 * a row that is flagged is only ever rewritten by another flag, so two checks racing, or a later
 * clean answer, cannot clear it. False when nothing was written (the destination was removed, or
 * it is flagged and this result is not).
 */
export async function recordTrust(
  tenantId: string,
  id: string,
  result: { status: TrustStatus; readout: TrustReadout; checkedAt: string },
): Promise<boolean> {
  await ensureAgentVaultTables();
  const ratchet = result.status === 'flagged' ? '' : ` AND trust_status <> 'flagged'`;
  const r = await db.execute({
    sql: `UPDATE agent_destinations SET trust_status = ?, trust_checked_at = ?, trust_detail_json = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL${ratchet}`,
    args: [result.status, result.checkedAt, JSON.stringify(result.readout), id, tenantId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

/** Removes a destination from the watched set (the row stays as history). False when there is no such live destination. */
export async function softDeleteDestination(tenantId: string, id: string, at: string): Promise<boolean> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `UPDATE agent_destinations SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    args: [at, id, tenantId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

// ── What the watcher reads ───────────────────────────────────────────────────

/**
 * The first `limit` trusted, live destinations of one account, oldest first, across all its tins.
 * The watcher reads only these: a free account tracks a fixed number of destinations pooled over
 * its agents (see MAX_WATCHED_PER_TENANT in ./watcher.ts), and the oldest ones keep their place.
 */
export async function listWatchedDestinationIds(tenantId: string, limit: number): Promise<string[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT id FROM agent_destinations WHERE tenant_id = ? AND trust_status = 'trusted' AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT ?`,
    args: [tenantId, limit],
  });
  return r.rows.map((row: any) => String(row.id));
}

/** A tin with something to watch, as the daily job finds it. */
export interface WatchTarget {
  tenantId: string;
  tinId: string;
}

/**
 * Every live tin of every account, for the daily report job: ids only, oldest account first. The
 * other read here that spans accounts, because the job has to visit each tin; every statement
 * after it is scoped to the account of the row it came from.
 */
export async function listAllTins(limit: number): Promise<WatchTarget[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT tenant_id, id FROM agent_tins WHERE deleted_at IS NULL ORDER BY tenant_id ASC, created_at ASC, id ASC LIMIT ?`,
    args: [limit],
  });
  return (r.rows as any[]).map((row) => ({ tenantId: String(row.tenant_id), tinId: String(row.id) }));
}

/**
 * The tins that have at least one trusted destination, for the daily job. The one read here that
 * spans accounts, because the job has to visit each of them; it returns ids only, and every
 * statement after it is scoped to the account of the row it came from.
 */
export async function listWatchTargets(limit: number): Promise<WatchTarget[]> {
  await ensureAgentVaultTables();
  const r = await db.execute({
    sql: `SELECT tenant_id, tin_id FROM agent_destinations WHERE trust_status = 'trusted' AND deleted_at IS NULL ORDER BY tenant_id ASC, tin_id ASC LIMIT ?`,
    args: [limit],
  });
  const seen = new Set<string>();
  const out: WatchTarget[] = [];
  for (const row of r.rows as any[]) {
    const tenantId = String(row.tenant_id);
    const tinId = String(row.tin_id);
    const key = `${tenantId}|${tinId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tenantId, tinId });
  }
  return out;
}
