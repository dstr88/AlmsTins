import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  latestSyncRunSql,
  parseSyncRunAt,
  SYNC_RUN_AT_REWRITE,
  syncedSince,
  syncRunAtNow,
} from '../../src/lib/sync/syncRunAt';

/**
 * wallet_sync_state.last_run_at holds one format, `YYYY-MM-DD HH:MM:SS` UTC. The Solana and Sui
 * syncs wrote ISO (`2026-11-23T15:29:41.762Z`); as text that sorts above an EVM value from later
 * the same day, and the Bookkeeping strip then appended a second Z, could not parse it, and said
 * "never synced". Now every writer writes the one format, a one-time rewrite fixes stored values,
 * and every reader accepts either.
 *
 * No database.
 */

vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(ts|tsx|astro)$/.test(name)) out.push(rel);
  }
  return out;
}

describe('the one format', () => {
  it('is written as YYYY-MM-DD HH:MM:SS in UTC', () => {
    expect(syncRunAtNow(new Date('2026-11-23T15:29:41.762Z'))).toBe('2026-11-23 15:29:41');
  });

  it('is read in either format, both as UTC', () => {
    expect(parseSyncRunAt('2026-11-23 15:29:41')).toBe(Date.parse('2026-11-23T15:29:41Z'));
    expect(parseSyncRunAt('2026-11-23T15:29:41.762Z')).toBe(Date.parse('2026-11-23T15:29:41.762Z'));
    expect(parseSyncRunAt(null)).toBeNaN();
    expect(parseSyncRunAt('not a time')).toBeNaN();
  });

  it('the Bookkeeping strip once read an ISO value as no time at all', () => {
    // What bookkeeping.astro did before: append a Z to whatever MAX() returned.
    const old = (raw: string) => Date.parse(raw.replace(' ', 'T') + 'Z');
    expect(old('2026-11-23T15:29:41.762Z')).toBeNaN();
    expect(Number.isFinite(parseSyncRunAt('2026-11-23T15:29:41.762Z'))).toBe(true);
  });

  it('compares as times, not text', () => {
    const cutoff = Date.parse('2026-11-19T12:00:00.000Z');
    expect('2026-11-19 18:00:00' > new Date(cutoff).toISOString()).toBe(false); // the old text comparison
    expect(syncedSince('2026-11-19 18:00:00', cutoff)).toBe(true);
    expect(syncedSince('2026-11-19 06:00:00', cutoff)).toBe(false);
    expect(syncedSince(null, cutoff)).toBe(false);
  });

  it('MAX() reads every value in the one format', () => {
    expect(latestSyncRunSql()).toBe("MAX(replace(substr(CAST(last_run_at AS TEXT), 1, 19), 'T', ' '))");
    expect(latestSyncRunSql('s.last_run_at')).toBe("MAX(replace(substr(CAST(s.last_run_at AS TEXT), 1, 19), 'T', ' '))");
  });
});

describe('the one-time rewrite', () => {
  it('migrations-pg/0081 holds exactly the statement the code runs', () => {
    const file = squash(read('migrations-pg/0081_sync_run_at_format.sql')).split(';').map((s) => s.trim()).filter(Boolean);
    expect(file).toEqual([squash(SYNC_RUN_AT_REWRITE)]);
  });

  it('touches only ISO values', () => {
    expect(SYNC_RUN_AT_REWRITE).toMatch(/^UPDATE wallet_sync_state SET last_run_at = .* WHERE CAST\(last_run_at AS TEXT\) LIKE '____-__-__T%'$/);
  });
});

describe('every writer and reader', () => {
  it('the Solana and Sui syncs write the one format', () => {
    for (const file of ['src/lib/sync/syncSolanaTransactions.ts', 'src/lib/sync/syncSuiTransactions.ts']) {
      const src = read(file);
      expect(src, file).toContain('syncRunAtNow()');
      const state = src.slice(src.indexOf('INSERT INTO wallet_sync_state'));
      expect(state.slice(0, state.indexOf('});')), file).not.toMatch(/,\s*now\s*[,\]]/);
    }
  });

  it('no reader in src takes MAX(last_run_at) as text or compares it as text', () => {
    for (const file of filesUnder('src')) {
      const src = read(file);
      expect(src, file).not.toMatch(/MAX\(\s*(\w+\.)?last_run_at\s*\)/i);
    }
    for (const file of ['src/pages/api/cron/sync-wallets.ts', 'src/pages/api/cron/sync-solana.ts', 'src/pages/api/yearEnd/completeness.ts']) {
      expect(read(file), file).toContain('syncedSince(');
      expect(read(file), file).not.toMatch(/lastRun\s*>\s*staleThreshold|lastSync\s*<\s*staleISO/);
    }
  });

  it('the readers named in the plan use the helper', () => {
    for (const file of [
      'src/pages/dashboard/bookkeeping.astro',
      'src/pages/api/cron/sync-wallets.ts',
      'src/pages/api/yearEnd/completeness.ts',
      'src/components/dashboard/OnchainWalletTransactions.astro',
      'src/components/dashboard/SuiWalletTransactions.astro',
    ]) {
      expect(read(file), file).toContain('latestSyncRunSql(');
    }
    expect(read('src/pages/dashboard/bookkeeping.astro')).toContain('parseSyncRunAt(syncFreshRow.rows[0]?.last)');
  });
});
