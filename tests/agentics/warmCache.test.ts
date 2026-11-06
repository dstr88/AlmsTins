import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The warm-address cache (src/lib/agentVault/warmCache.ts), run on the in-memory stand-in for the
 * database with its own SQL: at most ten addresses per account, a sliding ten-minute expiry, eviction
 * on any flag and on a sanctions update, one account never reading another's, and leaving the list by
 * a mark, never a delete. Every address and account is invented. No network.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

let fake: ReceivablesDbFake;
let warm: typeof import('../../src/lib/agentVault/warmCache');

const A = 'tenant-a';
const B = 'tenant-b';
const T0 = new Date('2026-11-05T14:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const addr = (n: number) => `0x${'feed'.padEnd(36, '0')}${n.toString(16).padStart(4, '0')}`;
const SCREENED = '2026-11-05T13:59:58.000Z';

const createThreatMeta = () =>
  fake.execute({ sql: `CREATE TABLE IF NOT EXISTS threat_meta (source TEXT NOT NULL PRIMARY KEY, content_hash TEXT, entry_count INTEGER, refreshed_at TEXT)`, args: [] });
const sanctionsChanged = (source: string, at: string) =>
  fake.execute({ sql: `INSERT INTO threat_meta (source, content_hash, entry_count, refreshed_at) VALUES (?, ?, ?, ?)`, args: [source, 'h', 1, at] });

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  await createThreatMeta();
  await sanctionsChanged('ofac_eth', '2026-11-01T00:00:00.000Z');
  warm = await import('../../src/lib/agentVault/warmCache');
});

describe('warmEntryUsable: when a stored screening may answer a check', () => {
  const entry = { screenedAt: SCREENED, lastUsedAt: T0.toISOString() };
  const sanctions = '2026-11-01T00:00:00.000Z';

  it('answers within ten minutes of its last use, and not at ten minutes or after', () => {
    expect(warm.warmEntryUsable(entry, sanctions, T0)).toBe(true);
    expect(warm.warmEntryUsable(entry, sanctions, later(10 * MIN - 1))).toBe(true);
    expect(warm.warmEntryUsable(entry, sanctions, later(10 * MIN))).toBe(false);
    expect(warm.warmEntryUsable(entry, sanctions, later(60 * MIN))).toBe(false);
  });

  it('is not used once the sanctions mirror changed after the screening', () => {
    expect(warm.warmEntryUsable(entry, '2026-11-05T13:59:59.000Z', T0)).toBe(false);
    expect(warm.warmEntryUsable(entry, SCREENED, T0)).toBe(false);
  });

  it('is not used when the mirror time could not be read, and stands when the mirror never loaded', () => {
    expect(warm.warmEntryUsable(entry, undefined, T0)).toBe(false);
    expect(warm.warmEntryUsable(entry, null, T0)).toBe(true);
  });

  it('refuses times that are not times, or that lie in the future', () => {
    expect(warm.warmEntryUsable({ ...entry, screenedAt: 'yesterday' }, sanctions, T0)).toBe(false);
    expect(warm.warmEntryUsable({ ...entry, lastUsedAt: '' }, sanctions, T0)).toBe(false);
    expect(warm.warmEntryUsable({ ...entry, screenedAt: later(MIN).toISOString() }, sanctions, T0)).toBe(false);
    expect(warm.warmEntryUsable({ ...entry, lastUsedAt: later(MIN).toISOString() }, sanctions, T0)).toBe(false);
  });

  it('keeps ten addresses for ten minutes', () => {
    expect(warm.WARM_MAX).toBe(10);
    expect(warm.WARM_IDLE_MS).toBe(10 * MIN);
  });
});

