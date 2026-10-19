import { describe, it, expect } from 'vitest';
import { addr } from '../helpers/agentVault';
import { parseLedgerRows, toLedgerRow } from '../../src/lib/agentVault/ledgerView';
import type { EventView } from '../../src/lib/agentVault/vault';

/**
 * How a ledger event reaches a screen: one shape for a page rendered on the server and for a "load
 * more" from the browser, carrying only what a screen reads and only values it recognizes. Every
 * address, key and hash is invented.
 */
const AT = '2026-10-17T09:30:00.123Z';
const HASH = `0x${'a'.repeat(64)}`;

const check = (over: Partial<EventView> = {}): EventView => ({
  id: '00000000-0000-4000-8000-000000000001', tinId: 'tin-1', kind: 'checked', at: AT, address: addr(1), chain: 'ethereum',
  answer: 'flagged', registry: 'flagged', status: 'mismatch', keyId: 'k', tx: null,
  detail: { basis: 'registry_flagged', cleared: false, domain: 'ops.example.test' }, keyStatus: 'active', ...over,
});
const move = (over: Partial<EventView> = {}): EventView => ({
  id: '00000000-0000-4000-8000-000000000002', tinId: 'tin-1', kind: 'transaction', at: AT, address: addr(2), chain: 'polygon',
  answer: 'unknown', registry: 'trusted', status: null, keyId: null,
  tx: { hash: HASH, direction: 'out', wallet: addr(900), amount: '12.5', asset: 'POL', assetContract: null, usd: 9.75, blockNumber: 5 },
  detail: { reason: 'no_preceding_check', leg: 'native:0', walletId: 'w', destinationId: 'd' }, keyStatus: null, ...over,
});

describe('a check', () => {
  it('becomes a row with what a screen reads and nothing else', () => {
    expect(toLedgerRow(check())).toEqual({
      id: '00000000-0000-4000-8000-000000000001', at: AT, kind: 'checked', address: addr(1), chain: 'ethereum', answer: 'flagged', registry: 'flagged',
      basis: 'registry_flagged', linkReason: null, limitReached: false, keyState: 'active', tx: null,
    });
  });

  it('carries the daily-limit marker only when the check really has it: a `reached` that is true, in a `limit` object', () => {
    expect(toLedgerRow(check({ detail: { basis: 'domain_proof', limit: { reached: true, perDay: 5000 } } }))?.limitReached).toBe(true);
    for (const limit of [{ reached: false }, { reached: 'true' }, { reached: 1 }, {}, null, 'reached', true, [] as unknown]) {
      expect(toLedgerRow(check({ detail: { basis: 'domain_proof', limit } as never }))?.limitReached, JSON.stringify(limit)).toBe(false);
    }
    expect(toLedgerRow(check({ detail: null }))?.limitReached).toBe(false);
    // A transfer is never the check that found the day full, whatever its detail says.
    expect(toLedgerRow(move({ detail: { limit: { reached: true } } }))?.limitReached).toBe(false);
  });

  it('leaves out the caller\'s address, the public status, the key id and the free text of what was answered', () => {
    const text = JSON.stringify(toLedgerRow(check()));
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toMatch(/sourceIp|status|keyId|ops\.example\.test|cleared/);
  });

  it('keeps a reason the report knows and files any other as `other`, whatever it says', () => {
    for (const basis of ['registry_flagged', 'domain_mismatch', 'not_in_registry', 'registry_pending', 'domain_proof', 'registered_and_checked_before', 'registered_first_check']) {
      expect(toLedgerRow(check({ detail: { basis } }))?.basis, basis).toBe(basis);
    }
    for (const detail of [{ basis: '<img src=x onerror=alert(1)>' }, { basis: 7 }, { basis: null }, {}, null, { basis: 'constructor' }, { basis: '__proto__' }]) {
      expect(toLedgerRow(check({ detail: detail as never }))?.basis, JSON.stringify(detail)).toBe('other');
    }
  });

  it('marks a key that was revoked, and one it cannot place, and says nothing when no key asked', () => {
    expect(toLedgerRow(check({ keyStatus: 'revoked' }))?.keyState).toBe('revoked');
    expect(toLedgerRow(check({ keyStatus: 'unknown' }))?.keyState).toBe('unknown');
    expect(toLedgerRow(check({ keyStatus: 'surprise' as never }))?.keyState).toBe('unknown');
    expect(toLedgerRow(check({ keyStatus: undefined }))?.keyState).toBe('unknown');
    expect(toLedgerRow(check({ keyId: null, keyStatus: null }))?.keyState).toBeNull();
  });

  it('files an answer, a registry word or a chain it does not know as none, never as the text it carries', () => {
    const row = toLedgerRow(check({ answer: 'safe' as never, registry: 'trusted-ish' as never, chain: 'solana' as never }));
    expect(row).toMatchObject({ answer: null, registry: null, chain: null });
    expect(toLedgerRow(check({ answer: 'constructor' as never }))?.answer).toBeNull();
    expect(toLedgerRow(check({ answer: null, registry: null, chain: null }))).toMatchObject({ answer: null, registry: null, chain: null });
  });
});

