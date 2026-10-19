import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk } from '../helpers/agentVault';

/**
 * The two refusals of the export that no configuration can reach, so each is played with the one
 * piece it depends on replaced:
 *
 *   - A file is never handed over as signed when the keys Almstins publishes cannot confirm it (the
 *     published set is replaced with an empty one, as if the signing key had been left out).
 *   - A range whose size grew between the count and the read is refused, never cut short and handed
 *     over as whole (the count is replaced with a number that is too small).
 */
const holder = vi.hoisted(() => ({ db: null as any, published: null as null | unknown[], counted: null as null | number }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));
vi.mock('@/lib/recordProof/signing', async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, getPublishedKeys: () => (holder.published !== null ? holder.published : (real.getPublishedKeys as () => unknown[])()) };
});
vi.mock('../../src/lib/agentVault/events', async (original) => {
  const real = (await original()) as Record<string, any>;
  return { ...real, countEventsInRange: async (...a: unknown[]) => (holder.counted !== null ? holder.counted : real.countEventsInRange(...a)) };
});

const A = 'tenant-a';
const NOW = new Date('2026-10-18T12:00:00.000Z');
let fake: ReceivablesDbFake;
let vault: typeof import('../../src/lib/agentVault/vault');
let ex: typeof import('../../src/lib/agentVault/ledgerExport');

beforeAll(() => {
  process.env.ALMSTINS_SIGNING_KEY = randomBytes(32).toString('hex');
});
afterAll(() => {
  delete process.env.ALMSTINS_SIGNING_KEY;
});
beforeEach(async () => {
  vi.resetModules();
  holder.published = null;
  holder.counted = null;
  fake = createReceivablesDbFake();
  holder.db = fake;
  vault = await import('../../src/lib/agentVault/vault');
  ex = await import('../../src/lib/agentVault/ledgerExport');
});

const deps = { now: () => NOW, newId: () => '00000000-0000-4000-8000-0000000000ee' };

describe('the export\'s last guards', () => {
  it('a file the published keys cannot confirm is never handed over as signed', async () => {
    const tin = expectOk(await vault.createTin(A, { label: 'Agent' })).tin;
    expectOk(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps)); // fine while the key is published
    holder.published = [];
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps)).toEqual({ ok: false, error: 'signing_unavailable' });
    holder.published = [{ key_id: 'almstins-0000000000000000', alg: 'Ed25519', public_key_hex: 'ab'.repeat(32) }]; // a different key is published
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps)).toEqual({ ok: false, error: 'signing_unavailable' });
  });

  it('a range that grew past the limit after it was counted is refused, not cut short', async () => {
    const tin = expectOk(await vault.createTin(A, { label: 'Agent' })).tin;
    // The replaced count would have made the table; the module remembers having made it for an earlier test's database, so make it here.
    for (const sql of (await import('../../src/lib/agentVault/events')).AGENT_EVENTS_DDL) await fake.execute({ sql, args: [] });
    for (let i = 0; i < ex.MAX_EXPORT_EVENTS + 1; i += 1) {
      fake.seed('agent_events', {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tenant_id: A, tin_id: tin.id, kind: 'checked', address: addr(i % 50), chain: null, answer: 'unknown', registry: 'none',
        status: 'unknown', key_id: 'k', source_ip: null, detail_json: '{"basis":"not_in_registry"}', occurred_at: new Date(Date.UTC(2026, 9, 2, 0, 0, 0, i)).toISOString(),
      });
    }
    holder.counted = 1; // the count said one; by the time the rows are read there are 50,001
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps)).toEqual({ ok: false, error: 'export_too_large', max: 50_000 });
    holder.counted = ex.MAX_EXPORT_EVENTS + 1;
    expect(await ex.exportLedger(A, tin.id, '2026-10-01', '2026-10-03', deps)).toEqual({ ok: false, error: 'export_too_large', max: 50_000 });
  }, 60_000);
});