describe('the cache in the database', () => {
  it('answers a kept address with the time of its screening, and only the account that kept it', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    expect(await warm.takeWarm(A, addr(1), later(MIN))).toEqual({ screenedAt: SCREENED });
    expect(await warm.takeWarm(B, addr(1), later(MIN))).toBeNull();
    expect(await warm.takeWarm(A, addr(2), later(MIN))).toBeNull();
  });

  it('slides: each hit starts the ten minutes again, so steady use keeps it, and ten idle minutes end it', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    expect(await warm.takeWarm(A, addr(1), later(9 * MIN))).not.toBeNull();
    expect(await warm.takeWarm(A, addr(1), later(18 * MIN))).not.toBeNull();
    // The screening time stays the original one however long it is kept warm.
    expect(await warm.takeWarm(A, addr(1), later(27 * MIN))).toEqual({ screenedAt: SCREENED });
    expect(await warm.takeWarm(A, addr(1), later(37 * MIN))).toBeNull();
    expect(fake.rows('agent_warm_addresses')[0].evicted_at).toBe(later(37 * MIN).toISOString());
    // Once out, it stays out until a fresh screening puts it back.
    expect(await warm.takeWarm(A, addr(1), later(38 * MIN))).toBeNull();
  });

  it('keeps at most ten per account: the eleventh pushes out the one used longest ago', async () => {
    for (let n = 1; n <= 10; n++) await warm.putWarm(A, addr(n), SCREENED, later(n * 1000));
    // Using the first one makes the second the oldest.
    await warm.takeWarm(A, addr(1), later(20_000));
    await warm.putWarm(A, addr(11), SCREENED, later(21_000));
    const live = fake.rows('agent_warm_addresses').filter((r) => r.tenant_id === A && r.evicted_at === null).map((r) => r.address);
    expect(live).toHaveLength(10);
    expect(live).not.toContain(addr(2));
    expect(live).toContain(addr(1));
    expect(await warm.takeWarm(A, addr(2), later(22_000))).toBeNull();
    // Another account's list is its own.
    await warm.putWarm(B, addr(50), SCREENED, later(22_000));
    expect(fake.rows('agent_warm_addresses').filter((r) => r.tenant_id === A && r.evicted_at === null)).toHaveLength(10);
  });

  it('marks idle addresses out when another is kept', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    await warm.putWarm(A, addr(2), SCREENED, later(11 * MIN));
    const one = fake.rows('agent_warm_addresses').find((r) => r.address === addr(1));
    expect(one?.evicted_at).toBe(later(11 * MIN).toISOString());
  });

  it('evicts on a flag, and an evicted address is never answered until a fresh screening passes again', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    await warm.evictWarm(A, addr(1), later(MIN));
    expect(await warm.takeWarm(A, addr(1), later(2 * MIN))).toBeNull();
    await warm.putWarm(A, addr(1), '2026-11-05T14:02:30.000Z', later(3 * MIN));
    expect(await warm.takeWarm(A, addr(1), later(4 * MIN))).toEqual({ screenedAt: '2026-11-05T14:02:30.000Z' });
    // The address reuses its row: one row per account and address, however often it comes back.
    expect(fake.rows('agent_warm_addresses').filter((r) => r.address === addr(1))).toHaveLength(1);
  });

  it('is not answered after a sanctions update, and the update evicts it', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    await sanctionsChanged('ofac_btc', '2026-11-05T14:00:30.000Z');
    expect(await warm.takeWarm(A, addr(1), later(MIN))).toBeNull();
    expect(fake.rows('agent_warm_addresses')[0].evicted_at).not.toBeNull();
  });

  it('ignores updates of lists that are not sanctions (the domain lists)', async () => {
    await warm.putWarm(A, addr(1), SCREENED, T0);
    await sanctionsChanged('scamsniffer', '2026-11-05T14:00:30.000Z');
    expect(await warm.takeWarm(A, addr(1), later(MIN))).toEqual({ screenedAt: SCREENED });
  });

  it('answers nothing when the sanctions time cannot be read', async () => {
    fake = createReceivablesDbFake();
    holder.db = fake;
    vi.resetModules();
    warm = await import('../../src/lib/agentVault/warmCache');
    await warm.putWarm(A, addr(1), SCREENED, T0);
    expect(await warm.takeWarm(A, addr(1), later(MIN))).toBeNull();
  });

  it('never deletes a row: leaving the list is a mark', async () => {
    for (let n = 1; n <= 12; n++) await warm.putWarm(A, addr(n), SCREENED, later(n * 1000));
    await warm.evictWarm(A, addr(12), later(20_000));
    await warm.takeWarm(A, addr(11), later(30 * MIN));
    expect(fake.rows('agent_warm_addresses')).toHaveLength(12);
    expect(fake.statements(/DELETE/i)).toEqual([]);
  });
});