describe('a transfer', () => {
  it('becomes a row with its facts, and the reason it has no check behind it', () => {
    expect(toLedgerRow(move())).toEqual({
      id: '00000000-0000-4000-8000-000000000002', at: AT, kind: 'transaction', address: addr(2), chain: 'polygon', answer: 'unknown', registry: 'trusted',
      basis: null, linkReason: 'no_preceding_check', limitReached: false, keyState: null, tx: { hash: HASH, direction: 'out', amount: '12.5', asset: 'POL', usd: 9.75 },
    });
  });

  it('keeps an unpriced transfer unpriced: null is never 0', () => {
    expect(toLedgerRow(move({ tx: { ...move().tx!, usd: null } }))?.tx?.usd).toBeNull();
    expect(toLedgerRow(move({ tx: { ...move().tx!, usd: Number.NaN } }))?.tx?.usd).toBeNull();
    expect(toLedgerRow(move({ tx: { ...move().tx!, usd: Number.POSITIVE_INFINITY } }))?.tx?.usd).toBeNull();
    expect(toLedgerRow(move({ tx: { ...move().tx!, usd: '5' as never } }))?.tx?.usd).toBeNull();
    expect(toLedgerRow(move({ tx: { ...move().tx!, usd: 0 } }))?.tx?.usd).toBe(0);
  });

  it('reads the direction: in is in, anything else out is not guessed', () => {
    expect(toLedgerRow(move({ tx: { ...move().tx!, direction: 'in' } }))?.tx?.direction).toBe('in');
    expect(toLedgerRow(move({ tx: { ...move().tx!, direction: 'out' } }))?.tx?.direction).toBe('out');
  });

  it('knows two reasons for having no check behind it and drops any other', () => {
    expect(toLedgerRow(move({ detail: { reason: 'ambiguous_checks' } }))?.linkReason).toBe('ambiguous_checks');
    expect(toLedgerRow(move({ detail: { reason: 'because I said so' } }))?.linkReason).toBeNull();
    expect(toLedgerRow(move({ detail: { reason: 'constructor' } }))?.linkReason).toBeNull();
    expect(toLedgerRow(move({ detail: { link: { eventId: 'x' } } }))?.linkReason).toBeNull();
    expect(toLedgerRow(move({ detail: null }))?.linkReason).toBeNull();
  });

  it('carries the chain\'s own text as it came, for a screen to render as text', () => {
    const row = toLedgerRow(move({ tx: { ...move().tx!, asset: '<script>alert(1)</script>', amount: '1e+99' } }));
    expect(row?.tx?.asset).toBe('<script>alert(1)</script>');
    expect(row?.tx?.amount).toBe('1e+99');
  });

  it('keeps a transfer whose facts are unreadable as a row with none, rather than dropping it', () => {
    expect(toLedgerRow(move({ tx: { ...move().tx!, hash: undefined as never } }))).toMatchObject({ kind: 'transaction', tx: null });
    expect(toLedgerRow(move({ tx: null }))).toMatchObject({ kind: 'transaction', tx: null });
  });

  it('never shows a transfer the key state of a check', () => {
    expect(toLedgerRow(move({ keyId: 'k', keyStatus: 'revoked' }))?.keyState).toBeNull();
    expect(toLedgerRow(move({ keyId: 'k', keyStatus: 'revoked' }))?.basis).toBeNull();
  });
});

describe('what is not an event', () => {
  it('is no row', () => {
    for (const bad of [null, undefined, {}, [], 'text', 7, check({ id: '' }), check({ at: undefined as never }), check({ address: undefined as never }), check({ kind: 'other' as never }), check({ id: 5 as never })]) {
      expect(toLedgerRow(bad as never), JSON.stringify(bad)).toBeNull();
    }
  });

  it('parseLedgerRows keeps the events of a list in order, drops the rest, and answers an empty list for anything that is not one', () => {
    const rows = parseLedgerRows([check(), null, { nonsense: true }, move()]);
    expect(rows.map((r) => r.kind)).toEqual(['checked', 'transaction']);
    for (const bad of [null, undefined, {}, 'x', 3]) expect(parseLedgerRows(bad)).toEqual([]);
  });
});
