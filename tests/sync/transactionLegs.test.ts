import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * transactions.leg and the key (account, hash, chain, wallet, leg): added lazily by
 * ensureTransactionLegs, mirrored by migrations-pg/0079_transaction_legs.sql and
 * migrations-pg/0080_drop_transactions_hash_chain_key.sql.
 *
 *   - The migration holds exactly the statements the code runs, in order: column, backfill, new
 *     index, then the old index dropped.
 *   - The schema is read first; nothing runs once it is in place, and a failure is false, not a throw.
 *   - Any unique rule that covers hash and chain without leg is dropped, whatever its name: a
 *     hand-made one on (hash, chain) refused the second side of every swap on production.
 *   - Every writer names the new key, and the sync refuses to write when it is not in place.
 *
 * No database: the stub answers the schema reads.
 */

const ROOT = path.resolve(__dirname, '../..');

const state = vi.hoisted(() => ({
  calls: [] as string[],
  hasColumn: false,
  indexes: [] as string[],
  defs: {} as Record<string, string>,
  fail: false,
  failOn: null as RegExp | null,
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string }) => {
      state.calls.push(stmt.sql);
      if (state.fail || state.failOn?.test(stmt.sql)) throw new Error('must be owner of table transactions');
      if (/information_schema/i.test(stmt.sql)) return { rows: state.hasColumn ? [{ ok: 1 }] : [], rowsAffected: 0 };
      if (/pg_indexes/i.test(stmt.sql)) return { rows: state.indexes.map((name) => ({ name, def: state.defs[name] ?? '' })), rowsAffected: 0 };
      return { rows: [{ id: 'row' }], rowsAffected: 1 };
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.calls = [];
  state.hasColumn = false;
  state.indexes = [];
  state.defs = {};
  state.fail = false;
  state.failOn = null;
});

