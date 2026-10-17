import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * Standing guards on the Agent Vault's files: the schema file and the code agree, the Vault keeps
 * to the bright lines (read-only, no custody, never in the transaction path; soft delete only;
 * not tax software), and its words keep the product's verb discipline. These read source, so they
 * fail the day someone adds a statement or an import that breaks a rule, not the day it is noticed.
 */

// store.ts imports the database; nothing here runs a query.
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** Every file that is part of the Vault, as the repo has it today. */
const VAULT_FILES = [
  ...walk(path.join(ROOT, 'src/lib/agentVault')),
  ...walk(path.join(ROOT, 'src/pages/api/agentics')),
  path.join(ROOT, 'src/lib/agenticsAccess.ts'),
  path.join(ROOT, 'src/lib/agenticsFlag.mjs'),
  path.join(ROOT, 'migrations-pg/0050_agent_vault.sql'),
].map(rel).sort();

/** SQL comments out, whitespace collapsed, spaces inside parentheses and before commas dropped. */
const squash = (sql: string) =>
  sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').trim();

describe('the schema file and the code create the same tables', () => {
  it('migrations-pg/0050_agent_vault.sql holds exactly the statements ensureAgentVaultTables runs, in order', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const statements = squash(read('migrations-pg/0050_agent_vault.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_VAULT_DDL.map(squash));
  });

  it('is the next migration after 0049, and the only 0050', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0050'))).toEqual(['0050_agent_vault.sql']);
    expect(files.filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) > 50)).toEqual([]);
    expect(files).toContain('0049_wallet_identity.sql');
  });

  it('every table is keyed by tenant_id, and soft-deletes with deleted_at', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const tables = AGENT_VAULT_DDL.filter((s) => /^CREATE TABLE/.test(s));
    expect(tables).toHaveLength(3);
    for (const sql of tables) {
      expect(sql).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
      expect(sql).toMatch(/\bdeleted_at\s+TEXT\b/);
    }
  });

  it('has the columns the design names', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const cols = (table: string) =>
      [...(AGENT_VAULT_DDL.find((s) => s.includes(`EXISTS ${table} (`)) ?? '').matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]);
    expect(cols('agent_tins')).toEqual(['id', 'tenant_id', 'label', 'agent_key_id', 'created_at', 'deleted_at']);
    expect(cols('agent_wallets')).toEqual(['id', 'tenant_id', 'tin_id', 'chain', 'address', 'created_at', 'deleted_at']);
    expect(cols('agent_destinations')).toEqual([
      'id', 'tenant_id', 'tin_id', 'chain', 'address', 'label', 'trust_status', 'trust_checked_at', 'trust_detail_json', 'created_at', 'deleted_at',
    ]);
  });

  it('limits trust_status to the three statuses in the table itself', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const { TRUST_STATUSES } = await import('../../src/lib/agentVault/trustPolicy');
    const sql = AGENT_VAULT_DDL.find((s) => s.includes('agent_destinations (')) ?? '';
    const listed = [...(sql.match(/CHECK \(trust_status IN \(([^)]*)\)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...TRUST_STATUSES].sort());
    expect(sql).toMatch(/trust_status\s+TEXT NOT NULL DEFAULT 'pending'/);
  });
});

describe('the Vault keeps to the bright lines', () => {
  it('finds the Vault files', () => {
    expect(VAULT_FILES).toEqual([
      'migrations-pg/0050_agent_vault.sql',
      'src/lib/agentVault/addresses.ts',
      'src/lib/agentVault/api.ts',
      'src/lib/agentVault/store.ts',
      'src/lib/agentVault/trustChecks.ts',
      'src/lib/agentVault/trustPolicy.ts',
      'src/lib/agentVault/vault.ts',
      'src/lib/agenticsAccess.ts',
      'src/lib/agenticsFlag.mjs',
      'src/pages/api/agentics/destinations.ts',
      'src/pages/api/agentics/destinations/trust.ts',
      'src/pages/api/agentics/tins.ts',
      'src/pages/api/agentics/wallets.ts',
    ]);
  });

  it('soft delete only: nothing in the Vault deletes, drops or truncates a row', () => {
    for (const file of VAULT_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(src, file).not.toMatch(/\bDROP\s+(TABLE|INDEX|COLUMN)\b/i);
      expect(src, file).not.toMatch(/\bTRUNCATE\b/i);
    }
  });

  it('read-only, no custody, never in the transaction path: no signing library, no key, no way to send', () => {
    for (const file of VAULT_FILES.filter((f) => f.endsWith('.ts'))) {
      const src = read(file);
      const imports = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^(ethers|viem|web3|@noble\/(secp256k1|curves)|bip39|bip32|hdkey|@solana\/web3\.js|bitcoinjs-lib|@zerodev)/);
      }
      expect(src, file).not.toMatch(/\b(sendRawTransaction|sendTransaction|signTransaction|signMessage|signTypedData|privateKey|mnemonic)\b/i);
    }
  });

  it('not tax software: nothing about cost basis, gains or profit', () => {
    for (const file of VAULT_FILES) {
      expect(read(file), file).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\b8949\b/i);
    }
  });

  it('no attribution: nothing in the Vault names a person or looks an address up as someone', () => {
    for (const file of VAULT_FILES.filter((f) => f.endsWith('.ts'))) {
      expect(read(file), file).not.toMatch(/\b(kyc|de-?anonymi[sz]|cluster(ing)?|reverse[- ]lookup|who owns)\b/i);
    }
  });

  it('never accepts a tenant id from a client', () => {
    for (const file of VAULT_FILES.filter((f) => f.startsWith('src/pages/api/agentics/'))) {
      const src = read(file);
      expect(src, file).not.toMatch(/body\.tenant|\.tenantId\b.*body|searchParams\.get\(\s*['"]tenant/i);
    }
  });
});

describe('the Vault keeps to the product wording', () => {
  it.each(VAULT_FILES)('%s: Almstins verifies, warns and flags, and never says it stops anything (American English)', (file) => {
    expect(brightLineViolations(read(file))).toEqual([]);
  });

  it('Pass and Trusted are never described as safe', () => {
    for (const file of VAULT_FILES) {
      // Comment markers out, then whole sentences: "never a statement that the address is safe" is
      // fine, "the address is safe" is not.
      const prose = read(file).split('\n').map((l) => l.replace(/^\s*(\*|\/\/|--)\s?/, '')).join(' ');
      for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
        if (/\b(is|are|means|marks?|certif(y|ies)|declares?|guarantees?)\b[^.]*\bsafe\b/i.test(sentence)) {
          expect(sentence, `${file}: ${sentence.trim()}`).toMatch(/\b(never|not|no|isn't)\b/i);
        }
      }
    }
  });
});
