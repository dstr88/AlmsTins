/**
 * tokenOverrides.ts — per-tenant reclassification of tokens.
 *
 * The spam/scam heuristics in tokenClassification.ts are best-effort; users need a
 * way to correct them. An override says, for a token, "actually include it" (false
 * positive), "it's junk" (confirm), or "treat it as income" (a real airdrop with FMV
 * at receipt). Overrides win over the heuristic and are consulted by every view that
 * filters (Slice 2 wiring).
 *
 * Tenant-isolated: every query scoped by tenant_id. Two match scopes:
 *   - contract-level  (chain + contract)  — precise, for on-chain tokens
 *   - symbol-level    (symbol only)        — for CEX rows with no contract
 * Contract match takes precedence over symbol match.
 */
import { classifyTokenName, type TokenClass } from './tokenClassification';

// Lazy so the pure helpers (effectiveClass, lookupOverride) can be imported and
// unit-tested without pulling in the DB engine (which needs DATABASE_URL at load).
const getDb = async () => (await import('./db')).db;

export type OverrideDecision = 'include' | 'junk' | 'income';
/** Filtering outcome after applying an override to the heuristic class. */
export type EffectiveClass = 'clean' | 'spam' | 'income';

let ensured = false;
export async function ensureTokenOverrideTable(): Promise<void> {
  if (ensured) return;
  const db = await getDb();
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS token_overrides (
            id         TEXT PRIMARY KEY,
            tenant_id  TEXT NOT NULL,
            chain      TEXT,
            contract   TEXT,
            symbol     TEXT,
            decision   TEXT NOT NULL,
            note       TEXT,
            created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
            updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
          )`,
    args: [],
  });
  await db.execute({
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS token_overrides_key
          ON token_overrides (tenant_id, COALESCE(chain,''), COALESCE(contract,''), COALESCE(symbol,''))`,
    args: [],
  });
  ensured = true;
}

const contractKey = (chain?: string | null, contract?: string | null) =>
  `${(chain ?? '').toLowerCase()}|${(contract ?? '').toLowerCase()}`;
const symbolKey = (symbol?: string | null) => (symbol ?? '').toUpperCase();

export type OverrideMaps = {
  byContract: Map<string, OverrideDecision>;
  bySymbol: Map<string, OverrideDecision>;
};

/** Load a tenant's overrides into fast lookup maps. */
export async function getTokenOverrides(tenantId: string): Promise<OverrideMaps> {
  await ensureTokenOverrideTable();
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT chain, contract, symbol, decision FROM token_overrides WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const byContract = new Map<string, OverrideDecision>();
  const bySymbol = new Map<string, OverrideDecision>();
  for (const row of res.rows as unknown as { chain: string | null; contract: string | null; symbol: string | null; decision: OverrideDecision }[]) {
    if (row.contract) byContract.set(contractKey(row.chain, row.contract), row.decision);
    else if (row.symbol) bySymbol.set(symbolKey(row.symbol), row.decision);
  }
  return { byContract, bySymbol };
}

/** The override for a token, if any — contract match beats symbol match. */
export function lookupOverride(
  maps: OverrideMaps,
  token: { chain?: string | null; contract?: string | null; symbol?: string | null },
): OverrideDecision | null {
  if (token.contract) {
    const c = maps.byContract.get(contractKey(token.chain, token.contract));
    if (c) return c;
  }
  return maps.bySymbol.get(symbolKey(token.symbol)) ?? null;
}

/**
 * Load a tenant's spam filter as a single symbol predicate: true when the token is
 * filtered (spam) after applying overrides. Drop-in override-aware replacement for
 * isSpamToken(symbol) in the vault/portfolio/wallet views. Load once per request.
 */
export async function loadSpamFilter(tenantId: string): Promise<(symbol: string | null | undefined) => boolean> {
  const overrides = await getTokenOverrides(tenantId);
  return (symbol) =>
    effectiveClass(classifyTokenName({ symbol }).class, lookupOverride(overrides, { symbol })) === 'spam';
}

/** Combine the heuristic class with any override — the override wins. */
export function effectiveClass(base: TokenClass, override: OverrideDecision | null): EffectiveClass {
  if (override === 'include') return 'clean';
  if (override === 'junk') return 'spam';
  if (override === 'income') return 'income';
  return base === 'scam' ? 'spam' : base; // scam and spam both mean "filtered"
}

/** List the tokens a tenant has reclassified as income (for the tax income injection). */
export async function getIncomeOverrides(tenantId: string): Promise<Array<{ chain: string | null; contract: string | null; symbol: string | null }>> {
  await ensureTokenOverrideTable();
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT chain, contract, symbol FROM token_overrides WHERE tenant_id = ? AND decision = 'income'`,
    args: [tenantId],
  });
  return (res.rows as unknown as { chain: string | null; contract: string | null; symbol: string | null }[])
    .map((r) => ({ chain: r.chain ?? null, contract: r.contract ?? null, symbol: r.symbol ?? null }));
}

/** Upsert an override. */
export async function setTokenOverride(tenantId: string, input: {
  chain?: string | null; contract?: string | null; symbol?: string | null;
  decision: OverrideDecision; note?: string | null;
}): Promise<void> {
  await ensureTokenOverrideTable();
  const db = await getDb();
  const { randomUUID } = await import('crypto');
  await db.execute({
    sql: `INSERT INTO token_overrides (id, tenant_id, chain, contract, symbol, decision, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, COALESCE(chain,''), COALESCE(contract,''), COALESCE(symbol,''))
          DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note,
                        updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
    args: [
      randomUUID(), tenantId,
      input.chain ?? null, input.contract ?? null, input.symbol ?? null,
      input.decision, input.note ?? null,
    ],
  });
}

/** Remove an override (revert the token to the heuristic classification). */
export async function clearTokenOverride(tenantId: string, input: {
  chain?: string | null; contract?: string | null; symbol?: string | null;
}): Promise<void> {
  await ensureTokenOverrideTable();
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM token_overrides
          WHERE tenant_id = ?
            AND COALESCE(chain,'')    = COALESCE(?,'')
            AND COALESCE(contract,'') = COALESCE(?,'')
            AND COALESCE(symbol,'')   = COALESCE(?,'')`,
    args: [tenantId, input.chain ?? null, input.contract ?? null, input.symbol ?? null],
  });
}