const load = () => import('../../src/lib/transactionLegs');
const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the leg column and key', () => {
  it('migrations-pg/0079 holds exactly the statements the code runs, in order', async () => {
    const { TRANSACTION_LEGS_DDL } = await load();
    const file = squash(read('migrations-pg/0079_transaction_legs.sql')).split(';').map((s) => s.trim()).filter(Boolean);
    expect(file).toEqual(TRANSACTION_LEGS_DDL.map(squash));
    expect(file[0]).toBe('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS leg TEXT');
    expect(file[1]).toMatch(/^UPDATE transactions SET leg = .* WHERE leg IS NULL$/);
    expect(file[2]).toBe('CREATE UNIQUE INDEX IF NOT EXISTS transactions_tenant_hash_chain_wallet_leg_unique ON transactions (tenant_id, hash, chain, wallet_id, leg) NULLS NOT DISTINCT');
    expect(file[3]).toBe('DROP INDEX IF EXISTS transactions_tenant_hash_chain_unique');
  });

  it('the backfill names legs in the sync\'s own words', async () => {
    const { TRANSACTION_LEGS_DDL } = await load();
    const backfill = TRANSACTION_LEGS_DDL[1];
    expect(backfill).toContain(`'token:' || lower(COALESCE(contract_address, '')) || ':' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || COALESCE(value, '') || ':0'`);
    expect(backfill).toContain(`'native:' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || value || ':0'`);
    expect(backfill).toContain(`THEN 'fee'`);
    expect(backfill).toContain(`THEN 'custom'`);
    expect(backfill).toContain(`THEN 'manual'`);
  });

  it('runs every statement while something is missing, then sends nothing more in this process', async () => {
    const { ensureTransactionLegs, TRANSACTION_LEGS_DDL } = await load();
    state.indexes = ['transactions_tenant_hash_chain_unique'];
    expect(await ensureTransactionLegs()).toBe(true);
    const { HASH_CHAIN_KEY_DDL } = await load();
    expect(state.calls.filter((s) => !/information_schema|pg_indexes/.test(s))).toEqual([...TRANSACTION_LEGS_DDL, ...HASH_CHAIN_KEY_DDL]);
    state.calls = [];
    expect(await ensureTransactionLegs()).toBe(true);
    expect(state.calls).toEqual([]);
  });

  it('runs nothing when the column and new key are in place and the old key is gone', async () => {
    const { ensureTransactionLegs } = await load();
    state.hasColumn = true;
    state.indexes = ['transactions_pkey', 'transactions_tenant_hash_chain_wallet_leg_unique'];
    expect(await ensureTransactionLegs()).toBe(true);
    expect(state.calls.every((s) => /information_schema|pg_indexes/.test(s))).toBe(true);
  });

  it('a failure is false, never thrown, and is tried again on the next call', async () => {
    const { ensureTransactionLegs } = await load();
    state.fail = true;
    expect(await ensureTransactionLegs()).toBe(false);
    state.fail = false;
    state.hasColumn = true;
    state.indexes = ['transactions_tenant_hash_chain_wallet_leg_unique'];
    expect(await ensureTransactionLegs()).toBe(true);
  });

  it('migrations-pg/0080 drops transactions_hash_chain_key as a constraint and as an index, exactly as the code does', async () => {
    const { HASH_CHAIN_KEY_DDL } = await load();
    const file = squash(read('migrations-pg/0080_drop_transactions_hash_chain_key.sql')).split(';').map((s) => s.trim()).filter(Boolean);
    expect(file).toEqual(HASH_CHAIN_KEY_DDL.map(squash));
    expect(file).toEqual([
      'ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_hash_chain_key',
      'DROP INDEX IF EXISTS transactions_hash_chain_key',
    ]);
  });

  it('tells a unique rule that refuses a second leg from one that does not', async () => {
    const { refusesSecondLeg, uniqueIndexColumns } = await load();
    expect(refusesSecondLeg('CREATE UNIQUE INDEX transactions_hash_chain_key ON public.transactions USING btree (hash, chain)')).toBe(true);
    expect(refusesSecondLeg('CREATE UNIQUE INDEX t_one_per_hash ON public.transactions USING btree (tenant_id, hash, chain)')).toBe(true);
    expect(refusesSecondLeg('CREATE UNIQUE INDEX t_q ON public.transactions USING btree ("chain", "hash", wallet_id) WHERE (hash IS NOT NULL)')).toBe(true);
    expect(refusesSecondLeg('CREATE UNIQUE INDEX transactions_tenant_hash_chain_wallet_leg_unique ON public.transactions USING btree (tenant_id, hash, chain, wallet_id, leg) NULLS NOT DISTINCT')).toBe(false);
    expect(refusesSecondLeg('CREATE INDEX transactions_hash_idx ON public.transactions USING btree (hash, chain)')).toBe(false);
    expect(refusesSecondLeg('CREATE UNIQUE INDEX transactions_pkey ON public.transactions USING btree (id)')).toBe(false);
    expect(refusesSecondLeg('CREATE UNIQUE INDEX t_lower ON public.transactions USING btree (lower(hash), chain)')).toBe(false);
    expect(uniqueIndexColumns('CREATE UNIQUE INDEX x ON public.transactions USING btree (lower(hash), chain) INCLUDE (leg)')).toEqual(['lower(hash)', 'chain']);
  });

  it('drops transactions_hash_chain_key when it is left, even with the new key in place', async () => {
    const { ensureTransactionLegs } = await load();
    state.hasColumn = true;
    state.indexes = ['transactions_tenant_hash_chain_wallet_leg_unique', 'transactions_hash_chain_key'];
    state.defs.transactions_hash_chain_key = 'CREATE UNIQUE INDEX transactions_hash_chain_key ON public.transactions USING btree (hash, chain)';
    expect(await ensureTransactionLegs()).toBe(true);
    expect(state.calls).toContain('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_hash_chain_key');
    expect(state.calls).toContain('DROP INDEX IF EXISTS transactions_hash_chain_key');
  });

  it('finds and drops a rule on hash and chain without leg whatever its name, and says so in the log', async () => {
    const { ensureTransactionLegs } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.hasColumn = true;
    state.indexes = ['transactions_pkey', 'transactions_tenant_hash_chain_wallet_leg_unique', 'Tx One Per Hash'];
    state.defs['Tx One Per Hash'] = 'CREATE UNIQUE INDEX "Tx One Per Hash" ON public.transactions USING btree (tenant_id, hash, chain)';
    state.defs.transactions_pkey = 'CREATE UNIQUE INDEX transactions_pkey ON public.transactions USING btree (id)';
    expect(await ensureTransactionLegs()).toBe(true);
    expect(state.calls).toContain('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS "Tx One Per Hash"');
    expect(state.calls).toContain('DROP INDEX IF EXISTS "Tx One Per Hash"');
    expect(state.calls.some((s) => /transactions_pkey/.test(s) && /DROP/.test(s))).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('dropping unique rule Tx One Per Hash'))).toBe(true);
    warn.mockRestore();
  });

  it('says loudly when such a rule cannot be dropped, and the sync writes nothing', async () => {
    const { ensureTransactionLegs } = await load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.hasColumn = true;
    state.indexes = ['transactions_tenant_hash_chain_wallet_leg_unique', 'one_per_hash'];
    state.defs.one_per_hash = 'CREATE UNIQUE INDEX one_per_hash ON public.transactions USING btree (hash, chain)';
    state.failOn = /one_per_hash/;
    expect(await ensureTransactionLegs()).toBe(false);
    expect(error.mock.calls.some((c) => String(c[0]).includes('SYNC IS BLOCKED') && String(c[0]).includes('one_per_hash'))).toBe(true);
    error.mockRestore();
    warn.mockRestore();
  });

  it('the sync writes nothing when the key cannot be ensured', async () => {
    const { bulkUpsertTransactions } = await import('../../src/lib/transactions');
    state.fail = true;
    await expect(bulkUpsertTransactions('t-1', [{ walletId: 'w', hash: '0x1', chain: 'ethereum', timestamp: new Date(0) }])).rejects.toThrow(/nothing was saved/);
  });

  it('the sync names the leg and upserts on the new key, never moving a row to another wallet', async () => {
    const { bulkUpsertTransactions } = await import('../../src/lib/transactions');
    state.hasColumn = true;
    state.indexes = ['transactions_tenant_hash_chain_wallet_leg_unique'];
    await bulkUpsertTransactions('t-1', [{ walletId: 'w', hash: '0x1', leg: 'fee', chain: 'ethereum', timestamp: new Date(0) }]);
    const insert = state.calls.find((s) => /INSERT INTO transactions/.test(s))!;
    expect(insert).toMatch(/\(tenant_id, wallet_id, hash, leg, chain,/);
    expect(insert).toContain('ON CONFLICT(tenant_id, hash, chain, wallet_id, leg) DO UPDATE SET');
    expect(insert).not.toMatch(/wallet_id = excluded\.wallet_id/);
  });

  it('no writer in src still names the old key', () => {
    for (const file of ['src/lib/transactions.ts', 'src/pages/api/wallets/[id]/transactions.ts']) {
      expect(read(file), file).not.toMatch(/ON CONFLICT\s*\(\s*tenant_id,\s*hash,\s*chain\s*\)/);
    }
    const route = read('src/pages/api/wallets/[id]/transactions.ts');
    expect(route).toContain("VALUES (?, ?, ?, 'custom',");
    expect(route).toContain("VALUES (?, ?, ?, 'manual',");
    expect(route).toContain('ensureTransactionLegs()');
  });
});
